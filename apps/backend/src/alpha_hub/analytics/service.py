"""
Analytics service: executes SQL queries against the tenant's Azure SQL database.
Uses asyncio.gather for parallel query execution to minimize latency.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from ..azure_db.service import get_db_config
from ..database.tenant import TenantConnectionRegistry
from . import forecast as fc
from .schemas import (
    AbcNombre,
    CompraItem,
    CompraItemsResponse,
    CompraOrden,
    ComprasResponse,
    FiltrosDisponibles,
    ForecastResponse,
    GastosResponse,
    KpiSummary,
    MasVendido,
    ProductForecast,
    ProductoStock,
    RotacionMensual,
    StockResponse,
    VentasPorFecha,
    VentasResponse,
)

logger = structlog.get_logger()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_engine(platform_session, tenant_id: str, registry: TenantConnectionRegistry) -> AsyncEngine:
    config = await get_db_config(platform_session, tenant_id)
    if not config or not config.vault_secret_id:
        raise ValueError(f"No Azure DB configuration for tenant {tenant_id}")
    return await registry.get_engine(tenant_id, str(config.vault_secret_id))


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _first_of_month() -> date:
    d = _today()
    return d.replace(day=1)


def _rows(result) -> list[dict[str, Any]]:
    keys = list(result.keys())
    return [dict(zip(keys, row)) for row in result.fetchall()]


def _add_pct(rows: list[dict], total: float) -> list[dict]:
    return [
        {**r, "pct": round(float(r.get("total", 0)) / total * 100, 1) if total else 0}
        for r in rows
    ]


async def _run(engine: AsyncEngine, query, params: dict | None = None):
    """Run a single query on its own connection (enables parallel execution)."""
    async with engine.connect() as conn:
        result = await conn.execute(query, params or {})
        return result


async def _run_safe(engine: AsyncEngine, query, params: dict | None = None) -> Any:
    """Run query, return None on error (for optional/fallback queries)."""
    try:
        return await _run(engine, query, params)
    except Exception:
        return None


# ── KPIs ──────────────────────────────────────────────────────────────────────

async def get_kpis(platform_session, tenant_id: str, registry: TenantConnectionRegistry) -> KpiSummary:
    engine = await _get_engine(platform_session, tenant_id, registry)
    today = _today()
    first = _first_of_month()

    q_hoy = text("SELECT COALESCE(SUM(vd.DineroDisponible),0) FROM VentaDetalle vd INNER JOIN VentaCabecera vc ON vd.VentaID=vc.VentaID WHERE CAST(vc.Fecha AS DATE)=:today")
    q_mes = text("SELECT COALESCE(SUM(vd.DineroDisponible),0), COUNT(DISTINCT vc.VentaID) FROM VentaDetalle vd INNER JOIN VentaCabecera vc ON vd.VentaID=vc.VentaID WHERE vc.Fecha>=:desde AND vc.Fecha<DATEADD(day,1,:hasta)")
    q_gas = text("SELECT COALESCE(SUM(Monto),0) FROM Gastos WHERE Fecha>=:desde AND Fecha<DATEADD(day,1,:hasta)")

    r_hoy, r_mes, r_gas = await asyncio.gather(
        _run(engine, q_hoy, {"today": today}),
        _run(engine, q_mes, {"desde": first, "hasta": today}),
        _run(engine, q_gas, {"desde": first, "hasta": today}),
    )

    ventas_hoy = float(r_hoy.scalar() or 0)
    row_mes = r_mes.fetchone()
    ventas_mes = float(row_mes[0] or 0) if row_mes else 0.0
    cant_mes = int(row_mes[1] or 0) if row_mes else 0
    gastos_mes = float(r_gas.scalar() or 0)

    return KpiSummary(
        ventas_hoy=ventas_hoy,
        ventas_mes=ventas_mes,
        gastos_mes=gastos_mes,
        margen_mes=ventas_mes - gastos_mes,
        cantidad_ventas_mes=cant_mes,
        ticket_promedio=ventas_mes / cant_mes if cant_mes else 0.0,
    )


# ── Ventas ────────────────────────────────────────────────────────────────────

async def get_ventas(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    local_id: int | None = None,
    metodo_pago_ids: str | None = None,   # comma-separated IDs
    tipo_venta: str | None = None,
    producto_nombre: str | None = None,
    talle_id: int | None = None,
    color_id: int | None = None,
) -> VentasResponse:
    engine = await _get_engine(platform_session, tenant_id, registry)
    fecha_desde = fecha_desde or _first_of_month()
    fecha_hasta = fecha_hasta or _today()

    params: dict[str, Any] = {
        "desde": fecha_desde,
        "hasta": fecha_hasta,
        "local_id": local_id,
        "tipo_venta": tipo_venta,
        "talle_id": talle_id,
        "color_id": color_id,
        "producto_nombre": f"%{producto_nombre}%" if producto_nombre else None,
    }

    # Build payment method filter (supports multi-select)
    if metodo_pago_ids:
        metodo_where = f"AND vd.MetodoPagoID IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT('{metodo_pago_ids}', ','))"
    else:
        metodo_where = ""

    base_where = f"""
        vc.Fecha >= :desde AND vc.Fecha < DATEADD(day, 1, :hasta)
        AND (:local_id IS NULL OR vc.LocalID = :local_id)
        {metodo_where}
        AND (:tipo_venta IS NULL OR vc.TipoVenta = :tipo_venta)
        AND (:talle_id IS NULL OR p.ProductoTalleId = :talle_id)
        AND (:color_id IS NULL OR p.ProductoColorId = :color_id)
        AND (:producto_nombre IS NULL OR pn.Nombre LIKE :producto_nombre)
    """

    # WHERE without product name filter (for pct_del_total calculation)
    base_where_sin_nombre = f"""
        vc.Fecha >= :desde AND vc.Fecha < DATEADD(day, 1, :hasta)
        AND (:local_id IS NULL OR vc.LocalID = :local_id)
        {metodo_where}
        AND (:tipo_venta IS NULL OR vc.TipoVenta = :tipo_venta)
        AND (:talle_id IS NULL OR p.ProductoTalleId = :talle_id)
        AND (:color_id IS NULL OR p.ProductoColorId = :color_id)
    """

    joins = """
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        LEFT JOIN Productos p ON vd.ProductoID = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
    """

    serie_q = text(f"SELECT CAST(vc.Fecha AS DATE) as fecha, COALESCE(SUM(vd.DineroDisponible),0) as total, COUNT(DISTINCT vc.VentaID) as cantidad {joins} WHERE {base_where} GROUP BY CAST(vc.Fecha AS DATE) ORDER BY fecha")
    local_q = text(f"SELECT COALESCE(l.Nombre,'Sin local') as nombre, COALESCE(SUM(vd.DineroDisponible),0) as total {joins} LEFT JOIN Locales l ON vc.LocalID=l.LocalID WHERE {base_where} GROUP BY l.Nombre ORDER BY total DESC")
    metodo_q = text(f"SELECT COALESCE(mp.Nombre,'Sin método') as nombre, COALESCE(SUM(vd.DineroDisponible),0) as total {joins} LEFT JOIN MetodoPago mp ON vd.MetodoPagoID=mp.MetodoPagoID WHERE {base_where} GROUP BY mp.Nombre ORDER BY total DESC")
    tipo_q = text(f"SELECT COALESCE(vc.TipoVenta,'Sin tipo') as tipo, COALESCE(SUM(vd.DineroDisponible),0) as total {joins} WHERE {base_where} GROUP BY vc.TipoVenta ORDER BY total DESC")

    # Top products with ProductoDescripcion join
    top_prod_q = text(f"""
        SELECT TOP 30
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            COALESCE(pd.Descripcion, '') as descripcion,
            COALESCE(pt.Talle, '') as talle,
            COALESCE(pc.Color, '') as color,
            COALESCE(SUM(vd.DineroDisponible), 0) as total,
            COALESCE(SUM(vd.Cantidad), 0) as cantidad
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        LEFT JOIN Productos p ON vd.ProductoID = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        WHERE {base_where}
        GROUP BY pn.Nombre, pd.Descripcion, pt.Talle, pc.Color
        ORDER BY total DESC
    """)

    top_nombre_q = text(f"""
        SELECT TOP 30
            COALESCE(pn.Nombre,'Sin nombre') as nombre,
            COALESCE(SUM(vd.DineroDisponible),0) as total,
            COALESCE(SUM(vd.Cantidad),0) as cantidad
        {joins} WHERE {base_where} GROUP BY pn.Nombre ORDER BY total DESC
    """)

    # Top by descripcion (nombre + descripcion aggregated)
    top_desc_q = text(f"""
        SELECT TOP 30
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            COALESCE(pd.Descripcion, '') as descripcion,
            COALESCE(SUM(vd.DineroDisponible), 0) as total,
            COALESCE(SUM(vd.Cantidad), 0) as cantidad
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        LEFT JOIN Productos p ON vd.ProductoID = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        WHERE {base_where}
        GROUP BY pn.Nombre, pd.Descripcion
        ORDER BY total DESC
    """)

    # CMV: latest purchase cost per product × units sold (CTE avoids N+1 subquery)
    cmv_q = text(f"""
        WITH UltimoCosto AS (
            SELECT
                cd.ProductoId,
                cd.CostoUnitario,
                ROW_NUMBER() OVER (PARTITION BY cd.ProductoId ORDER BY cc.Fecha DESC) as rn
            FROM CompraDetalle cd
            INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
            WHERE cd.CostoUnitario IS NOT NULL AND cd.CostoUnitario > 0
        )
        SELECT COALESCE(SUM(vd.Cantidad * ISNULL(uc.CostoUnitario, 0)), 0) as cmv
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        LEFT JOIN Productos p ON vd.ProductoID = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN UltimoCosto uc ON uc.ProductoId = vd.ProductoID AND uc.rn = 1
        WHERE {base_where}
    """)

    # Gross billed: try PrecioUnitario * Cantidad first, fall back to DineroDisponible
    bruto_q = text(f"""
        SELECT COALESCE(SUM(vd.PrecioUnitario * vd.Cantidad),0) as bruto {joins} WHERE {base_where}
    """)

    # Payment commissions
    comision_q = text(f"""
        SELECT COALESCE(SUM(vd.DineroDisponible * mp.Comision / 100.0),0) as comisiones
        {joins} LEFT JOIN MetodoPago mp ON vd.MetodoPagoID=mp.MetodoPagoID WHERE {base_where}
    """)

    # Credit sales: try PrecioUnitario first, fallback to DineroDisponible
    cuenta_q1 = text(f"""
        SELECT COALESCE(SUM(vd.PrecioUnitario * vd.Cantidad),0) as vendido_cuenta,
               COUNT(DISTINCT vc.VentaID) as cantidad_cuenta
        {joins} WHERE {base_where}
        AND LOWER(vc.TipoVenta) IN ('cuenta','ctacte','cuentacorriente','cuenta corriente','credito','crédito','fiado')
    """)
    cuenta_q2 = text(f"""
        SELECT COALESCE(SUM(vd.DineroDisponible),0) as vendido_cuenta,
               COUNT(DISTINCT vc.VentaID) as cantidad_cuenta
        {joins} WHERE {base_where}
        AND LOWER(vc.TipoVenta) IN ('cuenta','ctacte','cuentacorriente','cuenta corriente','credito','crédito','fiado')
    """)

    # Grand total without product name filter (for pct_del_total)
    params_sin_nombre = {k: v for k, v in params.items() if k != "producto_nombre"}
    grand_q = text(f"""
        SELECT COALESCE(SUM(vd.DineroDisponible),0) {joins}
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        WHERE {base_where_sin_nombre}
    """)

    # Run all independent queries in parallel
    results = await asyncio.gather(
        _run(engine, serie_q, params),
        _run(engine, local_q, params),
        _run(engine, metodo_q, params),
        _run(engine, tipo_q, params),
        _run_safe(engine, top_prod_q, params),
        _run(engine, top_nombre_q, params),
        _run_safe(engine, top_desc_q, params),
        _run_safe(engine, cmv_q, params),
        _run_safe(engine, bruto_q, params),
        _run_safe(engine, comision_q, params),
        _run_safe(engine, grand_q, params_sin_nombre),
    )

    r_serie, r_local, r_metodo, r_tipo, r_prods, r_nombre, r_desc, r_cmv, r_bruto, r_comision, r_grand = results

    serie = [VentasPorFecha(fecha=str(row[0]), total=float(row[1] or 0), cantidad=int(row[2] or 0)) for row in r_serie.fetchall()]
    local_rows = _rows(r_local)
    metodo_rows = _rows(r_metodo)
    tipo_rows = _rows(r_tipo)
    prod_rows = _rows(r_prods) if r_prods else []
    nombre_rows = _rows(r_nombre)
    desc_rows = _rows(r_desc) if r_desc else []

    for r in local_rows + metodo_rows + tipo_rows:
        r["total"] = float(r.get("total", 0))
    for r in prod_rows + nombre_rows + desc_rows:
        r["total"] = float(r.get("total", 0))
        r["cantidad"] = int(r.get("cantidad", 0))

    total_periodo = sum(s.total for s in serie)
    cant_ventas = sum(s.cantidad for s in serie)

    cmv = float(r_cmv.scalar() or 0) if r_cmv else 0.0
    comisiones = float(r_comision.scalar() or 0) if r_comision else 0.0

    facturado_bruto = total_periodo
    if r_bruto:
        try:
            v = float(r_bruto.scalar() or 0)
            if v > 0:
                facturado_bruto = v
        except Exception:
            pass

    # Credit sales: try PrecioUnitario version first, fallback to DineroDisponible
    vendido_cuenta = 0.0
    cant_cuenta = 0
    for cq in [cuenta_q1, cuenta_q2]:
        try:
            r_cta = await _run(engine, cq, params)
            row = r_cta.fetchone()
            if row and float(row[0] or 0) > 0:
                vendido_cuenta = float(row[0] or 0)
                cant_cuenta = int(row[1] or 0)
                break
        except Exception:
            continue

    # Collections on credit accounts
    cobros_cuenta = 0.0
    for tbl in ["CobrosCtaCte", "CobroCuentaCorriente", "CobrosCtaCorriente", "CobroCtaCte", "PagosCtaCte"]:
        r_cobros = await _run_safe(engine, text(f"""
            SELECT COALESCE(SUM(Monto),0) FROM {tbl}
            WHERE Fecha>=:desde AND Fecha<DATEADD(day,1,:hasta)
            AND (:local_id IS NULL OR LocalID=:local_id)
        """), {"desde": fecha_desde, "hasta": fecha_hasta, "local_id": local_id})
        if r_cobros is not None:
            val = r_cobros.scalar()
            if val and float(val) > 0:
                cobros_cuenta = float(val)
                break

    # pct_del_total
    pct_del_total: float | None = None
    if producto_nombre and r_grand:
        grand_total = float(r_grand.scalar() or 0)
        if grand_total > 0:
            pct_del_total = round(total_periodo / grand_total * 100, 1)

    return VentasResponse(
        serie_temporal=serie,
        por_local=_add_pct(local_rows, total_periodo),
        por_metodo_pago=_add_pct(metodo_rows, total_periodo),
        por_tipo_venta=_add_pct(tipo_rows, total_periodo),
        top_productos=_add_pct(prod_rows, total_periodo),
        top_por_nombre=_add_pct(nombre_rows, total_periodo),
        top_por_descripcion=_add_pct(desc_rows, total_periodo),
        total_periodo=total_periodo,
        facturado_bruto=round(facturado_bruto, 2),
        cantidad_ventas=cant_ventas,
        ticket_promedio=total_periodo / cant_ventas if cant_ventas else 0.0,
        cmv=round(cmv, 2),
        comisiones=round(comisiones, 2),
        vendido_cuenta=round(vendido_cuenta, 2),
        cantidad_cuenta=cant_cuenta,
        cobros_cuenta=round(cobros_cuenta, 2),
        pct_del_total=pct_del_total,
    )


# ── Gastos ────────────────────────────────────────────────────────────────────

async def get_gastos(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    local_id: int | None = None,
    metodo_pago_ids: str | None = None,
    tipo_id: int | None = None,
    categoria_id: int | None = None,
) -> GastosResponse:
    engine = await _get_engine(platform_session, tenant_id, registry)
    fecha_desde = fecha_desde or _first_of_month()
    fecha_hasta = fecha_hasta or _today()

    if metodo_pago_ids:
        metodo_where = f"AND g.MetodoPagoID IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT('{metodo_pago_ids}', ','))"
    else:
        metodo_where = ""

    params: dict[str, Any] = {
        "desde": fecha_desde,
        "hasta": fecha_hasta,
        "local_id": local_id,
        "tipo_id": tipo_id,
        "categoria_id": categoria_id,
    }

    base_where = f"""
        g.Fecha >= :desde AND g.Fecha < DATEADD(day,1,:hasta)
        AND (:local_id IS NULL OR g.LocalID=:local_id)
        {metodo_where}
        AND (:tipo_id IS NULL OR g.GastoTipoID=:tipo_id)
        AND (:categoria_id IS NULL OR gt.GastoTipoCategoriaID=:categoria_id)
    """

    serie_q = text(f"SELECT CAST(g.Fecha AS DATE) as fecha, COALESCE(SUM(g.Monto),0) as total FROM Gastos g LEFT JOIN GastoTipo gt ON g.GastoTipoID=gt.GastoTipoID WHERE {base_where} GROUP BY CAST(g.Fecha AS DATE) ORDER BY fecha")
    tipo_q = text(f"SELECT COALESCE(gt.Nombre,'Sin tipo') as tipo, COALESCE(SUM(g.Monto),0) as total FROM Gastos g LEFT JOIN GastoTipo gt ON g.GastoTipoID=gt.GastoTipoID WHERE {base_where} GROUP BY gt.Nombre ORDER BY total DESC")
    cat_q = text(f"SELECT COALESCE(gtc.Nombre,'Sin categoría') as categoria, COALESCE(gt.Nombre,'Sin tipo') as tipo, COALESCE(SUM(g.Monto),0) as total FROM Gastos g LEFT JOIN GastoTipo gt ON g.GastoTipoID=gt.GastoTipoID LEFT JOIN GastoTipoCategoria gtc ON gt.GastoTipoCategoriaID=gtc.GastoTipoCategoriaID WHERE {base_where} GROUP BY gtc.Nombre, gt.Nombre ORDER BY total DESC")
    metodo_q = text(f"SELECT COALESCE(mp.Nombre,'Sin método') as nombre, COALESCE(SUM(g.Monto),0) as total FROM Gastos g LEFT JOIN MetodoPago mp ON g.MetodoPagoID=mp.MetodoPagoID LEFT JOIN GastoTipo gt ON g.GastoTipoID=gt.GastoTipoID WHERE {base_where} GROUP BY mp.Nombre ORDER BY total DESC")

    # Detalle with Descripcion column; fallback without it if column doesn't exist
    detalle_q = text(f"""
        SELECT TOP 200 CAST(g.Fecha AS DATE) as fecha, COALESCE(gt.Nombre,'Sin tipo') as tipo,
            COALESCE(gtc.Nombre,'Sin categoría') as categoria,
            COALESCE(mp.Nombre,'Sin método') as metodo_pago, g.Monto as monto,
            COALESCE(g.Descripcion,'') as descripcion
        FROM Gastos g
        LEFT JOIN GastoTipo gt ON g.GastoTipoID=gt.GastoTipoID
        LEFT JOIN GastoTipoCategoria gtc ON gt.GastoTipoCategoriaID=gtc.GastoTipoCategoriaID
        LEFT JOIN MetodoPago mp ON g.MetodoPagoID=mp.MetodoPagoID
        WHERE {base_where} ORDER BY g.Fecha DESC, g.GastoID DESC
    """)
    detalle_q_fallback = text(f"""
        SELECT TOP 200 CAST(g.Fecha AS DATE) as fecha, COALESCE(gt.Nombre,'Sin tipo') as tipo,
            COALESCE(gtc.Nombre,'Sin categoría') as categoria,
            COALESCE(mp.Nombre,'Sin método') as metodo_pago, g.Monto as monto, '' as descripcion
        FROM Gastos g
        LEFT JOIN GastoTipo gt ON g.GastoTipoID=gt.GastoTipoID
        LEFT JOIN GastoTipoCategoria gtc ON gt.GastoTipoCategoriaID=gtc.GastoTipoCategoriaID
        LEFT JOIN MetodoPago mp ON g.MetodoPagoID=mp.MetodoPagoID
        WHERE {base_where} ORDER BY g.Fecha DESC, g.GastoID DESC
    """)
    ventas_q = text("SELECT COALESCE(SUM(vd.DineroDisponible),0) FROM VentaDetalle vd INNER JOIN VentaCabecera vc ON vd.VentaID=vc.VentaID WHERE vc.Fecha>=:desde AND vc.Fecha<DATEADD(day,1,:hasta)")

    r_serie, r_tipo, r_cat, r_metodo, r_ventas = await asyncio.gather(
        _run(engine, serie_q, params),
        _run(engine, tipo_q, params),
        _run(engine, cat_q, params),
        _run(engine, metodo_q, params),
        _run(engine, ventas_q, {"desde": fecha_desde, "hasta": fecha_hasta}),
    )
    # Detalle with fallback for Descripcion column
    r_detalle = await _run_safe(engine, detalle_q, params)
    if r_detalle is None:
        r_detalle = await _run_safe(engine, detalle_q_fallback, params)

    serie_rows = _rows(r_serie)
    tipo_rows = _rows(r_tipo)
    cat_rows = _rows(r_cat)
    metodo_rows = _rows(r_metodo)
    detalle_rows = _rows(r_detalle) if r_detalle else []

    for r in serie_rows:
        r["total"] = float(r.get("total", 0))
        r["fecha"] = str(r["fecha"])
    for r in tipo_rows + cat_rows + metodo_rows:
        r["total"] = float(r.get("total", 0))
    for r in detalle_rows:
        r["monto"] = float(r.get("monto", 0))
        r["fecha"] = str(r["fecha"])

    total_periodo = sum(float(r.get("total", 0)) for r in serie_rows)
    ventas_total = float(r_ventas.scalar() or 0)
    ratio_ventas = round(total_periodo / ventas_total * 100, 1) if ventas_total else None

    return GastosResponse(
        serie_temporal=serie_rows,
        por_tipo=_add_pct(tipo_rows, total_periodo),
        por_categoria=_add_pct(cat_rows, total_periodo),
        por_metodo_pago=_add_pct(metodo_rows, total_periodo),
        detalle_gastos=detalle_rows,
        total_periodo=total_periodo,
        ratio_ventas=ratio_ventas,
    )


# ── Stock ─────────────────────────────────────────────────────────────────────

async def get_stock(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    local_id: int | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
) -> StockResponse:
    engine = await _get_engine(platform_session, tenant_id, registry)
    fecha_desde = fecha_desde or _first_of_month()
    fecha_hasta = fecha_hasta or _today()
    dias_periodo = max((fecha_hasta - fecha_desde).days, 1)
    period_length = (fecha_hasta - fecha_desde).days + 1
    prev_desde = fecha_desde - timedelta(days=period_length)
    prev_hasta = fecha_desde - timedelta(days=1)

    params: dict[str, Any] = {
        "desde": fecha_desde,
        "hasta": fecha_hasta,
        "local_id": local_id,
    }

    # Current stock + last purchase cost per product (with ProductoDescripcion)
    stock_q = text("""
        WITH UltimoCosto AS (
            SELECT
                cd.ProductoId,
                cd.CostoUnitario,
                ROW_NUMBER() OVER (PARTITION BY cd.ProductoId ORDER BY cc.Fecha DESC) as rn
            FROM CompraDetalle cd
            INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
            WHERE cd.CostoUnitario IS NOT NULL AND cd.CostoUnitario > 0
        )
        SELECT
            p.ProductoID as producto_id,
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            COALESCE(pd.Descripcion, '') as descripcion,
            COALESCE(pt.Talle, '') as talle,
            COALESCE(pc.Color, '') as color,
            COALESCE(SUM(
                CASE WHEN sm.TipoMovimiento IN ('entrada', 'compra', 'devolucion_cliente')
                     THEN sm.Cantidad
                     WHEN sm.TipoMovimiento IN ('salida', 'venta', 'devolucion_proveedor')
                     THEN -sm.Cantidad
                     ELSE 0 END
            ), 0) as stock_actual,
            ISNULL(MAX(uc.CostoUnitario), 0) as precio_costo
        FROM Productos p
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        LEFT JOIN StockMovimiento sm ON sm.ProductoID = p.ProductoID
        LEFT JOIN UltimoCosto uc ON uc.ProductoId = p.ProductoID AND uc.rn = 1
        WHERE (:local_id IS NULL OR p.LocalID = :local_id)
        GROUP BY p.ProductoID, pn.Nombre, pd.Descripcion, pt.Talle, pc.Color
        HAVING SUM(
            CASE WHEN sm.TipoMovimiento IN ('entrada', 'compra', 'devolucion_cliente')
                 THEN sm.Cantidad
                 WHEN sm.TipoMovimiento IN ('salida', 'venta', 'devolucion_proveedor')
                 THEN -sm.Cantidad
                 ELSE 0 END
        ) >= 0
        ORDER BY stock_actual DESC
    """)

    # Fallback if CTE/ProductoDescripcion unavailable
    stock_q_fallback = text("""
        SELECT
            p.ProductoID as producto_id,
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            '' as descripcion,
            COALESCE(pt.Talle, '') as talle,
            COALESCE(pc.Color, '') as color,
            COALESCE(SUM(
                CASE WHEN sm.TipoMovimiento IN ('entrada', 'compra', 'devolucion_cliente')
                     THEN sm.Cantidad
                     WHEN sm.TipoMovimiento IN ('salida', 'venta', 'devolucion_proveedor')
                     THEN -sm.Cantidad
                     ELSE 0 END
            ), 0) as stock_actual,
            0 as precio_costo
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

    ventas_q = text("SELECT vd.ProductoID, COALESCE(SUM(vd.Cantidad),0), COALESCE(SUM(vd.DineroDisponible),0) FROM VentaDetalle vd INNER JOIN VentaCabecera vc ON vd.VentaID=vc.VentaID WHERE vc.Fecha>=:desde AND vc.Fecha<DATEADD(day,1,:hasta) AND (:local_id IS NULL OR vc.LocalID=:local_id) GROUP BY vd.ProductoID")
    prev_q = text("SELECT vd.ProductoID, COALESCE(SUM(vd.Cantidad),0) FROM VentaDetalle vd INNER JOIN VentaCabecera vc ON vd.VentaID=vc.VentaID WHERE vc.Fecha>=:prev_desde AND vc.Fecha<DATEADD(day,1,:prev_hasta) AND (:local_id IS NULL OR vc.LocalID=:local_id) GROUP BY vd.ProductoID")
    bajo_q = text("SELECT TOP 20 * FROM vw_ProductosBajoStock")

    # Monthly ventas + compras for last 13 months (for rotation reconstruction)
    monthly_ventas_q = text("""
        SELECT
            YEAR(vc.Fecha) as yr,
            MONTH(vc.Fecha) as mo,
            COALESCE(SUM(vd.Cantidad), 0) as ventas_u,
            COALESCE(SUM(vd.DineroDisponible), 0) as revenue
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        WHERE vc.Fecha >= DATEADD(month, -12, :hasta) AND vc.Fecha < DATEADD(day, 1, :hasta)
            AND (:local_id IS NULL OR vc.LocalID = :local_id)
        GROUP BY YEAR(vc.Fecha), MONTH(vc.Fecha)
    """)

    monthly_compras_q = text("""
        SELECT
            YEAR(cc.Fecha) as yr,
            MONTH(cc.Fecha) as mo,
            COALESCE(SUM(cd.Cantidad), 0) as compras_u,
            COALESCE(SUM(cd.Subtotal), 0) as compras_monto
        FROM CompraDetalle cd
        INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
        WHERE cc.Fecha >= DATEADD(month, -12, :hasta) AND cc.Fecha < DATEADD(day, 1, :hasta)
            AND (:local_id IS NULL OR cc.LocalId = :local_id)
        GROUP BY YEAR(cc.Fecha), MONTH(cc.Fecha)
    """)

    # CMV for calce financiero
    cmv_stock_q = text("""
        WITH UltimoCosto AS (
            SELECT cd.ProductoId, cd.CostoUnitario,
                   ROW_NUMBER() OVER (PARTITION BY cd.ProductoId ORDER BY cc.Fecha DESC) as rn
            FROM CompraDetalle cd
            INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
            WHERE cd.CostoUnitario IS NOT NULL AND cd.CostoUnitario > 0
        )
        SELECT COALESCE(SUM(vd.Cantidad * ISNULL(uc.CostoUnitario, 0)), 0) as cmv
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        LEFT JOIN UltimoCosto uc ON uc.ProductoId = vd.ProductoID AND uc.rn = 1
        WHERE vc.Fecha >= :desde AND vc.Fecha < DATEADD(day, 1, :hasta)
            AND (:local_id IS NULL OR vc.LocalID = :local_id)
    """)

    # Compras in current period (for calce financiero numerator)
    compras_periodo_q = text("""
        SELECT COALESCE(SUM(cd.Subtotal), 0) as total
        FROM CompraDetalle cd
        INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
        WHERE cc.Fecha >= :desde AND cc.Fecha < DATEADD(day, 1, :hasta)
            AND (:local_id IS NULL OR cc.LocalId = :local_id)
    """)

    # Execute main queries in parallel
    r_stock_raw, r_ventas, r_prev, r_bajo = await asyncio.gather(
        _run_safe(engine, stock_q, {"local_id": local_id}),
        _run(engine, ventas_q, params),
        _run(engine, prev_q, {"prev_desde": prev_desde, "prev_hasta": prev_hasta, "local_id": local_id}),
        _run_safe(engine, bajo_q),
    )

    if r_stock_raw is None:
        r_stock_raw = await _run(engine, stock_q_fallback, {"local_id": local_id})

    # Optional enrichment queries
    r_mv, r_mc, r_cmv_stock, r_cp = await asyncio.gather(
        _run_safe(engine, monthly_ventas_q, {"hasta": fecha_hasta, "local_id": local_id}),
        _run_safe(engine, monthly_compras_q, {"hasta": fecha_hasta, "local_id": local_id}),
        _run_safe(engine, cmv_stock_q, params),
        _run_safe(engine, compras_periodo_q, params),
    )

    stock_rows = _rows(r_stock_raw)
    ventas_dict: dict[int, dict] = {int(row[0]): {"u": int(row[1] or 0), "rev": float(row[2] or 0)} for row in r_ventas.fetchall()}
    prev_dict: dict[int, int] = {int(row[0]): int(row[1] or 0) for row in r_prev.fetchall()}
    bajo_stock = _rows(r_bajo) if r_bajo else []
    monthly_ventas_rows = _rows(r_mv) if r_mv else []
    monthly_compras_rows = _rows(r_mc) if r_mc else []
    cmv_stock = float(r_cmv_stock.scalar() or 0) if r_cmv_stock else 0.0
    compras_periodo_total = float(r_cp.scalar() or 0) if r_cp else 0.0

    total_rev = sum(v["rev"] for v in ventas_dict.values())
    productos_data: list[tuple[float, dict]] = []

    for row in stock_rows:
        pid = int(row["producto_id"])
        v = ventas_dict.get(pid, {"u": 0, "rev": 0.0})
        prev_u = prev_dict.get(pid, 0)
        stock = int(row["stock_actual"])
        costo = float(row.get("precio_costo", 0) or 0)
        units = v["u"]
        rev = v["rev"]
        monto_stock = stock * costo
        rotacion = round(units / max(stock, 1), 2) if stock > 0 else 0.0
        rot_anual = round((units / dias_periodo) * 365 / stock, 2) if stock > 0 and dias_periodo > 0 else 0.0
        avg_daily = units / dias_periodo if dias_periodo > 0 else 0.0
        cob = round(stock / avg_daily, 1) if avg_daily > 0 else 9999.0
        growth = (units - prev_u) / prev_u if prev_u > 0 else 0.0
        adj_daily = avg_daily * max(1.0 + growth, 0.1)
        cob_adj = round(stock / adj_daily, 1) if adj_daily > 0 else 9999.0
        contrib = round(rev / total_rev * 100, 2) if total_rev > 0 else 0.0
        productos_data.append((rev, {
            "producto_id": pid,
            "nombre": row["nombre"],
            "descripcion": row.get("descripcion") or None,
            "talle": row["talle"] or None,
            "color": row["color"] or None,
            "stock_actual": stock,
            "precio_costo": costo,
            "monto_stock": round(monto_stock, 2),
            "unidades_vendidas_periodo": units,
            "rotacion": rotacion,
            "rotacion_anualizada": rot_anual,
            "cobertura_dias": cob,
            "cobertura_ajustada": cob_adj,
            "contribucion_pct": contrib,
            "es_substock": cob < 7 and avg_daily > 0,
            "es_sobrestock": cob > 90 and units > 0,
        }))

    productos_data.sort(key=lambda x: x[0], reverse=True)

    # ABC por descripción
    acum = 0.0
    productos: list[ProductoStock] = []
    for rev, p in productos_data:
        acum += rev
        pct_a = acum / total_rev * 100 if total_rev > 0 else 100
        abc = "A" if pct_a <= 80 else ("B" if pct_a <= 95 else "C")
        productos.append(ProductoStock(**p, clasificacion_abc=abc))

    # ABC por nombre
    n_agg: dict[str, dict] = {}
    for rev, p in productos_data:
        nm = p["nombre"]
        if nm not in n_agg:
            n_agg[nm] = {"nombre": nm, "stock_total": 0, "monto_stock": 0.0, "unidades_vendidas": 0, "revenue": 0.0}
        n_agg[nm]["stock_total"] += p["stock_actual"]
        n_agg[nm]["monto_stock"] += p["monto_stock"]
        n_agg[nm]["unidades_vendidas"] += p["unidades_vendidas_periodo"]
        n_agg[nm]["revenue"] += rev

    acum_n = 0.0
    abc_por_nombre: list[AbcNombre] = []
    for ag in sorted(n_agg.values(), key=lambda x: x["revenue"], reverse=True):
        acum_n += ag["revenue"]
        pct_n = acum_n / total_rev * 100 if total_rev > 0 else 100
        abc_n = "A" if pct_n <= 80 else ("B" if pct_n <= 95 else "C")
        avg_d_n = ag["unidades_vendidas"] / dias_periodo if dias_periodo > 0 else 0
        abc_por_nombre.append(AbcNombre(
            nombre=ag["nombre"],
            stock_total=ag["stock_total"],
            monto_stock=round(ag["monto_stock"], 2),
            unidades_vendidas=ag["unidades_vendidas"],
            revenue=ag["revenue"],
            rotacion=round(ag["unidades_vendidas"] / max(ag["stock_total"], 1), 2) if ag["stock_total"] > 0 else 0.0,
            cobertura_dias=round(ag["stock_total"] / avg_d_n, 1) if avg_d_n > 0 else 9999.0,
            contribucion_pct=round(ag["revenue"] / total_rev * 100, 2) if total_rev > 0 else 0.0,
            clasificacion_abc=abc_n,
        ))

    # Más vendidos
    mas_vendidos: list[MasVendido] = []
    for _, p in sorted([(r, d) for r, d in productos_data if d["unidades_vendidas_periodo"] > 0],
                       key=lambda x: x[1]["unidades_vendidas_periodo"], reverse=True)[:30]:
        desc_parts = [p["nombre"]]
        if p.get("descripcion"):
            desc_parts.append(p["descripcion"])
        if p.get("talle"):
            desc_parts.append(p["talle"])
        if p.get("color"):
            desc_parts.append(p["color"])
        desc = " · ".join(desc_parts)
        cob = p["cobertura_dias"]
        mas_vendidos.append(MasVendido(
            nombre=p["nombre"],
            descripcion=desc,
            unidades_vendidas=p["unidades_vendidas_periodo"],
            stock_actual=p["stock_actual"],
            cobertura_dias=cob,
            alerta_stock=cob < 14 or (p["unidades_vendidas_periodo"] > 0 and p["stock_actual"] < p["unidades_vendidas_periodo"] * 0.3),
        ))

    tot_stock_u = sum(p.stock_actual for p in productos)
    tot_vendidas_u = sum(p.unidades_vendidas_periodo for p in productos)
    avg_d_gen = tot_vendidas_u / dias_periodo if dias_periodo > 0 else 0.0
    cobertura_general = round(tot_stock_u / avg_d_gen, 1) if avg_d_gen > 0 else 9999.0

    # Calce financiero: days to recover purchase investment using daily CMV
    cmv_diario = cmv_stock / dias_periodo if dias_periodo > 0 else 0.0
    calce_financiero = round(compras_periodo_total / cmv_diario, 1) if cmv_diario > 0 else 0.0

    # Monthly rotation reconstruction
    MES_LABELS = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

    mv_dict: dict[tuple[int, int], dict] = {}
    for r in monthly_ventas_rows:
        yr, mo = int(r["yr"]), int(r["mo"])
        mv_dict[(yr, mo)] = {"ventas_u": int(r.get("ventas_u") or 0), "revenue": float(r.get("revenue") or 0)}

    mc_dict: dict[tuple[int, int], dict] = {}
    for r in monthly_compras_rows:
        yr, mo = int(r["yr"]), int(r["mo"])
        mc_dict[(yr, mo)] = {"compras_u": int(r.get("compras_u") or 0)}

    today_dt = fecha_hasta
    months_to_compute: list[tuple[int, int]] = []
    yr_it, mo_it = today_dt.year, today_dt.month
    for _ in range(12):
        months_to_compute.append((yr_it, mo_it))
        mo_it -= 1
        if mo_it == 0:
            mo_it = 12
            yr_it -= 1
    months_to_compute.reverse()  # oldest first

    # Backwards stock reconstruction
    stock_ends: dict[tuple[int, int], int] = {}
    s = tot_stock_u
    for ym in reversed(months_to_compute):
        stock_ends[ym] = s
        v = mv_dict.get(ym, {}).get("ventas_u", 0)
        c = mc_dict.get(ym, {}).get("compras_u", 0)
        s = max(s - c + v, 0)

    rotacion_por_mes: list[RotacionMensual] = []
    for ym in months_to_compute:
        yr_m, mo_m = ym
        v = mv_dict.get(ym, {}).get("ventas_u", 0)
        c = mc_dict.get(ym, {}).get("compras_u", 0)
        rev = mv_dict.get(ym, {}).get("revenue", 0.0)
        stock_end_m = stock_ends[ym]
        stock_start_m = max(stock_end_m - c + v, 0)
        avg_stock_m = (stock_start_m + stock_end_m) / 2 if (stock_start_m + stock_end_m) > 0 else 1
        rot_m = round(v / avg_stock_m, 2) if avg_stock_m > 0 else 0.0
        rotacion_por_mes.append(RotacionMensual(
            anio=yr_m,
            mes=mo_m,
            label=f"{MES_LABELS[mo_m]} {yr_m}",
            ventas_unidades=v,
            compras_unidades=c,
            stock_estimado=int((stock_start_m + stock_end_m) / 2),
            rotacion=rot_m,
            revenue=rev,
        ))

    rot_meses_con_ventas = [rm.rotacion for rm in rotacion_por_mes[-6:] if rm.ventas_unidades > 0]
    rotacion_mensual_promedio = round(
        sum(rot_meses_con_ventas) / len(rot_meses_con_ventas), 2
    ) if rot_meses_con_ventas else 0.0

    return StockResponse(
        productos=productos,
        abc_por_nombre=abc_por_nombre,
        mas_vendidos=mas_vendidos,
        bajo_stock=bajo_stock,
        monto_total_stock=round(sum(p.monto_stock for p in productos), 2),
        rotacion_general=round(tot_vendidas_u / max(tot_stock_u, 1), 2) if tot_stock_u > 0 else 0.0,
        rotacion_mensual_promedio=rotacion_mensual_promedio,
        cobertura_general=cobertura_general,
        calce_financiero=calce_financiero,
        skus_sin_stock=sum(1 for p in productos if p.stock_actual == 0),
        skus_bajo_stock=len(bajo_stock),
        substock_count=sum(1 for p in productos if p.es_substock),
        sobrestock_count=sum(1 for p in productos if p.es_sobrestock),
        rotacion_por_mes=rotacion_por_mes,
    )


# ── Stock Forecast ─────────────────────────────────────────────────────────────

async def get_stock_forecast(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    local_id: int | None = None,
) -> ForecastResponse:
    engine = await _get_engine(platform_session, tenant_id, registry)
    hoy = _today()
    desde = hoy - timedelta(days=730)  # 2 years of historical data

    # Weekly sales per product name
    weekly_q = text("""
        SELECT
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            DATEPART(YEAR, vc.Fecha) as anio,
            DATEPART(WEEK, vc.Fecha) as semana,
            SUM(vd.Cantidad) as unidades
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        LEFT JOIN Productos p ON vd.ProductoID = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        WHERE vc.Fecha >= :desde
            AND (:local_id IS NULL OR vc.LocalID = :local_id)
        GROUP BY pn.Nombre, DATEPART(YEAR, vc.Fecha), DATEPART(WEEK, vc.Fecha)
        ORDER BY pn.Nombre, anio, semana
    """)

    # Current stock by product name
    stock_nombre_q = text("""
        SELECT COALESCE(pn.Nombre,'Sin nombre') as nombre,
            COALESCE(SUM(CASE WHEN sm.TipoMovimiento IN ('entrada','compra','devolucion_cliente') THEN sm.Cantidad
                              WHEN sm.TipoMovimiento IN ('salida','venta','devolucion_proveedor') THEN -sm.Cantidad
                              ELSE 0 END), 0) as stock_actual
        FROM Productos p
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN StockMovimiento sm ON sm.ProductoID = p.ProductoID
        WHERE (:local_id IS NULL OR p.LocalID = :local_id)
        GROUP BY pn.Nombre
        HAVING SUM(CASE WHEN sm.TipoMovimiento IN ('entrada','compra','devolucion_cliente') THEN sm.Cantidad
                        WHEN sm.TipoMovimiento IN ('salida','venta','devolucion_proveedor') THEN -sm.Cantidad
                        ELSE 0 END) >= 0
    """)

    r_weekly, r_stock = await asyncio.gather(
        _run(engine, weekly_q, {"desde": desde, "local_id": local_id}),
        _run(engine, stock_nombre_q, {"local_id": local_id}),
    )

    # Build week-indexed series per product name
    product_weeks: dict[str, dict[tuple[int, int], float]] = {}
    for nombre, anio, semana, unidades in r_weekly.fetchall():
        if nombre not in product_weeks:
            product_weeks[nombre] = {}
        product_weeks[nombre][(int(anio), int(semana))] = float(unidades or 0)

    # Current stock dict
    stock_dict: dict[str, int] = {}
    for nombre, stock_actual in r_stock.fetchall():
        stock_dict[str(nombre)] = int(stock_actual or 0)

    # Build ordered weekly series (fill gaps with 0)
    all_weeks: list[tuple[int, int]] = []
    d = desde
    while d <= hoy:
        iso = d.isocalendar()
        wk = (iso[0], iso[1])
        if not all_weeks or all_weeks[-1] != wk:
            all_weeks.append(wk)
        d += timedelta(days=7)

    max_weeks = len(all_weeks)
    products_list: list[ProductForecast] = []

    for nombre, week_data in sorted(product_weeks.items()):
        series = [week_data.get(wk, 0.0) for wk in all_weeks]
        result = fc.forecast_product(series, h_weeks=13)
        products_list.append(ProductForecast(
            nombre=nombre,
            stock_actual=stock_dict.get(nombre, 0),
            historico=result["historico"],
            prediccion_semanas=result["prediccion_semanas"],
            prediccion_30d=result["prediccion_30d"],
            prediccion_60d=result["prediccion_60d"],
            prediccion_90d=result["prediccion_90d"],
            tendencia=result["tendencia"],
            confianza=result["confianza"],
            semanas_datos=result["semanas_datos"],
        ))

    # Sort by prediccion_30d descending
    products_list.sort(key=lambda x: x.prediccion_30d, reverse=True)

    advertencia = None
    low_confidence = [p for p in products_list if p.confianza == 'baja']
    if len(low_confidence) > len(products_list) * 0.5:
        advertencia = "Más del 50% de los productos tienen menos de 12 semanas de datos. Las predicciones son estimaciones con margen de error alto."

    return ForecastResponse(
        productos=products_list,
        semanas_analizadas=max_weeks,
        advertencia=advertencia,
    )


# ── Compras ───────────────────────────────────────────────────────────────────

async def get_compras(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    local_id: int | None = None,
    proveedor_id: int | None = None,
) -> ComprasResponse:
    engine = await _get_engine(platform_session, tenant_id, registry)
    fecha_desde = fecha_desde or _first_of_month()
    fecha_hasta = fecha_hasta or _today()

    params: dict = {"desde": fecha_desde, "hasta": fecha_hasta, "local_id": local_id, "proveedor_id": proveedor_id}

    prov_join = "LEFT JOIN Proveedores pr ON cc.ProveedorID = pr.ProveedorID"
    prov_where = "AND (:proveedor_id IS NULL OR cc.ProveedorID = :proveedor_id)"
    base_where = f"cc.Fecha>=:desde AND cc.Fecha<DATEADD(day,1,:hasta) AND (:local_id IS NULL OR cc.LocalId=:local_id) {prov_where}"

    serie_q = text(f"SELECT CAST(cc.Fecha AS DATE) as fecha, COALESCE(SUM(cd.Subtotal),0) as total, COUNT(DISTINCT cc.CompraId) as cantidad FROM CompraDetalle cd INNER JOIN CompraCabecera cc ON cd.CompraId=cc.CompraId WHERE {base_where} GROUP BY CAST(cc.Fecha AS DATE) ORDER BY fecha")
    top_q = text(f"""
        SELECT TOP 20
            COALESCE(pn.Nombre,'Sin nombre') as nombre,
            COALESCE(pd.Descripcion,'') as descripcion,
            COALESCE(pt.Talle,'') as talle,
            COALESCE(pc.Color,'') as color,
            COALESCE(SUM(cd.Subtotal),0) as total,
            COALESCE(SUM(cd.Cantidad),0) as cantidad
        FROM CompraDetalle cd
        INNER JOIN CompraCabecera cc ON cd.CompraId=cc.CompraId
        LEFT JOIN Productos p ON cd.ProductoId=p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId=pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId=pd.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId=pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId=pc.Id
        WHERE {base_where}
        GROUP BY pn.Nombre, pd.Descripcion, pt.Talle, pc.Color
        ORDER BY total DESC
    """)
    uni_q = text(f"SELECT COALESCE(SUM(cd.Cantidad),0) FROM CompraDetalle cd INNER JOIN CompraCabecera cc ON cd.CompraId=cc.CompraId WHERE {base_where}")
    prov_q = text(f"SELECT COALESCE(pr.Nombre,'Sin proveedor') as nombre, COALESCE(SUM(cd.Subtotal),0) as total, COUNT(DISTINCT cc.CompraId) as cantidad_ordenes FROM CompraDetalle cd INNER JOIN CompraCabecera cc ON cd.CompraId=cc.CompraId {prov_join} WHERE {base_where} GROUP BY pr.ProveedorID, pr.Nombre ORDER BY total DESC")
    ordenes_q = text(f"""
        SELECT TOP 100
            cc.CompraId as compra_id,
            CAST(cc.Fecha AS DATE) as fecha,
            COALESCE(pr.Nombre,'Sin proveedor') as proveedor,
            COALESCE(SUM(cd.Subtotal),0) as total,
            COUNT(cd.CompraDetalleId) as cantidad_items
        FROM CompraCabecera cc
        LEFT JOIN CompraDetalle cd ON cd.CompraId=cc.CompraId
        {prov_join}
        WHERE {base_where}
        GROUP BY cc.CompraId, cc.Fecha, pr.Nombre
        ORDER BY cc.Fecha DESC, cc.CompraId DESC
    """)

    r_serie, r_top, r_uni, r_prov, r_ord = await asyncio.gather(
        _run(engine, serie_q, params),
        _run_safe(engine, top_q, params),
        _run(engine, uni_q, params),
        _run_safe(engine, prov_q, params),
        _run_safe(engine, ordenes_q, params),
    )

    serie_rows = _rows(r_serie)
    for r in serie_rows:
        r["total"] = float(r.get("total", 0))
        r["cantidad"] = int(r.get("cantidad", 0))
        r["fecha"] = str(r["fecha"])

    prod_rows = _rows(r_top) if r_top else []
    for r in prod_rows:
        r["total"] = float(r.get("total", 0))
        r["cantidad"] = int(r.get("cantidad", 0))

    unidades_totales = int(r_uni.scalar() or 0)
    total_periodo = sum(r["total"] for r in serie_rows)
    cant_ordenes = sum(r["cantidad"] for r in serie_rows)

    por_proveedor: list[dict] = []
    if r_prov:
        por_proveedor = _rows(r_prov)
        tot_prov = sum(float(r.get("total", 0)) for r in por_proveedor)
        for r in por_proveedor:
            r["total"] = float(r.get("total", 0))
            r["cantidad_ordenes"] = int(r.get("cantidad_ordenes", 0))
            r["pct"] = round(r["total"] / tot_prov * 100, 1) if tot_prov > 0 else 0

    ordenes: list[CompraOrden] = []
    if r_ord:
        for r in _rows(r_ord):
            try:
                ordenes.append(CompraOrden(
                    compra_id=int(r["compra_id"]),
                    fecha=str(r["fecha"]),
                    proveedor=str(r.get("proveedor") or "Sin proveedor"),
                    total=float(r.get("total") or 0),
                    cantidad_items=int(r.get("cantidad_items") or 0),
                ))
            except Exception:
                pass

    return ComprasResponse(
        serie_temporal=serie_rows,
        top_productos=prod_rows,
        por_proveedor=por_proveedor,
        ordenes=ordenes,
        total_periodo=total_periodo,
        cantidad_ordenes=cant_ordenes,
        promedio_por_orden=total_periodo / cant_ordenes if cant_ordenes else 0.0,
        unidades_totales=unidades_totales,
    )


# ── Compra items ──────────────────────────────────────────────────────────────

async def get_compra_items(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    compra_id: int,
) -> CompraItemsResponse:
    engine = await _get_engine(platform_session, tenant_id, registry)

    header_q = text("""
        SELECT
            cc.CompraId,
            CAST(cc.Fecha AS DATE) as fecha,
            COALESCE(pr.Nombre, 'Sin proveedor') as proveedor
        FROM CompraCabecera cc
        LEFT JOIN Proveedores pr ON cc.ProveedorID = pr.ProveedorID
        WHERE cc.CompraId = :compra_id
    """)

    items_q = text("""
        SELECT
            cd.CompraDetalleId,
            cd.ProductoId,
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            COALESCE(pd.Descripcion, '') as descripcion,
            COALESCE(pt.Talle, '') as talle,
            COALESCE(pc.Color, '') as color,
            cd.Cantidad,
            ISNULL(cd.CostoUnitario, 0) as costo_unitario,
            ISNULL(cd.Subtotal, cd.Cantidad * ISNULL(cd.CostoUnitario, 0)) as subtotal
        FROM CompraDetalle cd
        LEFT JOIN Productos p ON cd.ProductoId = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        WHERE cd.CompraId = :compra_id
        ORDER BY cd.CompraDetalleId
    """)

    async with engine.connect() as conn:
        r_hdr = await conn.execute(header_q, {"compra_id": compra_id})
        hdr = r_hdr.fetchone()
        if not hdr:
            raise ValueError(f"Compra {compra_id} not found")

        r_items = await conn.execute(items_q, {"compra_id": compra_id})
        item_rows = _rows(r_items)

    items = [
        CompraItem(
            compra_detalle_id=int(r["CompraDetalleId"]),
            producto_id=int(r["ProductoId"]),
            nombre=str(r.get("nombre") or "Sin nombre"),
            descripcion=str(r.get("descripcion") or "") or None,
            talle=str(r.get("talle") or "") or None,
            color=str(r.get("color") or "") or None,
            cantidad=int(r.get("Cantidad") or 0),
            costo_unitario=float(r.get("costo_unitario") or 0),
            subtotal=float(r.get("subtotal") or 0),
        )
        for r in item_rows
    ]

    return CompraItemsResponse(
        compra_id=int(hdr[0]),
        fecha=str(hdr[1]),
        proveedor=str(hdr[2]),
        items=items,
        total=sum(i.subtotal for i in items),
    )


# ── Filtros ───────────────────────────────────────────────────────────────────

async def get_filtros(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
) -> FiltrosDisponibles:
    engine = await _get_engine(platform_session, tenant_id, registry)

    q_loc = text("SELECT LocalID as id, Nombre as nombre FROM Locales ORDER BY Nombre")
    q_met = text("SELECT MetodoPagoID as id, Nombre as nombre FROM MetodoPago ORDER BY Nombre")
    q_tv = text("SELECT DISTINCT TipoVenta FROM VentaCabecera WHERE TipoVenta IS NOT NULL ORDER BY TipoVenta")
    q_tal = text("SELECT Id as id, Talle as nombre FROM ProductoTalle ORDER BY Talle")
    q_col = text("SELECT Id as id, Color as nombre FROM ProductoColor ORDER BY Color")
    q_tg = text("SELECT GastoTipoID as id, Nombre as nombre FROM GastoTipo ORDER BY Nombre")
    q_cg = text("SELECT GastoTipoCategoriaID as id, Nombre as nombre FROM GastoTipoCategoria ORDER BY Nombre")
    q_prov = text("SELECT ProveedorID as id, Nombre as nombre FROM Proveedores ORDER BY Nombre")
    q_prod = text("SELECT Id as id, Nombre as nombre FROM ProductoNombre ORDER BY Nombre")

    results = await asyncio.gather(
        _run(engine, q_loc),
        _run(engine, q_met),
        _run(engine, q_tv),
        _run(engine, q_tal),
        _run(engine, q_col),
        _run(engine, q_tg),
        _run(engine, q_cg),
        _run_safe(engine, q_prov),
        _run_safe(engine, q_prod),
    )
    r_loc, r_met, r_tv, r_tal, r_col, r_tg, r_cg, r_prov, r_prod = results

    proveedores = _rows(r_prov) if r_prov else []
    nombres_producto = _rows(r_prod) if r_prod else []

    return FiltrosDisponibles(
        locales=_rows(r_loc),
        metodos_pago=_rows(r_met),
        tipos_venta=[row[0] for row in r_tv.fetchall() if row[0]],
        talles=_rows(r_tal),
        colores=_rows(r_col),
        tipos_gasto=_rows(r_tg),
        categorias_gasto=_rows(r_cg),
        proveedores=proveedores,
        nombres_producto=nombres_producto,
    )
