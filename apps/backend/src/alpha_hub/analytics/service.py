"""
Analytics service: executes SQL queries against the tenant's Azure SQL database.

Column names follow the db_keloke_v2 schema:
  VentaCabecera (VentaID, Fecha, LocalID, TipoVenta, TipoVentaMayorista, ClienteID, Anulada, ...)
  VentaDetalle  (VentaDetalleID, VentaID, ProductoID, MetodoPagoID, DineroDisponible, Cantidad, ...)
  Productos     (ProductoID, ProductoNombreId, ProductoTalleId, ProductoColorId, LocalID, ...)
  ProductoNombre (Id, Nombre)
  ProductoTalle  (Id, Talle)
  ProductoColor  (Id, Color)
  Locales       (LocalID, Nombre)
  MetodoPago    (MetodoPagoID, Nombre)
  Gastos        (GastoID, Monto, Fecha, LocalID, GastoTipoID, MetodoPagoID, ...)
  GastoTipo     (GastoTipoID, Nombre, GastoTipoCategoriaID)
  GastoTipoCategoria (GastoTipoCategoriaID, Nombre)
  CompraCabecera (CompraId, Fecha, LocalId, MetodoPagoId, ...)
  CompraDetalle  (CompraDetalleId, CompraId, ProductoId, Cantidad, CostoUnitario, Subtotal, ...)
  StockMovimiento (MovimientoID, ProductoID, Cantidad, TipoMovimiento, Fecha)
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..azure_db.service import get_db_config
from ..database.tenant import TenantConnectionRegistry
from .schemas import (
    ComprasResponse,
    FiltrosDisponibles,
    GastosResponse,
    KpiSummary,
    ProductoStock,
    StockResponse,
    VentasPorFecha,
    VentasResponse,
)

logger = structlog.get_logger()


async def _get_tenant_engine(
    platform_session: AsyncSession,
    tenant_id: str,
    registry: TenantConnectionRegistry,
):
    """Retrieve cached AsyncEngine for a tenant's Azure SQL database."""
    config = await get_db_config(platform_session, tenant_id)
    if not config or not config.vault_secret_id:
        raise ValueError(f"No Azure DB configuration found for tenant {tenant_id}")
    return await registry.get_engine(tenant_id, str(config.vault_secret_id))


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _first_of_month() -> date:
    d = _today()
    return d.replace(day=1)


def _rows_to_dicts(result) -> list[dict[str, Any]]:
    keys = list(result.keys())
    return [dict(zip(keys, row)) for row in result.fetchall()]


def _safe_pct(part: float, total: float) -> float:
    return round((part / total) * 100, 2) if total else 0.0


def _abc_rows(rows: list[dict[str, Any]], value_key: str = "revenue") -> list[dict[str, Any]]:
    sorted_rows = sorted(rows, key=lambda x: float(x.get(value_key, 0)), reverse=True)
    total = sum(float(r.get(value_key, 0)) for r in sorted_rows)
    acc = 0.0
    out: list[dict[str, Any]] = []
    for row in sorted_rows:
        val = float(row.get(value_key, 0))
        acc += val
        acc_pct = (acc / total * 100) if total else 0
        abc = "A" if acc_pct <= 80 else ("B" if acc_pct <= 95 else "C")
        out.append({**row, "abc": abc, "contribucion_pct": _safe_pct(val, total)})
    return out


async def _column_exists(conn, table_name: str, column_name: str) -> bool:
    q = text(
        """
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = :table_name AND COLUMN_NAME = :column_name
        """
    )
    r = await conn.execute(q, {"table_name": table_name, "column_name": column_name})
    return r.first() is not None


async def _table_exists(conn, table_name: str) -> bool:
    q = text(
        """
        SELECT 1
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = :table_name
        """
    )
    r = await conn.execute(q, {"table_name": table_name})
    return r.first() is not None


# ── KPIs ──────────────────────────────────────────────────────────────────────

async def get_kpis(
    platform_session: AsyncSession,
    tenant_id: str,
    registry: TenantConnectionRegistry,
) -> KpiSummary:
    engine = await _get_tenant_engine(platform_session, tenant_id, registry)
    today = _today()
    first_of_month = _first_of_month()

    ventas_hoy_q = text("""
        SELECT COALESCE(SUM(vd.DineroDisponible), 0) as total
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        WHERE CAST(vc.Fecha AS DATE) = :today
    """)
    ventas_mes_q = text("""
        SELECT
            COALESCE(SUM(vd.DineroDisponible), 0) as total,
            COUNT(DISTINCT vc.VentaID) as cantidad
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        WHERE vc.Fecha >= :desde AND vc.Fecha < DATEADD(day, 1, :hasta)
    """)
    gastos_mes_q = text("""
        SELECT COALESCE(SUM(g.Monto), 0) as total
        FROM Gastos g
        WHERE g.Fecha >= :desde AND g.Fecha < DATEADD(day, 1, :hasta)
    """)

    async with engine.connect() as conn:
        r_hoy = await conn.execute(ventas_hoy_q, {"today": today})
        ventas_hoy = float(r_hoy.scalar() or 0)

        r_mes = await conn.execute(ventas_mes_q, {"desde": first_of_month, "hasta": today})
        row_mes = r_mes.fetchone()
        ventas_mes = float(row_mes[0] or 0) if row_mes else 0.0
        cantidad_mes = int(row_mes[1] or 0) if row_mes else 0

        r_gastos = await conn.execute(gastos_mes_q, {"desde": first_of_month, "hasta": today})
        gastos_mes = float(r_gastos.scalar() or 0)

    ticket_promedio = (ventas_mes / cantidad_mes) if cantidad_mes > 0 else 0.0

    return KpiSummary(
        ventas_hoy=ventas_hoy,
        ventas_mes=ventas_mes,
        gastos_mes=gastos_mes,
        margen_mes=ventas_mes - gastos_mes,
        cantidad_ventas_mes=cantidad_mes,
        ticket_promedio=ticket_promedio,
    )


# ── Ventas ────────────────────────────────────────────────────────────────────

async def get_ventas(
    platform_session: AsyncSession,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    local_id: int | None = None,
    metodo_pago_id: int | None = None,
    tipo_venta: str | None = None,
    producto_nombre: str | None = None,
    talle_id: int | None = None,
    color_id: int | None = None,
) -> VentasResponse:
    engine = await _get_tenant_engine(platform_session, tenant_id, registry)

    fecha_desde = fecha_desde or _first_of_month()
    fecha_hasta = fecha_hasta or _today()

    params: dict[str, Any] = {
        "desde": fecha_desde,
        "hasta": fecha_hasta,
        "local_id": local_id,
        "metodo_pago_id": metodo_pago_id,
        "tipo_venta": tipo_venta,
        "talle_id": talle_id,
        "color_id": color_id,
        "producto_nombre": f"%{producto_nombre}%" if producto_nombre else None,
    }

    # Base WHERE clause — MetodoPagoID lives in VentaDetalle, not VentaCabecera
    base_where = """
        vc.Fecha >= :desde AND vc.Fecha < DATEADD(day, 1, :hasta)
        AND (:local_id IS NULL OR vc.LocalID = :local_id)
        AND (:metodo_pago_id IS NULL OR vd.MetodoPagoID = :metodo_pago_id)
        AND (:tipo_venta IS NULL OR vc.TipoVenta = :tipo_venta)
        AND (:talle_id IS NULL OR p.ProductoTalleId = :talle_id)
        AND (:color_id IS NULL OR p.ProductoColorId = :color_id)
        AND (:producto_nombre IS NULL OR pn.Nombre LIKE :producto_nombre)
    """

    serie_q = text(f"""
        SELECT
            CAST(vc.Fecha AS DATE) as fecha,
            COALESCE(SUM(vd.DineroDisponible), 0) as total,
            COUNT(DISTINCT vc.VentaID) as cantidad
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        LEFT JOIN Productos p ON vd.ProductoID = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        WHERE {base_where}
        GROUP BY CAST(vc.Fecha AS DATE)
        ORDER BY fecha
    """)

    por_local_q = text(f"""
        SELECT
            COALESCE(l.Nombre, 'Sin local') as nombre,
            COALESCE(SUM(vd.DineroDisponible), 0) as total
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        LEFT JOIN Productos p ON vd.ProductoID = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN Locales l ON vc.LocalID = l.LocalID
        WHERE {base_where}
        GROUP BY l.Nombre
        ORDER BY total DESC
    """)

    por_metodo_q = text(f"""
        SELECT
            COALESCE(mp.Nombre, 'Sin método') as nombre,
            COALESCE(SUM(vd.DineroDisponible), 0) as total
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        LEFT JOIN Productos p ON vd.ProductoID = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN MetodoPago mp ON vd.MetodoPagoID = mp.MetodoPagoID
        WHERE {base_where}
        GROUP BY mp.Nombre
        ORDER BY total DESC
    """)

    por_tipo_q = text(f"""
        SELECT
            COALESCE(vc.TipoVenta, 'Sin tipo') as tipo,
            COALESCE(SUM(vd.DineroDisponible), 0) as total
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        LEFT JOIN Productos p ON vd.ProductoID = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        WHERE {base_where}
        GROUP BY vc.TipoVenta
        ORDER BY total DESC
    """)

    top_productos_q = text(f"""
        SELECT TOP 30
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            COALESCE(pt.Talle, '') as talle,
            COALESCE(pc.Color, '') as color,
            COALESCE(SUM(vd.DineroDisponible), 0) as total,
            COALESCE(SUM(vd.Cantidad), 0) as cantidad
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        LEFT JOIN Productos p ON vd.ProductoID = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        WHERE {base_where}
        GROUP BY pn.Nombre, pt.Talle, pc.Color
        ORDER BY total DESC
    """)

    async with engine.connect() as conn:
        r_serie = await conn.execute(serie_q, params)
        serie_rows = r_serie.fetchall()

        r_local = await conn.execute(por_local_q, params)
        local_rows = _rows_to_dicts(r_local)

        r_metodo = await conn.execute(por_metodo_q, params)
        metodo_rows = _rows_to_dicts(r_metodo)

        r_tipo = await conn.execute(por_tipo_q, params)
        tipo_rows = _rows_to_dicts(r_tipo)

        r_prods = await conn.execute(top_productos_q, params)
        prod_rows = _rows_to_dicts(r_prods)

    # Recompute serie
    serie: list[VentasPorFecha] = [
        VentasPorFecha(
            fecha=str(row[0]),
            total=float(row[1] or 0),
            cantidad=int(row[2] or 0),
        )
        for row in serie_rows
    ]

    total_periodo = sum(s.total for s in serie)
    cantidad_ventas = sum(s.cantidad for s in serie)
    ticket_promedio = total_periodo / cantidad_ventas if cantidad_ventas > 0 else 0.0

    def add_pct(rows: list[dict], total: float) -> list[dict]:
        return [
            {**r, "pct": round(float(r.get("total", 0)) / total * 100, 1) if total else 0}
            for r in rows
        ]

    # Convert all numeric values to float/int
    for r in local_rows:
        r["total"] = float(r.get("total", 0))
    for r in metodo_rows:
        r["total"] = float(r.get("total", 0))
    for r in tipo_rows:
        r["total"] = float(r.get("total", 0))
    for r in prod_rows:
        r["total"] = float(r.get("total", 0))
        r["cantidad"] = int(r.get("cantidad", 0))

    top_detalle = add_pct(prod_rows, total_periodo)
    top_por_nombre_map: dict[str, dict[str, Any]] = {}
    for row in top_detalle:
        nombre = str(row.get("nombre", "Sin nombre"))
        if nombre not in top_por_nombre_map:
            top_por_nombre_map[nombre] = {"nombre": nombre, "total": 0.0, "cantidad": 0}
        top_por_nombre_map[nombre]["total"] += float(row.get("total", 0))
        top_por_nombre_map[nombre]["cantidad"] += int(row.get("cantidad", 0))
    top_por_nombre = sorted(top_por_nombre_map.values(), key=lambda x: float(x["total"]), reverse=True)[:30]
    for row in top_por_nombre:
        row["pct"] = _safe_pct(float(row["total"]), total_periodo)

    facturado_total = total_periodo
    costo_mercaderia_vendida = 0.0
    comisiones_pago = 0.0
    vendido_a_cuenta = 0.0
    cobrado_de_cuenta_corriente = 0.0

    costo_q = text(
        f"""
        WITH latest_cost AS (
            SELECT
                cd.ProductoID,
                cd.PrecioUnitario,
                ROW_NUMBER() OVER (PARTITION BY cd.ProductoID ORDER BY cc.FechaHora DESC) as rn
            FROM CompraDetalle cd
            INNER JOIN CompraCabecera cc ON cd.CompraID = cc.ID
        ),
        ventas_prod AS (
            SELECT
                vd.ProductoID,
                SUM(vd.Cantidad) as unidades
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.ID
            LEFT JOIN Productos p ON vd.ProductoID = p.ID
            LEFT JOIN ProductoNombre pn ON p.NombreID = pn.ID
            WHERE {base_where}
            GROUP BY vd.ProductoID
        )
        SELECT COALESCE(SUM(vp.unidades * COALESCE(lc.PrecioUnitario, 0)), 0) as costo
        FROM ventas_prod vp
        LEFT JOIN latest_cost lc ON lc.ProductoID = vp.ProductoID AND lc.rn = 1
        """
    )
    vendido_cuenta_q = text(
        f"""
        SELECT COALESCE(SUM(vd.DineroDisponible), 0) as total
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.ID
        LEFT JOIN Productos p ON vd.ProductoID = p.ID
        LEFT JOIN ProductoNombre pn ON p.NombreID = pn.ID
        WHERE {base_where}
          AND LOWER(COALESCE(vc.TipoVenta, '')) LIKE '%cuenta%'
        """
    )
    try:
        async with engine.connect() as conn:
            costo_mercaderia_vendida = float((await conn.execute(costo_q, params)).scalar() or 0)
            vendido_a_cuenta = float((await conn.execute(vendido_cuenta_q, params)).scalar() or 0)
            cobrado_de_cuenta_corriente = vendido_a_cuenta

            if await _column_exists(conn, "VentaDetalle", "ComisionMonto"):
                comision_q = text(
                    f"""
                    SELECT COALESCE(SUM(vd.ComisionMonto), 0)
                    FROM VentaDetalle vd
                    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.ID
                    LEFT JOIN Productos p ON vd.ProductoID = p.ID
                    LEFT JOIN ProductoNombre pn ON p.NombreID = pn.ID
                    WHERE {base_where}
                    """
                )
                comisiones_pago = float((await conn.execute(comision_q, params)).scalar() or 0)
            elif await _column_exists(conn, "MetodoPago", "ComisionPorcentaje"):
                comision_q = text(
                    f"""
                    SELECT
                        COALESCE(mp.ComisionPorcentaje, 0) as comision_pct,
                        COALESCE(SUM(vd.DineroDisponible), 0) as total
                    FROM VentaDetalle vd
                    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.ID
                    LEFT JOIN Productos p ON vd.ProductoID = p.ID
                    LEFT JOIN ProductoNombre pn ON p.NombreID = pn.ID
                    LEFT JOIN MetodoPago mp ON vc.MetodoPagoID = mp.ID
                    WHERE {base_where}
                    GROUP BY mp.ComisionPorcentaje
                    """
                )
                for row in _rows_to_dicts(await conn.execute(comision_q, params)):
                    comisiones_pago += float(row.get("total", 0)) * float(row.get("comision_pct", 0)) / 100
    except Exception as exc:
        logger.warning("Ventas advanced metrics fallback", error=str(exc))

    participacion_producto_filtrado_pct = None
    if producto_nombre:
        total_filtrado = sum(float(r.get("total", 0)) for r in top_por_nombre)
        participacion_producto_filtrado_pct = _safe_pct(total_filtrado, facturado_total)

    return VentasResponse(
        serie_temporal=serie,
        por_local=add_pct(local_rows, total_periodo),
        por_metodo_pago=add_pct(metodo_rows, total_periodo),
        por_tipo_venta=add_pct(tipo_rows, total_periodo),
        top_productos=top_por_nombre,
        top_productos_por_nombre=top_por_nombre,
        top_productos_detalle=top_detalle,
        participacion_producto_filtrado_pct=participacion_producto_filtrado_pct,
        total_periodo=total_periodo,
        cantidad_ventas=cantidad_ventas,
        ticket_promedio=ticket_promedio,
        facturado_total=facturado_total,
        costo_mercaderia_vendida=costo_mercaderia_vendida,
        comisiones_pago=comisiones_pago,
        margen_bruto_post_comisiones=facturado_total - costo_mercaderia_vendida - comisiones_pago,
        vendido_a_cuenta=vendido_a_cuenta,
        cobrado_de_cuenta_corriente=cobrado_de_cuenta_corriente,
    )


# ── Gastos ────────────────────────────────────────────────────────────────────

async def get_gastos(
    platform_session: AsyncSession,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    local_id: int | None = None,
    metodo_pago_id: int | None = None,
    tipo_id: int | None = None,
    categoria_id: int | None = None,
) -> GastosResponse:
    engine = await _get_tenant_engine(platform_session, tenant_id, registry)
    fecha_desde = fecha_desde or _first_of_month()
    fecha_hasta = fecha_hasta or _today()

    params: dict[str, Any] = {
        "desde": fecha_desde,
        "hasta": fecha_hasta,
        "local_id": local_id,
        "metodo_pago_id": metodo_pago_id,
        "tipo_id": tipo_id,
        "categoria_id": categoria_id,
    }

    base_where = """
        g.Fecha >= :desde AND g.Fecha < DATEADD(day, 1, :hasta)
        AND (:local_id IS NULL OR g.LocalID = :local_id)
        AND (:metodo_pago_id IS NULL OR g.MetodoPagoID = :metodo_pago_id)
        AND (:tipo_id IS NULL OR g.GastoTipoID = :tipo_id)
        AND (:categoria_id IS NULL OR gt.GastoTipoCategoriaID = :categoria_id)
    """

    serie_q = text(f"""
        SELECT
            CAST(g.Fecha AS DATE) as fecha,
            COALESCE(SUM(g.Monto), 0) as total
        FROM Gastos g
        LEFT JOIN GastoTipo gt ON g.GastoTipoID = gt.GastoTipoID
        WHERE {base_where}
        GROUP BY CAST(g.Fecha AS DATE)
        ORDER BY fecha
    """)

    por_categoria_q = text(f"""
        SELECT
            COALESCE(gtc.Nombre, 'Sin categoría') as categoria,
            COALESCE(gt.Nombre, 'Sin tipo') as tipo,
            COALESCE(SUM(g.Monto), 0) as total
        FROM Gastos g
        LEFT JOIN GastoTipo gt ON g.GastoTipoID = gt.GastoTipoID
        LEFT JOIN GastoTipoCategoria gtc ON gt.GastoTipoCategoriaID = gtc.GastoTipoCategoriaID
        WHERE {base_where}
        GROUP BY gtc.Nombre, gt.Nombre
        ORDER BY total DESC
    """)

    por_tipo_q = text(f"""
        SELECT
            COALESCE(gt.Nombre, 'Sin tipo') as tipo,
            COALESCE(SUM(g.Monto), 0) as total
        FROM Gastos g
        LEFT JOIN GastoTipo gt ON g.TipoGastoID = gt.ID
        WHERE {base_where}
        GROUP BY gt.Nombre
        ORDER BY total DESC
    """)

    por_metodo_q = text(f"""
        SELECT
            COALESCE(mp.Nombre, 'Sin método') as nombre,
            COALESCE(SUM(g.Monto), 0) as total
        FROM Gastos g
        LEFT JOIN MetodoPago mp ON g.MetodoPagoID = mp.MetodoPagoID
        LEFT JOIN GastoTipo gt ON g.GastoTipoID = gt.GastoTipoID
        WHERE {base_where}
        GROUP BY mp.Nombre
        ORDER BY total DESC
    """)

    detalle_q = text(f"""
        SELECT
            CAST(g.Fecha AS DATE) as fecha,
            COALESCE(gtc.Nombre, 'Sin categoria') as categoria,
            COALESCE(gt.Nombre, 'Sin tipo') as tipo,
            COALESCE(mp.Nombre, 'Sin metodo') as metodo_pago,
            COALESCE(g.Monto, 0) as monto
        FROM Gastos g
        LEFT JOIN GastoTipo gt ON g.TipoGastoID = gt.ID
        LEFT JOIN GastoTipoCategoria gtc ON gt.CategoriaID = gtc.ID
        LEFT JOIN MetodoPago mp ON g.MetodoPagoID = mp.ID
        WHERE {base_where}
        ORDER BY g.Fecha DESC, g.ID DESC
    """)

    # Compare with ventas for the same period
    ventas_q = text("""
        SELECT COALESCE(SUM(vd.DineroDisponible), 0)
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        WHERE vc.Fecha >= :desde AND vc.Fecha < DATEADD(day, 1, :hasta)
    """)

    async with engine.connect() as conn:
        r_serie = await conn.execute(serie_q, params)
        serie_rows = _rows_to_dicts(r_serie)

        r_cat = await conn.execute(por_categoria_q, params)
        cat_rows = _rows_to_dicts(r_cat)

        r_tipo = await conn.execute(por_tipo_q, params)
        tipo_rows = _rows_to_dicts(r_tipo)

        r_metodo = await conn.execute(por_metodo_q, params)
        metodo_rows = _rows_to_dicts(r_metodo)

        r_detalle = await conn.execute(detalle_q, params)
        detalle_rows = _rows_to_dicts(r_detalle)

        r_ventas = await conn.execute(ventas_q, {"desde": fecha_desde, "hasta": fecha_hasta})
        ventas_total = float(r_ventas.scalar() or 0)

    for r in serie_rows:
        r["total"] = float(r.get("total", 0))
        r["fecha"] = str(r["fecha"])
    for r in cat_rows:
        r["total"] = float(r.get("total", 0))
    for r in tipo_rows:
        r["total"] = float(r.get("total", 0))
    for r in metodo_rows:
        r["total"] = float(r.get("total", 0))
    for r in detalle_rows:
        r["fecha"] = str(r.get("fecha"))
        r["monto"] = float(r.get("monto", 0))

    total_periodo = sum(float(r.get("total", 0)) for r in serie_rows)

    def add_pct(rows: list[dict], total: float) -> list[dict]:
        return [
            {**r, "pct": round(float(r.get("total", 0)) / total * 100, 1) if total else 0}
            for r in rows
        ]

    ratio_ventas = round(total_periodo / ventas_total * 100, 1) if ventas_total else None

    return GastosResponse(
        serie_temporal=serie_rows,
        por_categoria=add_pct(cat_rows, total_periodo),
        por_tipo=add_pct(tipo_rows, total_periodo),
        por_metodo_pago=add_pct(metodo_rows, total_periodo),
        detalle=detalle_rows,
        total_periodo=total_periodo,
        ratio_ventas=ratio_ventas,
    )


# ── Stock ─────────────────────────────────────────────────────────────────────

async def get_stock(
    platform_session: AsyncSession,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    local_id: int | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
) -> StockResponse:
    engine = await _get_tenant_engine(platform_session, tenant_id, registry)
    fecha_desde = fecha_desde or _first_of_month()
    fecha_hasta = fecha_hasta or _today()
    dias_periodo = max((fecha_hasta - fecha_desde).days, 1)

    params: dict[str, Any] = {
        "desde": fecha_desde,
        "hasta": fecha_hasta,
        "local_id": local_id,
    }

    # Current stock per product — StockMovimiento has no LocalID, filter by Productos.LocalID
    stock_q = text("""
        SELECT
            p.ProductoID as producto_id,
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            COALESCE(pt.Talle, '') as talle,
            COALESCE(pc.Color, '') as color,
            COALESCE(SUM(
                CASE WHEN sm.TipoMovimiento IN ('entrada', 'compra', 'devolucion_cliente')
                     THEN sm.Cantidad
                     WHEN sm.TipoMovimiento IN ('salida', 'venta', 'devolucion_proveedor')
                     THEN -sm.Cantidad
                     ELSE 0 END
            ), 0) as stock_actual
        FROM Productos p
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        LEFT JOIN StockMovimiento sm ON sm.ProductoID = p.ProductoID
        WHERE (:local_id IS NULL OR p.LocalID = :local_id)
        GROUP BY p.ProductoID, pn.Nombre, pt.Talle, pc.Color
        HAVING SUM(
            CASE WHEN sm.TipoMovimiento IN ('entrada', 'compra', 'devolucion_cliente')
                 THEN sm.Cantidad
                 WHEN sm.TipoMovimiento IN ('salida', 'venta', 'devolucion_proveedor')
                 THEN -sm.Cantidad
                 ELSE 0 END
        ) >= 0
        ORDER BY stock_actual DESC
    """)

    # Sales per product in the period (for rotation & ABC)
    ventas_q = text("""
        SELECT
            vd.ProductoID as producto_id,
            COALESCE(SUM(vd.Cantidad), 0) as unidades_vendidas,
            COALESCE(SUM(vd.DineroDisponible), 0) as revenue
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        WHERE vc.Fecha >= :desde AND vc.Fecha < DATEADD(day, 1, :hasta)
            AND (:local_id IS NULL OR vc.LocalID = :local_id)
        GROUP BY vd.ProductoID
    """)

    # Try bajo stock view first
    bajo_stock_q = text("SELECT TOP 20 * FROM vw_ProductosBajoStock")

    async with engine.connect() as conn:
        r_stock = await conn.execute(stock_q, params)
        stock_rows = _rows_to_dicts(r_stock)

        r_ventas = await conn.execute(ventas_q, params)
        ventas_dict: dict[int, dict] = {}
        for row in r_ventas.fetchall():
            ventas_dict[int(row[0])] = {
                "unidades": int(row[1] or 0),
                "revenue": float(row[2] or 0),
            }

        # Try the view; fall back gracefully
        bajo_stock: list[dict] = []
        try:
            r_bajo = await conn.execute(bajo_stock_q)
            bajo_stock = _rows_to_dicts(r_bajo)
        except Exception:
            pass

    # Total revenue for ABC
    total_revenue = sum(v["revenue"] for v in ventas_dict.values())

    # Build product list with computed metrics
    productos_con_revenue: list[tuple[float, dict]] = []
    for row in stock_rows:
        pid = int(row["producto_id"])
        v = ventas_dict.get(pid, {"unidades": 0, "revenue": 0.0})
        stock_actual = int(row["stock_actual"])
        unidades = v["unidades"]
        revenue = v["revenue"]

        # Rotation: units sold / avg stock (avg = stock_actual since we have end-of-period)
        rotacion = round(unidades / stock_actual, 2) if stock_actual > 0 else 0.0

        # Coverage: stock_actual / avg daily sales
        avg_daily = unidades / dias_periodo if dias_periodo > 0 else 0
        cobertura = round(stock_actual / avg_daily, 1) if avg_daily > 0 else 9999.0

        contribucion_pct = round(revenue / total_revenue * 100, 2) if total_revenue > 0 else 0.0

        productos_con_revenue.append((revenue, {
            "producto_id": pid,
            "nombre": row["nombre"],
            "descripcion": " ".join(
                [x for x in [str(row["nombre"]), str(row["talle"] or "").strip(), str(row["color"] or "").strip()] if x]
            ).strip(),
            "talle": row["talle"] or None,
            "color": row["color"] or None,
            "stock_actual": stock_actual,
            "unidades_vendidas_periodo": unidades,
            "rotacion": rotacion,
            "cobertura_dias": cobertura,
            "contribucion_pct": contribucion_pct,
            "estado_stock": (
                "substock" if cobertura < 15 else ("sobrestock" if cobertura > 90 else "normal")
            ),
            "alerta_bajo_stock": cobertura < 15 and unidades > 0,
        }))

    # Sort by revenue descending for ABC
    productos_con_revenue.sort(key=lambda x: x[0], reverse=True)

    # Assign ABC classification
    acumulado = 0.0
    productos: list[ProductoStock] = []
    for rev, p in productos_con_revenue:
        acumulado += rev
        if total_revenue > 0:
            pct_acum = acumulado / total_revenue * 100
            abc = "A" if pct_acum <= 80 else ("B" if pct_acum <= 95 else "C")
        else:
            abc = "C"

        productos.append(ProductoStock(
            **p,
            clasificacion_abc=abc,
        ))

    total_productos = len(productos)
    total_skus = total_productos
    skus_sin_stock = sum(1 for p in productos if p.stock_actual == 0)
    skus_bajo_stock = len(bajo_stock)
    total_stock_unidades = sum(p.stock_actual for p in productos)
    total_vendido_unidades = sum(p.unidades_vendidas_periodo for p in productos)
    rotacion_general = round(total_vendido_unidades / max(total_stock_unidades, 1), 3)
    projected_daily = max(total_vendido_unidades / max(dias_periodo, 1), 0.001)
    cobertura_general_dias = round(total_stock_unidades / projected_daily, 1) if projected_daily > 0 else 9999.0

    abc_por_nombre = _abc_rows(
        [
            {"nombre": k, "revenue": sum(x[0] for x in productos_con_revenue if x[1]["nombre"] == k)}
            for k in sorted({x[1]["nombre"] for x in productos_con_revenue})
        ],
        value_key="revenue",
    )
    abc_por_descripcion = _abc_rows(
        [
            {"descripcion": k, "revenue": sum(x[0] for x in productos_con_revenue if x[1]["descripcion"] == k)}
            for k in sorted({x[1]["descripcion"] for x in productos_con_revenue})
        ],
        value_key="revenue",
    )

    mas_vendidos_por_nombre = sorted(
        [
            {
                "nombre": k,
                "unidades_vendidas": sum(x[1]["unidades_vendidas_periodo"] for x in productos_con_revenue if x[1]["nombre"] == k),
                "stock_actual": sum(x[1]["stock_actual"] for x in productos_con_revenue if x[1]["nombre"] == k),
            }
            for k in sorted({x[1]["nombre"] for x in productos_con_revenue})
        ],
        key=lambda x: x["unidades_vendidas"],
        reverse=True,
    )[:30]
    mas_vendidos_por_descripcion = sorted(
        [
            {
                "descripcion": k,
                "unidades_vendidas": sum(x[1]["unidades_vendidas_periodo"] for x in productos_con_revenue if x[1]["descripcion"] == k),
                "stock_actual": sum(x[1]["stock_actual"] for x in productos_con_revenue if x[1]["descripcion"] == k),
            }
            for k in sorted({x[1]["descripcion"] for x in productos_con_revenue})
        ],
        key=lambda x: x["unidades_vendidas"],
        reverse=True,
    )[:30]
    for row in mas_vendidos_por_nombre:
        row["alerta_bajo_stock"] = row["stock_actual"] < max(int(row["unidades_vendidas"] / 4), 1)
    for row in mas_vendidos_por_descripcion:
        row["alerta_bajo_stock"] = row["stock_actual"] < max(int(row["unidades_vendidas"] / 4), 1)

    analisis_stock = {
        "substock": sum(1 for p in productos if p.estado_stock == "substock"),
        "normal": sum(1 for p in productos if p.estado_stock == "normal"),
        "sobrestock": sum(1 for p in productos if p.estado_stock == "sobrestock"),
    }

    return StockResponse(
        productos=productos,
        bajo_stock=bajo_stock,
        monto_total_stock_compra=0.0,
        rotacion_general=rotacion_general,
        cobertura_general_dias=cobertura_general_dias,
        tasa_crecimiento_ventas=0.0,
        analisis_stock=analisis_stock,
        abc_por_nombre=abc_por_nombre,
        abc_por_descripcion=abc_por_descripcion,
        mas_vendidos_por_nombre=mas_vendidos_por_nombre,
        mas_vendidos_por_descripcion=mas_vendidos_por_descripcion,
        total_productos=total_productos,
        total_skus=total_skus,
        skus_sin_stock=skus_sin_stock,
        skus_bajo_stock=skus_bajo_stock,
    )


# ── Compras ───────────────────────────────────────────────────────────────────

async def get_compras(
    platform_session: AsyncSession,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    local_id: int | None = None,
) -> ComprasResponse:
    engine = await _get_tenant_engine(platform_session, tenant_id, registry)
    fecha_desde = fecha_desde or _first_of_month()
    fecha_hasta = fecha_hasta or _today()

    params: dict[str, Any] = {
        "desde": fecha_desde,
        "hasta": fecha_hasta,
        "local_id": local_id,
    }

    serie_q = text("""
        SELECT
            CAST(cc.Fecha AS DATE) as fecha,
            COALESCE(SUM(cd.Subtotal), 0) as total,
            COUNT(DISTINCT cc.CompraId) as cantidad
        FROM CompraDetalle cd
        INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
        WHERE cc.Fecha >= :desde AND cc.Fecha < DATEADD(day, 1, :hasta)
            AND (:local_id IS NULL OR cc.LocalId = :local_id)
        GROUP BY CAST(cc.Fecha AS DATE)
        ORDER BY fecha
    """)

    top_productos_q = text("""
        SELECT TOP 20
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            COALESCE(pt.Talle, '') as talle,
            COALESCE(pc.Color, '') as color,
            COALESCE(SUM(cd.Subtotal), 0) as total,
            COALESCE(SUM(cd.Cantidad), 0) as cantidad
        FROM CompraDetalle cd
        INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
        LEFT JOIN Productos p ON cd.ProductoId = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        WHERE cc.Fecha >= :desde AND cc.Fecha < DATEADD(day, 1, :hasta)
            AND (:local_id IS NULL OR cc.LocalId = :local_id)
        GROUP BY pn.Nombre, pt.Talle, pc.Color
        ORDER BY total DESC
    """)

    async with engine.connect() as conn:
        r_serie = await conn.execute(serie_q, params)
        serie_rows = _rows_to_dicts(r_serie)

        r_prods = await conn.execute(top_productos_q, params)
        prod_rows = _rows_to_dicts(r_prods)

        proveedores_rows: list[dict[str, Any]] = []
        if await _column_exists(conn, "CompraCabecera", "ProveedorID") and await _table_exists(conn, "Proveedores"):
            prov_q = text(
                """
                SELECT TOP 20
                    COALESCE(pr.Nombre, 'Sin proveedor') as proveedor,
                    COALESCE(SUM(cd.Cantidad * cd.PrecioUnitario), 0) as total,
                    COUNT(DISTINCT cc.ID) as ordenes
                FROM CompraDetalle cd
                INNER JOIN CompraCabecera cc ON cd.CompraID = cc.ID
                LEFT JOIN Proveedores pr ON cc.ProveedorID = pr.ID
                WHERE cc.FechaHora >= :desde AND cc.FechaHora < DATEADD(day, 1, :hasta)
                    AND (:local_id IS NULL OR cc.LocalID = :local_id)
                GROUP BY pr.Nombre
                ORDER BY total DESC
                """
            )
            proveedores_rows = _rows_to_dicts(await conn.execute(prov_q, params))

    for r in serie_rows:
        r["total"] = float(r.get("total", 0))
        r["cantidad"] = int(r.get("cantidad", 0))
        r["fecha"] = str(r["fecha"])
    for r in prod_rows:
        r["total"] = float(r.get("total", 0))
        r["cantidad"] = int(r.get("cantidad", 0))

    total_periodo = sum(r["total"] for r in serie_rows)
    cantidad_ordenes = sum(r["cantidad"] for r in serie_rows)
    promedio_por_orden = total_periodo / cantidad_ordenes if cantidad_ordenes > 0 else 0.0

    for r in proveedores_rows:
        r["total"] = float(r.get("total", 0))
        r["ordenes"] = int(r.get("ordenes", 0))
        r["pct"] = _safe_pct(r["total"], total_periodo)
    analisis = {
        "concentracion_top10_pct": _safe_pct(sum(float(x.get("total", 0)) for x in prod_rows[:10]), total_periodo),
        "cantidad_proveedores": len(proveedores_rows),
        "proveedor_principal_pct": _safe_pct(float(proveedores_rows[0]["total"]), total_periodo) if proveedores_rows else 0.0,
    }

    return ComprasResponse(
        serie_temporal=serie_rows,
        top_productos=prod_rows,
        top_proveedores=proveedores_rows,
        analisis=analisis,
        total_periodo=total_periodo,
        cantidad_ordenes=cantidad_ordenes,
        promedio_por_orden=promedio_por_orden,
    )


# ── Filtros ───────────────────────────────────────────────────────────────────

async def get_filtros(
    platform_session: AsyncSession,
    tenant_id: str,
    registry: TenantConnectionRegistry,
) -> FiltrosDisponibles:
    engine = await _get_tenant_engine(platform_session, tenant_id, registry)

    async with engine.connect() as conn:
        r_locales = await conn.execute(text("SELECT LocalID as id, Nombre as nombre FROM Locales ORDER BY Nombre"))
        locales = _rows_to_dicts(r_locales)

        r_metodos = await conn.execute(text("SELECT MetodoPagoID as id, Nombre as nombre FROM MetodoPago ORDER BY Nombre"))
        metodos = _rows_to_dicts(r_metodos)

        r_tipos_venta = await conn.execute(text(
            "SELECT DISTINCT TipoVenta FROM VentaCabecera WHERE TipoVenta IS NOT NULL ORDER BY TipoVenta"
        ))
        tipos_venta = [row[0] for row in r_tipos_venta.fetchall() if row[0]]

        r_talles = await conn.execute(text("SELECT Id as id, Talle as nombre FROM ProductoTalle ORDER BY Talle"))
        talles = _rows_to_dicts(r_talles)

        r_colores = await conn.execute(text("SELECT Id as id, Color as nombre FROM ProductoColor ORDER BY Color"))
        colores = _rows_to_dicts(r_colores)

        r_tipos_gasto = await conn.execute(text("SELECT GastoTipoID as id, Nombre as nombre FROM GastoTipo ORDER BY Nombre"))
        tipos_gasto = _rows_to_dicts(r_tipos_gasto)

        r_cats_gasto = await conn.execute(text("SELECT GastoTipoCategoriaID as id, Nombre as nombre FROM GastoTipoCategoria ORDER BY Nombre"))
        cats_gasto = _rows_to_dicts(r_cats_gasto)

    return FiltrosDisponibles(
        locales=locales,
        metodos_pago=metodos,
        tipos_venta=tipos_venta,
        talles=talles,
        colores=colores,
        tipos_gasto=tipos_gasto,
        categorias_gasto=cats_gasto,
    )
