"""
Analytics service: executes SQL queries against the tenant's Azure SQL database.

Column names follow the db_keloke_v2 schema:
  VentaCabecera (ID, FechaHora, LocalID, MetodoPagoID, TipoVenta, ClienteID, ...)
  VentaDetalle  (ID, VentaID, ProductoID, DineroDisponible, Cantidad, ...)
  Productos     (ID, NombreID, TalleID, ColorID, ...)
  ProductoNombre (ID, Nombre)
  ProductoTalle  (ID, Nombre)
  ProductoColor  (ID, Nombre)
  Locales       (ID, Nombre)
  MetodoPago    (ID, Nombre)
  Gastos        (ID, Monto, Fecha, LocalID, TipoGastoID, MetodoPagoID, ...)
  GastoTipo     (ID, Nombre, CategoriaID)
  GastoTipoCategoria (ID, Nombre)
  CompraCabecera (ID, FechaHora, LocalID, ...)
  CompraDetalle  (ID, CompraID, ProductoID, Cantidad, PrecioUnitario, ...)
  StockMovimiento (ID, ProductoID, LocalID, TipoMovimiento, Cantidad, FechaHora)
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
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.ID
        WHERE CAST(vc.FechaHora AS DATE) = :today
    """)
    ventas_mes_q = text("""
        SELECT
            COALESCE(SUM(vd.DineroDisponible), 0) as total,
            COUNT(DISTINCT vc.ID) as cantidad
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.ID
        WHERE vc.FechaHora >= :desde AND vc.FechaHora < DATEADD(day, 1, :hasta)
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

    # Base WHERE clause
    base_where = """
        vc.FechaHora >= :desde AND vc.FechaHora < DATEADD(day, 1, :hasta)
        AND (:local_id IS NULL OR vc.LocalID = :local_id)
        AND (:metodo_pago_id IS NULL OR vc.MetodoPagoID = :metodo_pago_id)
        AND (:tipo_venta IS NULL OR vc.TipoVenta = :tipo_venta)
        AND (:talle_id IS NULL OR p.TalleID = :talle_id)
        AND (:color_id IS NULL OR p.ColorID = :color_id)
        AND (:producto_nombre IS NULL OR pn.Nombre LIKE :producto_nombre)
    """

    serie_q = text(f"""
        SELECT
            CAST(vc.FechaHora AS DATE) as fecha,
            COALESCE(SUM(vd.DineroDisponible), 0) as total,
            COUNT(DISTINCT vc.ID) as cantidad
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.ID
        LEFT JOIN Productos p ON vd.ProductoID = p.ID
        LEFT JOIN ProductoNombre pn ON p.NombreID = pn.ID
        WHERE {base_where}
        GROUP BY CAST(vc.FechaHora AS DATE)
        ORDER BY fecha
    """)

    por_local_q = text(f"""
        SELECT
            COALESCE(l.Nombre, 'Sin local') as nombre,
            COALESCE(SUM(vd.DineroDisponible), 0) as total
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.ID
        LEFT JOIN Productos p ON vd.ProductoID = p.ID
        LEFT JOIN ProductoNombre pn ON p.NombreID = pn.ID
        LEFT JOIN Locales l ON vc.LocalID = l.ID
        WHERE {base_where}
        GROUP BY l.Nombre
        ORDER BY total DESC
    """)

    por_metodo_q = text(f"""
        SELECT
            COALESCE(mp.Nombre, 'Sin método') as nombre,
            COALESCE(SUM(vd.DineroDisponible), 0) as total
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.ID
        LEFT JOIN Productos p ON vd.ProductoID = p.ID
        LEFT JOIN ProductoNombre pn ON p.NombreID = pn.ID
        LEFT JOIN MetodoPago mp ON vc.MetodoPagoID = mp.ID
        WHERE {base_where}
        GROUP BY mp.Nombre
        ORDER BY total DESC
    """)

    por_tipo_q = text(f"""
        SELECT
            COALESCE(vc.TipoVenta, 'Sin tipo') as tipo,
            COALESCE(SUM(vd.DineroDisponible), 0) as total
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.ID
        LEFT JOIN Productos p ON vd.ProductoID = p.ID
        LEFT JOIN ProductoNombre pn ON p.NombreID = pn.ID
        WHERE {base_where}
        GROUP BY vc.TipoVenta
        ORDER BY total DESC
    """)

    top_productos_q = text(f"""
        SELECT TOP 30
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            COALESCE(pt.Nombre, '') as talle,
            COALESCE(pc.Nombre, '') as color,
            COALESCE(SUM(vd.DineroDisponible), 0) as total,
            COALESCE(SUM(vd.Cantidad), 0) as cantidad
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.ID
        LEFT JOIN Productos p ON vd.ProductoID = p.ID
        LEFT JOIN ProductoNombre pn ON p.NombreID = pn.ID
        LEFT JOIN ProductoTalle pt ON p.TalleID = pt.ID
        LEFT JOIN ProductoColor pc ON p.ColorID = pc.ID
        WHERE {base_where}
        GROUP BY pn.Nombre, pt.Nombre, pc.Nombre
        ORDER BY total DESC
    """)

    async with engine.connect() as conn:
        r_serie = await conn.execute(serie_q, params)
        serie_rows = r_serie.fetchall()
        serie_keys = list(r_serie.keys()) if not serie_rows else None

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

    return VentasResponse(
        serie_temporal=serie,
        por_local=add_pct(local_rows, total_periodo),
        por_metodo_pago=add_pct(metodo_rows, total_periodo),
        por_tipo_venta=add_pct(tipo_rows, total_periodo),
        top_productos=add_pct(prod_rows, total_periodo),
        total_periodo=total_periodo,
        cantidad_ventas=cantidad_ventas,
        ticket_promedio=ticket_promedio,
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
        AND (:tipo_id IS NULL OR g.TipoGastoID = :tipo_id)
        AND (:categoria_id IS NULL OR gt.CategoriaID = :categoria_id)
    """

    serie_q = text(f"""
        SELECT
            CAST(g.Fecha AS DATE) as fecha,
            COALESCE(SUM(g.Monto), 0) as total
        FROM Gastos g
        LEFT JOIN GastoTipo gt ON g.TipoGastoID = gt.ID
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
        LEFT JOIN GastoTipo gt ON g.TipoGastoID = gt.ID
        LEFT JOIN GastoTipoCategoria gtc ON gt.CategoriaID = gtc.ID
        WHERE {base_where}
        GROUP BY gtc.Nombre, gt.Nombre
        ORDER BY total DESC
    """)

    por_metodo_q = text(f"""
        SELECT
            COALESCE(mp.Nombre, 'Sin método') as nombre,
            COALESCE(SUM(g.Monto), 0) as total
        FROM Gastos g
        LEFT JOIN MetodoPago mp ON g.MetodoPagoID = mp.ID
        LEFT JOIN GastoTipo gt ON g.TipoGastoID = gt.ID
        WHERE {base_where}
        GROUP BY mp.Nombre
        ORDER BY total DESC
    """)

    # Compare with ventas for the same period
    ventas_q = text("""
        SELECT COALESCE(SUM(vd.DineroDisponible), 0)
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.ID
        WHERE vc.FechaHora >= :desde AND vc.FechaHora < DATEADD(day, 1, :hasta)
    """)

    async with engine.connect() as conn:
        r_serie = await conn.execute(serie_q, params)
        serie_rows = _rows_to_dicts(r_serie)

        r_cat = await conn.execute(por_categoria_q, params)
        cat_rows = _rows_to_dicts(r_cat)

        r_metodo = await conn.execute(por_metodo_q, params)
        metodo_rows = _rows_to_dicts(r_metodo)

        r_ventas = await conn.execute(ventas_q, {"desde": fecha_desde, "hasta": fecha_hasta})
        ventas_total = float(r_ventas.scalar() or 0)

    for r in serie_rows:
        r["total"] = float(r.get("total", 0))
        r["fecha"] = str(r["fecha"])
    for r in cat_rows:
        r["total"] = float(r.get("total", 0))
    for r in metodo_rows:
        r["total"] = float(r.get("total", 0))

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
        por_metodo_pago=add_pct(metodo_rows, total_periodo),
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

    # Current stock per product (sum of all movements, optionally by local)
    stock_q = text("""
        SELECT
            p.ID as producto_id,
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            COALESCE(pt.Nombre, '') as talle,
            COALESCE(pc.Nombre, '') as color,
            COALESCE(SUM(
                CASE WHEN sm.TipoMovimiento IN ('entrada', 'compra', 'devolucion_cliente')
                     THEN sm.Cantidad
                     WHEN sm.TipoMovimiento IN ('salida', 'venta', 'devolucion_proveedor')
                     THEN -sm.Cantidad
                     ELSE 0 END
            ), 0) as stock_actual
        FROM Productos p
        LEFT JOIN ProductoNombre pn ON p.NombreID = pn.ID
        LEFT JOIN ProductoTalle pt ON p.TalleID = pt.ID
        LEFT JOIN ProductoColor pc ON p.ColorID = pc.ID
        LEFT JOIN StockMovimiento sm ON sm.ProductoID = p.ID
            AND (:local_id IS NULL OR sm.LocalID = :local_id)
        GROUP BY p.ID, pn.Nombre, pt.Nombre, pc.Nombre
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
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.ID
        WHERE vc.FechaHora >= :desde AND vc.FechaHora < DATEADD(day, 1, :hasta)
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
            "talle": row["talle"] or None,
            "color": row["color"] or None,
            "stock_actual": stock_actual,
            "unidades_vendidas_periodo": unidades,
            "rotacion": rotacion,
            "cobertura_dias": cobertura,
            "contribucion_pct": contribucion_pct,
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

    total_skus = len(productos)
    skus_sin_stock = sum(1 for p in productos if p.stock_actual == 0)
    skus_bajo_stock = len(bajo_stock)

    return StockResponse(
        productos=productos,
        bajo_stock=bajo_stock,
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
            CAST(cc.FechaHora AS DATE) as fecha,
            COALESCE(SUM(cd.Cantidad * cd.PrecioUnitario), 0) as total,
            COUNT(DISTINCT cc.ID) as cantidad
        FROM CompraDetalle cd
        INNER JOIN CompraCabecera cc ON cd.CompraID = cc.ID
        WHERE cc.FechaHora >= :desde AND cc.FechaHora < DATEADD(day, 1, :hasta)
            AND (:local_id IS NULL OR cc.LocalID = :local_id)
        GROUP BY CAST(cc.FechaHora AS DATE)
        ORDER BY fecha
    """)

    top_productos_q = text("""
        SELECT TOP 20
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            COALESCE(pt.Nombre, '') as talle,
            COALESCE(pc.Nombre, '') as color,
            COALESCE(SUM(cd.Cantidad * cd.PrecioUnitario), 0) as total,
            COALESCE(SUM(cd.Cantidad), 0) as cantidad
        FROM CompraDetalle cd
        INNER JOIN CompraCabecera cc ON cd.CompraID = cc.ID
        LEFT JOIN Productos p ON cd.ProductoID = p.ID
        LEFT JOIN ProductoNombre pn ON p.NombreID = pn.ID
        LEFT JOIN ProductoTalle pt ON p.TalleID = pt.ID
        LEFT JOIN ProductoColor pc ON p.ColorID = pc.ID
        WHERE cc.FechaHora >= :desde AND cc.FechaHora < DATEADD(day, 1, :hasta)
            AND (:local_id IS NULL OR cc.LocalID = :local_id)
        GROUP BY pn.Nombre, pt.Nombre, pc.Nombre
        ORDER BY total DESC
    """)

    async with engine.connect() as conn:
        r_serie = await conn.execute(serie_q, params)
        serie_rows = _rows_to_dicts(r_serie)

        r_prods = await conn.execute(top_productos_q, params)
        prod_rows = _rows_to_dicts(r_prods)

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

    return ComprasResponse(
        serie_temporal=serie_rows,
        top_productos=prod_rows,
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
        r_locales = await conn.execute(text("SELECT ID as id, Nombre as nombre FROM Locales ORDER BY Nombre"))
        locales = _rows_to_dicts(r_locales)

        r_metodos = await conn.execute(text("SELECT ID as id, Nombre as nombre FROM MetodoPago ORDER BY Nombre"))
        metodos = _rows_to_dicts(r_metodos)

        r_tipos_venta = await conn.execute(text(
            "SELECT DISTINCT TipoVenta FROM VentaCabecera WHERE TipoVenta IS NOT NULL ORDER BY TipoVenta"
        ))
        tipos_venta = [row[0] for row in r_tipos_venta.fetchall() if row[0]]

        r_talles = await conn.execute(text("SELECT ID as id, Nombre as nombre FROM ProductoTalle ORDER BY Nombre"))
        talles = _rows_to_dicts(r_talles)

        r_colores = await conn.execute(text("SELECT ID as id, Nombre as nombre FROM ProductoColor ORDER BY Nombre"))
        colores = _rows_to_dicts(r_colores)

        r_tipos_gasto = await conn.execute(text("SELECT ID as id, Nombre as nombre FROM GastoTipo ORDER BY Nombre"))
        tipos_gasto = _rows_to_dicts(r_tipos_gasto)

        r_cats_gasto = await conn.execute(text("SELECT ID as id, Nombre as nombre FROM GastoTipoCategoria ORDER BY Nombre"))
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
