"""
Analytics service: executes SQL queries against the tenant's Azure SQL database.
Uses asyncio.gather for parallel query execution to minimize latency.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone, timedelta
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from ..azure_db.service import get_db_config
from ..database.tenant import TenantConnectionRegistry
from . import forecast as fc
from .schemas import (
    AbcNombre,
    AiAnalysisResponse,
    AiInsightAjuste,
    ClasificacionUpdate,
    ComprasResponse,
    FamiliaRecompra,
    FiltrosDisponibles,
    ForecastResponse,
    GastosResponse,
    KpiSummary,
    LeadTimeUpdate,
    MasVendido,
    PrediccionesResponse,
    ProductForecast,
    ProductoStock,
    RecomendacionAvanzadaItem,
    RecomendacionAvanzadaResponse,
    RecomendacionAvanzadaSku,
    RecomendacionItem,
    RecomendacionSimpleResponse,
    RecomendacionSku,
    StockResponse,
    TalleColorVenta,
    VentasPorFecha,
    VentasResponse,
)

logger = structlog.get_logger()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_engine(platform_session, tenant_id: str, registry: TenantConnectionRegistry) -> AsyncEngine:
    from sqlalchemy.ext.asyncio import AsyncSession
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


# Aliases for compatibility with refactored call sites
_rows_to_dicts = _rows
_get_tenant_engine = _get_engine


async def _column_exists(conn, table: str, column: str) -> bool:
    """Check if a column exists in a table (Azure SQL)."""
    try:
        r = await conn.execute(
            text("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=:t AND COLUMN_NAME=:c"),
            {"t": table, "c": column},
        )
        return bool(r.scalar())
    except Exception:
        return False


async def _table_exists(conn, table: str) -> bool:
    """Check if a table exists (Azure SQL)."""
    try:
        r = await conn.execute(
            text("SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME=:t"),
            {"t": table},
        )
        return bool(r.scalar())
    except Exception:
        return False


# Cache: tenant_id → detected cost column name (or None if not found)
_COSTO_COL_CACHE: dict[str, str | None] = {}

# Candidate column names (in priority order, uppercase for comparison)
_COSTO_COL_CANDIDATES = ["PrecioCosto", "Costo", "CostoUnitario", "PrecioCompra", "CostoCompra", "PrecioDeCompra"]


async def _get_costo_col_producto(engine: AsyncEngine, tenant_id: str) -> str | None:
    """Return the name of the cost column in Productos table for this tenant, cached."""
    if tenant_id in _COSTO_COL_CACHE:
        return _COSTO_COL_CACHE[tenant_id]
    try:
        async with engine.connect() as conn:
            r = await conn.execute(
                text("""
                    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME = 'Productos'
                      AND UPPER(COLUMN_NAME) IN (
                          'PRECIOCOSTO','COSTO','COSTOUNITARIO',
                          'PRECIOCOMPRA','COSTOCOMPRA','PRECIODECOMPRA'
                      )
                """),
            )
            rows = r.fetchall()
            found = {row[0].upper(): row[0] for row in rows}
            col = None
            for candidate in _COSTO_COL_CANDIDATES:
                if candidate.upper() in found:
                    col = found[candidate.upper()]
                    break
            _COSTO_COL_CACHE[tenant_id] = col
            return col
    except Exception:
        _COSTO_COL_CACHE[tenant_id] = None
        return None


# ── Seasonality helpers ────────────────────────────────────────────────────────

# Southern Hemisphere: OI = Otoño/Invierno (Mar-Aug), PV = Primavera/Verano (Sep-Feb)
_OI_MONTHS = {3, 4, 5, 6, 7, 8}
_PV_MONTHS = {9, 10, 11, 12, 1, 2}


def _detect_season(monthly_data: dict[tuple[int, int], int]) -> tuple[str | None, str | None]:
    """Return (temporada, fase) based on monthly sales distribution.
    temporada: 'OI' | 'PV' | None (None = Básico / no clear season)
    fase: 'pre_temporada' | 'activa' | 'bajando' | 'post_temporada' | None
    """
    oi = sum(v for (_, m), v in monthly_data.items() if m in _OI_MONTHS)
    pv = sum(v for (_, m), v in monthly_data.items() if m in _PV_MONTHS)
    total = oi + pv
    if total == 0:
        return None, None

    if oi / total > 0.60:
        temporada = "OI"
    elif pv / total > 0.60:
        temporada = "PV"
    else:
        return None, None  # Básico: no dominant season

    current_month = _today().month
    if temporada == "OI":
        if current_month in {3, 4}:
            fase = "pre_temporada"
        elif current_month in {5, 6, 7}:
            fase = "activa"
        elif current_month in {8}:
            fase = "bajando"
        else:  # 9-2
            fase = "post_temporada"
    else:  # PV
        if current_month in {9, 10}:
            fase = "pre_temporada"
        elif current_month in {11, 12, 1}:
            fase = "activa"
        elif current_month in {2}:
            fase = "bajando"
        else:  # 3-8
            fase = "post_temporada"

    return temporada, fase


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
    costo_col = await _get_costo_col_producto(engine, tenant_id)

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

    top_prod_q = text(f"""
        SELECT TOP 200
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

    # CMV: use Productos.{costo_col} directly (authoritative purchase price per product)
    if costo_col:
        cmv_q = text(f"""
            SELECT COALESCE(SUM(vd.Cantidad * COALESCE(p.{costo_col}, 0)), 0) as cmv
            {joins} WHERE {base_where}
        """)
    else:
        # Fallback: correlated subquery from CompraDetalle
        cmv_q = text(f"""
            SELECT COALESCE(SUM(
                vd.Cantidad * ISNULL((
                    SELECT TOP 1
                        COALESCE(
                            NULLIF(cd2.CostoUnitario, 0),
                            CASE WHEN ISNULL(cd2.Cantidad, 0) > 0 THEN cd2.Subtotal / cd2.Cantidad ELSE NULL END
                        )
                    FROM CompraDetalle cd2
                    INNER JOIN CompraCabecera cc2 ON cd2.CompraId=cc2.CompraId
                    WHERE cd2.ProductoId=vd.ProductoID
                      AND (cd2.CostoUnitario > 0 OR (ISNULL(cd2.Subtotal,0) > 0 AND ISNULL(cd2.Cantidad,0) > 0))
                    ORDER BY cc2.Fecha DESC
                ),0)
            ),0) as cmv {joins} WHERE {base_where}
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

    # Credit sales: total INVOICED (independent of payment), try multiple column names
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
        SELECT COALESCE(SUM(vd.DineroDisponible),0) {joins} WHERE {base_where_sin_nombre}
    """)

    # Total units sold (distinct from number of orders)
    unidades_q = text(f"SELECT COALESCE(SUM(vd.Cantidad),0) {joins} WHERE {base_where}")

    # Run all independent queries in parallel
    results = await asyncio.gather(
        _run(engine, serie_q, params),
        _run(engine, local_q, params),
        _run(engine, metodo_q, params),
        _run(engine, tipo_q, params),
        _run(engine, top_prod_q, params),
        _run(engine, top_nombre_q, params),
        _run_safe(engine, cmv_q, params),
        _run_safe(engine, bruto_q, params),
        _run_safe(engine, comision_q, params),
        _run_safe(engine, grand_q, params_sin_nombre),
        _run_safe(engine, unidades_q, params),
    )

    r_serie, r_local, r_metodo, r_tipo, r_prods, r_nombre, r_cmv, r_bruto, r_comision, r_grand, r_unidades = results

    serie = [VentasPorFecha(fecha=str(row[0]), total=float(row[1] or 0), cantidad=int(row[2] or 0)) for row in r_serie.fetchall()]
    local_rows = _rows(r_local)
    metodo_rows = _rows(r_metodo)
    tipo_rows = _rows(r_tipo)
    prod_rows = _rows(r_prods)
    nombre_rows = _rows(r_nombre)

    for r in local_rows + metodo_rows + tipo_rows:
        r["total"] = float(r.get("total", 0))
    for r in prod_rows + nombre_rows:
        r["total"] = float(r.get("total", 0))
        r["cantidad"] = int(r.get("cantidad", 0))

    total_periodo = sum(s.total for s in serie)
    cant_ventas = sum(s.cantidad for s in serie)
    cantidad_unidades_vendidas = int(r_unidades.scalar() or 0) if r_unidades else 0

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
        total_periodo=total_periodo,
        facturado_bruto=round(facturado_bruto, 2),
        cantidad_ventas=cant_ventas,
        cantidad_unidades_vendidas=cantidad_unidades_vendidas,
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
    period_len = (fecha_hasta - fecha_desde).days + 1
    prev_desde = fecha_desde - timedelta(days=period_len)
    prev_hasta = fecha_desde - timedelta(days=1)
    params: dict = {"desde": fecha_desde, "hasta": fecha_hasta, "local_id": local_id}
    costo_col = await _get_costo_col_producto(engine, tenant_id)

    # Use Productos.{costo_col} directly if available; otherwise fall back to CompraDetalle CTE
    if costo_col:
        _precio_costo_expr = f"COALESCE(p.{costo_col}, 0) as precio_costo"
        _stock_q_cte = ""
        _stock_q_cte_join = ""
    else:
        _precio_costo_expr = "ISNULL(MAX(uc.costo_u), 0) as precio_costo"
        _stock_q_cte = """
        WITH UltimoCosto AS (
            SELECT cd.ProductoId,
                COALESCE(
                    NULLIF(cd.CostoUnitario, 0),
                    CASE WHEN ISNULL(cd.Cantidad, 0) > 0 THEN cd.Subtotal / cd.Cantidad ELSE NULL END
                ) as costo_u,
                ROW_NUMBER() OVER (PARTITION BY cd.ProductoId ORDER BY cc.Fecha DESC) as rn
            FROM CompraDetalle cd INNER JOIN CompraCabecera cc ON cd.CompraId=cc.CompraId
            WHERE (cd.CostoUnitario > 0)
               OR (ISNULL(cd.Subtotal, 0) > 0 AND ISNULL(cd.Cantidad, 0) > 0)
        )"""
        _stock_q_cte_join = "LEFT JOIN UltimoCosto uc ON uc.ProductoId=p.ProductoID AND uc.rn=1"

    _stock_movements = """COALESCE(SUM(CASE
                WHEN LOWER(ISNULL(sm.TipoMovimiento,'')) IN ('entrada','compra','devolucion_cliente','ingreso','receipt','purchase','in','entrada_compra','ingreso_compra','comprado') THEN sm.Cantidad
                WHEN LOWER(ISNULL(sm.TipoMovimiento,'')) IN ('salida','venta','devolucion_proveedor','egreso','sale','dispatch','out','salida_venta','egreso_venta','vendido') THEN -sm.Cantidad
                ELSE 0 END), 0)"""

    stock_q = text(f"""
        {_stock_q_cte}
        SELECT p.ProductoID as producto_id,
            COALESCE(pn.Nombre,'Sin nombre') as nombre,
            COALESCE(pd.Descripcion,'') as descripcion,
            COALESCE(pt.Talle,'') as talle,
            COALESCE(pc.Color,'') as color,
            {_stock_movements} as stock_actual,
            {_precio_costo_expr}
        FROM Productos p
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId=pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId=pd.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId=pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId=pc.Id
        LEFT JOIN StockMovimiento sm ON sm.ProductoID=p.ProductoID
        {_stock_q_cte_join}
        WHERE (:local_id IS NULL OR p.LocalID=:local_id)
        GROUP BY p.ProductoID, pn.Nombre, pd.Descripcion, pt.Talle, pc.Color{', p.' + costo_col if costo_col else ''}
        HAVING {_stock_movements} >= 0
        ORDER BY stock_actual DESC
    """)
    _fb_costo = f"COALESCE(p.{costo_col}, 0) as precio_costo" if costo_col else "0 as precio_costo"
    _fb_group_extra = f", p.{costo_col}" if costo_col else ""
    stock_fb_q = text(f"""
        SELECT p.ProductoID as producto_id, COALESCE(pn.Nombre,'Sin nombre') as nombre,
            COALESCE(pd.Descripcion,'') as descripcion,
            COALESCE(pt.Talle,'') as talle, COALESCE(pc.Color,'') as color,
            {_stock_movements} as stock_actual, {_fb_costo}
        FROM Productos p
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId=pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId=pd.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId=pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId=pc.Id
        LEFT JOIN StockMovimiento sm ON sm.ProductoID=p.ProductoID
        WHERE (:local_id IS NULL OR p.LocalID=:local_id)
        GROUP BY p.ProductoID, pn.Nombre, pd.Descripcion, pt.Talle, pc.Color{_fb_group_extra}
        HAVING {_stock_movements} >= 0
    """)
    ventas_q = text("SELECT vd.ProductoID, COALESCE(SUM(vd.Cantidad),0), COALESCE(SUM(vd.DineroDisponible),0) FROM VentaDetalle vd INNER JOIN VentaCabecera vc ON vd.VentaID=vc.VentaID WHERE vc.Fecha>=:desde AND vc.Fecha<DATEADD(day,1,:hasta) AND (:local_id IS NULL OR vc.LocalID=:local_id) GROUP BY vd.ProductoID")
    prev_q = text("SELECT vd.ProductoID, COALESCE(SUM(vd.Cantidad),0) FROM VentaDetalle vd INNER JOIN VentaCabecera vc ON vd.VentaID=vc.VentaID WHERE vc.Fecha>=:prev_desde AND vc.Fecha<DATEADD(day,1,:prev_hasta) AND (:local_id IS NULL OR vc.LocalID=:local_id) GROUP BY vd.ProductoID")
    bajo_q = text("SELECT TOP 20 * FROM vw_ProductosBajoStock")

    r_stock_raw, r_ventas, r_prev, r_bajo = await asyncio.gather(
        _run_safe(engine, stock_q, {"local_id": local_id}),
        _run(engine, ventas_q, params),
        _run(engine, prev_q, {"prev_desde": prev_desde, "prev_hasta": prev_hasta, "local_id": local_id}),
        _run_safe(engine, bajo_q),
    )

    if r_stock_raw is None:
        r_stock_raw = await _run(engine, stock_fb_q, {"local_id": local_id})

    stock_rows = _rows(r_stock_raw)
    ventas_dict: dict[int, dict] = {int(row[0]): {"u": int(row[1] or 0), "rev": float(row[2] or 0)} for row in r_ventas.fetchall()}
    prev_dict: dict[int, int] = {int(row[0]): int(row[1] or 0) for row in r_prev.fetchall()}
    bajo_stock = _rows(r_bajo) if r_bajo else []

    total_rev = sum(v["rev"] for v in ventas_dict.values())
    productos_data: list[tuple[float, dict]] = []

    # Queries for purchases total and monthly breakdowns
    compras_q = text("""
        SELECT COALESCE(SUM(COALESCE(cd.Subtotal, cd.Cantidad * COALESCE(cd.CostoUnitario, 0))), 0) as total
        FROM CompraDetalle cd
        INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
        WHERE cc.Fecha >= :desde AND cc.Fecha < DATEADD(day, 1, :hasta)
          AND (:local_id IS NULL OR cc.LocalId = :local_id)
    """)
    # CMV monthly: use Productos.{costo_col} directly if available
    if costo_col:
        cmv_mensual_q = text(f"""
            SELECT YEAR(vc.Fecha) as y, MONTH(vc.Fecha) as m,
                COALESCE(SUM(vd.Cantidad * COALESCE(p.{costo_col}, 0)), 0) as cmv
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            LEFT JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Fecha >= :desde AND vc.Fecha < DATEADD(day, 1, :hasta)
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY YEAR(vc.Fecha), MONTH(vc.Fecha)
            ORDER BY y, m
        """)
    else:
        cmv_mensual_q = text("""
            SELECT YEAR(vc.Fecha) as y, MONTH(vc.Fecha) as m,
                COALESCE(SUM(
                    vd.Cantidad * ISNULL((
                        SELECT TOP 1
                            COALESCE(
                                NULLIF(cd2.CostoUnitario, 0),
                                CASE WHEN ISNULL(cd2.Cantidad,0) > 0 THEN cd2.Subtotal / cd2.Cantidad ELSE NULL END
                            )
                        FROM CompraDetalle cd2
                        INNER JOIN CompraCabecera cc2 ON cd2.CompraId=cc2.CompraId
                        WHERE cd2.ProductoId=vd.ProductoID
                          AND (cd2.CostoUnitario > 0 OR (ISNULL(cd2.Subtotal,0) > 0 AND ISNULL(cd2.Cantidad,0) > 0))
                        ORDER BY cc2.Fecha DESC
                    ), 0)
                ), 0) as cmv
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Fecha >= :desde AND vc.Fecha < DATEADD(day, 1, :hasta)
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY YEAR(vc.Fecha), MONTH(vc.Fecha)
            ORDER BY y, m
        """)
    compras_mensual_q = text("""
        SELECT YEAR(cc.Fecha) as y, MONTH(cc.Fecha) as m,
            COALESCE(SUM(COALESCE(cd.Subtotal, cd.Cantidad * COALESCE(cd.CostoUnitario, 0))), 0) as compras
        FROM CompraDetalle cd
        INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
        WHERE cc.Fecha >= :desde AND cc.Fecha < DATEADD(day, 1, :hasta)
          AND (:local_id IS NULL OR cc.LocalId = :local_id)
        GROUP BY YEAR(cc.Fecha), MONTH(cc.Fecha)
        ORDER BY y, m
    """)

    r_compras, r_cmv_mensual, r_compras_mensual = await asyncio.gather(
        _run(engine, compras_q, params),
        _run_safe(engine, cmv_mensual_q, params),
        _run(engine, compras_mensual_q, params),
    )

    row_compras = r_compras.fetchone()
    compras_total = float(row_compras[0] or 0) if row_compras else 0.0

    ventas_mensual: dict[tuple[int, int], float] = {}
    if r_cmv_mensual:
        for r in r_cmv_mensual.fetchall():
            ventas_mensual[(int(r[0]), int(r[1]))] = float(r[2] or 0)

    compras_mensual: dict[tuple[int, int], float] = {}
    for r in r_compras_mensual.fetchall():
        compras_mensual[(int(r[0]), int(r[1]))] = float(r[2] or 0)

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
            "producto_id": pid, "nombre": row["nombre"],
            "descripcion": row.get("descripcion") or None,
            "talle": row["talle"] or None, "color": row["color"] or None,
            "stock_actual": stock, "precio_costo": costo, "monto_stock": round(monto_stock, 2),
            "unidades_vendidas_periodo": units, "rotacion": rotacion, "rotacion_anualizada": rot_anual,
            "cobertura_dias": cob, "cobertura_ajustada": cob_adj, "contribucion_pct": contrib,
            "es_substock": cob < 7 and avg_daily > 0, "es_sobrestock": cob > 90 and units > 0,
        }))

    # Sort by revenue descending for ABC
    productos_data.sort(key=lambda x: x[0], reverse=True)

    # Total stock value at cost (current)
    monto_total_stock_compra = sum(p["monto_stock"] for _, p in productos_data)

    # Total units and growth rate vs previous period
    tot_vendidas_u = sum(p["unidades_vendidas_periodo"] for _, p in productos_data)
    prev_total = sum(prev_dict.values())
    tasa_crecimiento = (tot_vendidas_u - prev_total) / prev_total if prev_total > 0 else 0.0

    # Build ordered list of months in period
    months: list[tuple[int, int]] = []
    current_month = fecha_desde.replace(day=1)
    end_month = fecha_hasta.replace(day=1)
    while current_month <= end_month:
        months.append((current_month.year, current_month.month))
        if current_month.month == 12:
            current_month = current_month.replace(year=current_month.year + 1, month=1)
        else:
            current_month = current_month.replace(month=current_month.month + 1)

    # Calculate stock value at end of each month by rolling backward from current stock
    stock_value_end = monto_total_stock_compra
    stock_end_by_month: dict[tuple[int, int], float] = {}
    cmv_after = 0.0
    compras_after = 0.0
    for ym in reversed(months):
        stock_end_by_month[ym] = max(stock_value_end + cmv_after - compras_after, 0.0)
        cmv_after += ventas_mensual.get(ym, 0.0)
        compras_after += compras_mensual.get(ym, 0.0)

    rotacion_mensual: list[dict[str, Any]] = []
    rotacion_sum = 0.0
    rotacion_count = 0
    for ym in months:
        # Skip months without purchase records: stock reconstruction is unreliable without them
        if compras_mensual.get(ym, 0.0) == 0:
            continue
        stock_end = stock_end_by_month.get(ym, 0.0)
        cmv_mes = ventas_mensual.get(ym, 0.0)
        compras_mes = compras_mensual.get(ym, 0.0)
        stock_start = stock_end + cmv_mes - compras_mes
        stock_promedio = (stock_start + stock_end) / 2 if (stock_start + stock_end) > 0 else 0.0
        rotacion_mes = cmv_mes / stock_promedio if stock_promedio > 0 else 0.0
        if stock_promedio > 0:
            rotacion_sum += rotacion_mes
            rotacion_count += 1
        rotacion_mensual.append({
            "mes": f"{ym[0]}-{ym[1]:02d}",
            "rotacion": round(rotacion_mes, 2),
            "cmv": round(cmv_mes, 2),
            "stock_promedio": round(stock_promedio, 2),
        })

    rotacion_promedio_mensual = rotacion_sum / rotacion_count if rotacion_count > 0 else 0.0
    cmv_total = sum(ventas_mensual.values())
    cmv_daily_avg = cmv_total / max(dias_periodo, 1)
    calce_financiero_dias = compras_total / cmv_daily_avg if cmv_daily_avg > 0 else None

    # ABC por descripción (SKU level)
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
            nombre=ag["nombre"], stock_total=ag["stock_total"],
            monto_stock=round(ag["monto_stock"], 2), unidades_vendidas=ag["unidades_vendidas"],
            revenue=ag["revenue"],
            rotacion=round(ag["unidades_vendidas"] / max(ag["stock_total"], 1), 2) if ag["stock_total"] > 0 else 0.0,
            cobertura_dias=round(ag["stock_total"] / avg_d_n, 1) if avg_d_n > 0 else 9999.0,
            contribucion_pct=round(ag["revenue"] / total_rev * 100, 2) if total_rev > 0 else 0.0,
            clasificacion_abc=abc_n,
        ))

    # ABC por descripcion (nombre + descripcion aggregated)
    nd_agg: dict[tuple[str, str], dict] = {}
    for rev, p in productos_data:
        key = (p["nombre"], p.get("descripcion") or "")
        if key not in nd_agg:
            nd_agg[key] = {
                "nombre": p["nombre"], "descripcion": p.get("descripcion") or "",
                "stock_total": 0, "monto_stock": 0.0, "unidades_vendidas": 0, "revenue": 0.0,
            }
        nd_agg[key]["stock_total"] += p["stock_actual"]
        nd_agg[key]["monto_stock"] += p["monto_stock"]
        nd_agg[key]["unidades_vendidas"] += p["unidades_vendidas_periodo"]
        nd_agg[key]["revenue"] += rev

    acum_nd = 0.0
    abc_por_descripcion: list[dict[str, Any]] = []
    for ag in sorted(nd_agg.values(), key=lambda x: x["revenue"], reverse=True):
        acum_nd += ag["revenue"]
        pct_nd = acum_nd / total_rev * 100 if total_rev > 0 else 100
        abc_nd = "A" if pct_nd <= 80 else ("B" if pct_nd <= 95 else "C")
        avg_d_nd = ag["unidades_vendidas"] / dias_periodo if dias_periodo > 0 else 0
        abc_por_descripcion.append({
            "nombre": ag["nombre"], "descripcion": ag["descripcion"],
            "stock_total": ag["stock_total"], "monto_stock": round(ag["monto_stock"], 2),
            "unidades_vendidas": ag["unidades_vendidas"], "revenue": round(ag["revenue"], 2),
            "rotacion": round(ag["unidades_vendidas"] / max(ag["stock_total"], 1), 2) if ag["stock_total"] > 0 else 0.0,
            "cobertura_dias": round(ag["stock_total"] / avg_d_nd, 1) if avg_d_nd > 0 else 9999.0,
            "contribucion_pct": round(ag["revenue"] / total_rev * 100, 2) if total_rev > 0 else 0.0,
            "clasificacion_abc": abc_nd,
        })

    # Más vendidos (use actual descripcion from DB)
    mas_vendidos: list[MasVendido] = []
    for _, p in sorted(
        [(r, d) for r, d in productos_data if d["unidades_vendidas_periodo"] > 0],
        key=lambda x: x[1]["unidades_vendidas_periodo"], reverse=True,
    )[:100]:
        cob = p["cobertura_dias"]
        avg_d = p["unidades_vendidas_periodo"] / dias_periodo if dias_periodo > 0 else 0.0
        mas_vendidos.append(MasVendido(
            nombre=p["nombre"],
            descripcion=p.get("descripcion") or "",
            talle=p.get("talle") or "",
            color=p.get("color") or "",
            unidades_vendidas=p["unidades_vendidas_periodo"],
            stock_actual=p["stock_actual"],
            cobertura_dias=cob,
            promedio_diario=round(avg_d, 3),
            alerta_stock=cob < 14 or (p["unidades_vendidas_periodo"] > 0 and p["stock_actual"] < p["unidades_vendidas_periodo"] * 0.3),
        ))

    # Más vendidos por nombre
    mv_n_agg: dict[str, dict] = {}
    for _, p in productos_data:
        if p["unidades_vendidas_periodo"] > 0:
            nm = p["nombre"]
            if nm not in mv_n_agg:
                mv_n_agg[nm] = {"nombre": nm, "unidades_vendidas": 0, "stock_actual": 0}
            mv_n_agg[nm]["unidades_vendidas"] += p["unidades_vendidas_periodo"]
            mv_n_agg[nm]["stock_actual"] += p["stock_actual"]
    mas_vendidos_por_nombre = sorted(mv_n_agg.values(), key=lambda x: x["unidades_vendidas"], reverse=True)[:30]

    # Más vendidos por descripcion
    mv_d_agg: dict[tuple[str, str], dict] = {}
    for _, p in productos_data:
        if p["unidades_vendidas_periodo"] > 0:
            key = (p["nombre"], p.get("descripcion") or "")
            if key not in mv_d_agg:
                mv_d_agg[key] = {"nombre": p["nombre"], "descripcion": p.get("descripcion") or "", "unidades_vendidas": 0, "stock_actual": 0}
            mv_d_agg[key]["unidades_vendidas"] += p["unidades_vendidas_periodo"]
            mv_d_agg[key]["stock_actual"] += p["stock_actual"]
    mas_vendidos_por_descripcion = sorted(mv_d_agg.values(), key=lambda x: x["unidades_vendidas"], reverse=True)[:30]

    tot_stock_u = sum(p.stock_actual for p in productos)
    avg_d_gen = tot_vendidas_u / dias_periodo if dias_periodo > 0 else 0.0
    cobertura_general = round(tot_stock_u / avg_d_gen, 1) if avg_d_gen > 0 else 9999.0

    analisis_stock = {
        "substock": sum(1 for p in productos if p.es_substock),
        "normal": sum(1 for p in productos if not p.es_substock and not p.es_sobrestock),
        "sobrestock": sum(1 for p in productos if p.es_sobrestock),
    }

    # ── KPI queries — STOCK_SPEC.md formulas, use Productos.Stock directly ────
    # Run in parallel with _run_safe so failures fall back to original values.
    _kpi_costo = costo_col or "PrecioCompra"

    # KPI 1.1 — Valor Total del Stock: SUM(PrecioCompra * Stock) FROM Productos
    kpi_valor_q = text(f"""
        SELECT ISNULL(SUM(ISNULL(p.{_kpi_costo}, 0) * ISNULL(p.Stock, 0)), 0) AS ValorTotalStock
        FROM Productos p
        WHERE p.Stock > 0
          AND (:local_id IS NULL OR p.LocalID = :local_id)
    """)

    # KPI 1.2 — Rotación Mensual: UnidadesVendidas / (StockTotal + Vendidas/2)
    kpi_rotacion_q = text("""
        WITH ventas_periodo AS (
            SELECT ISNULL(SUM(vd.Cantidad), 0) AS UnidadesVendidas
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(MONTH, -1, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
        ),
        stock_actual AS (
            SELECT SUM(ISNULL(p.Stock, 0)) AS StockTotal
            FROM Productos p
            WHERE (:local_id IS NULL OR p.LocalID = :local_id)
        )
        SELECT
            CASE
                WHEN sa.StockTotal + (vp.UnidadesVendidas / 2.0) = 0 THEN 0
                ELSE ROUND(vp.UnidadesVendidas / (sa.StockTotal + (vp.UnidadesVendidas / 2.0)), 2)
            END AS RotacionMensual
        FROM ventas_periodo vp, stock_actual sa
    """)

    # KPI 1.3 — Calce Financiero: compras 30d / CMV-diario-90d
    kpi_calce_q = text(f"""
        WITH compras_periodo AS (
            SELECT ISNULL(SUM(cc.Total), 0) AS TotalCompras
            FROM CompraCabecera cc
            WHERE cc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR cc.LocalId = :local_id)
        ),
        cmv_diario AS (
            SELECT
                ISNULL(
                    SUM(vd.Cantidad * ISNULL(p.{_kpi_costo}, 0))
                    / NULLIF(DATEDIFF(DAY, DATEADD(DAY, -90, GETDATE()), GETDATE()), 0)
                , 0) AS CMVDiario
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
        )
        SELECT
            CASE WHEN cd.CMVDiario = 0 THEN NULL
                 ELSE CEILING(cp.TotalCompras / cd.CMVDiario)
            END AS CalceDias,
            cp.TotalCompras
        FROM compras_periodo cp, cmv_diario cd
    """)

    # KPI 1.4 — Compras del Período: SUM(CompraCabecera.Total) last 30 days
    kpi_compras_q = text("""
        SELECT ISNULL(SUM(cc.Total), 0) AS ComprasPeriodo
        FROM CompraCabecera cc
        WHERE cc.Fecha >= DATEADD(MONTH, -1, GETDATE())
          AND (:local_id IS NULL OR cc.LocalId = :local_id)
    """)

    # KPI 1.7 — Total SKUs / Tipos: COUNT from Productos directly
    kpi_skus_q = text("""
        SELECT COUNT(*) AS TotalSKUs,
               COUNT(DISTINCT pn.Id) AS TiposProducto
        FROM Productos p
        INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        WHERE (:local_id IS NULL OR p.LocalID = :local_id)
    """)

    r_kv, r_kr, r_kc, r_kp, r_ks = await asyncio.gather(
        _run_safe(engine, kpi_valor_q, {"local_id": local_id}),
        _run_safe(engine, kpi_rotacion_q, {"local_id": local_id}),
        _run_safe(engine, kpi_calce_q, {"local_id": local_id}),
        _run_safe(engine, kpi_compras_q, {"local_id": local_id}),
        _run_safe(engine, kpi_skus_q, {"local_id": local_id}),
    )

    # KPI 1.1
    kpi_monto_total = monto_total_stock_compra
    if r_kv:
        row = r_kv.fetchone()
        if row and row[0] is not None:
            kpi_monto_total = float(row[0])

    # KPI 1.2
    kpi_rotacion_mensual = rotacion_promedio_mensual
    if r_kr:
        row = r_kr.fetchone()
        if row and row[0] is not None:
            kpi_rotacion_mensual = float(row[0])

    # KPI 1.3 + 1.4 (calce returns both CalceDias and TotalCompras)
    kpi_calce = calce_financiero_dias
    kpi_compras = compras_total
    if r_kc:
        row = r_kc.fetchone()
        if row:
            kpi_calce = float(row[0]) if row[0] is not None else None
            kpi_compras = float(row[1] or 0)
    # KPI 1.4 separate query takes precedence for compras_total_periodo
    if r_kp:
        row = r_kp.fetchone()
        if row and row[0] is not None:
            kpi_compras = float(row[0])

    # KPI 1.7
    kpi_total_skus = len(productos)
    kpi_total_productos = len(n_agg)
    if r_ks:
        row = r_ks.fetchone()
        if row:
            if row[0] is not None:
                kpi_total_skus = int(row[0])
            if row[1] is not None:
                kpi_total_productos = int(row[1])

    # ── Recompras avanzado: monthly ventas + talle/color + proveedor ──────────
    meses_q = text("""
        SELECT COUNT(DISTINCT YEAR(Fecha)*100+MONTH(Fecha))
        FROM VentaCabecera
        WHERE (:local_id IS NULL OR LocalID=:local_id)
    """)
    familia_monthly_q = text("""
        SELECT COALESCE(pn.Nombre,'Sin nombre') as nombre,
               COALESCE(pd.Descripcion,'') as descripcion,
               YEAR(vc.Fecha) as y, MONTH(vc.Fecha) as m,
               COALESCE(SUM(vd.Cantidad), 0) as unidades
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID=vc.VentaID
        LEFT JOIN Productos p ON vd.ProductoID=p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId=pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId=pd.Id
        WHERE vc.Fecha >= DATEADD(month, -24, GETDATE())
          AND (:local_id IS NULL OR vc.LocalID=:local_id)
        GROUP BY pn.Nombre, pd.Descripcion, YEAR(vc.Fecha), MONTH(vc.Fecha)
        ORDER BY nombre, descripcion, y, m
    """)
    talle_color_q = text("""
        SELECT COALESCE(pn.Nombre,'Sin nombre') as nombre,
               COALESCE(pd.Descripcion,'') as descripcion,
               COALESCE(pt.Talle,'') as talle,
               COALESCE(pc.Color,'') as color,
               COALESCE(SUM(vd.Cantidad), 0) as unidades
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID=vc.VentaID
        LEFT JOIN Productos p ON vd.ProductoID=p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId=pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId=pd.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId=pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId=pc.Id
        WHERE vc.Fecha >= DATEADD(month, -12, GETDATE())
          AND (:local_id IS NULL OR vc.LocalID=:local_id)
        GROUP BY pn.Nombre, pd.Descripcion, pt.Talle, pc.Color
        ORDER BY nombre, descripcion, unidades DESC
    """)
    proveedor_q = text("""
        WITH UltimaCompra AS (
            SELECT cd.ProductoId, cc.ProveedorId,
                   ROW_NUMBER() OVER (PARTITION BY cd.ProductoId ORDER BY cc.Fecha DESC) as rn
            FROM CompraDetalle cd
            INNER JOIN CompraCabecera cc ON cd.CompraId=cc.CompraId
            WHERE cc.ProveedorId IS NOT NULL
        )
        SELECT COALESCE(pn.Nombre,'Sin nombre') as nombre,
               COALESCE(pd.Descripcion,'') as descripcion,
               MIN(COALESCE(pr.Nombre,'')) as proveedor_nombre
        FROM UltimaCompra uc
        INNER JOIN Productos p ON uc.ProductoId=p.ProductoID AND uc.rn=1
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId=pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId=pd.Id
        LEFT JOIN Proveedores pr ON uc.ProveedorId=pr.ProveedorId
        WHERE (:local_id IS NULL OR p.LocalID=:local_id)
        GROUP BY pn.Nombre, pd.Descripcion
    """)

    local_param = {"local_id": local_id}
    r_meses, r_familia_monthly, r_talle_color, r_proveedor = await asyncio.gather(
        _run_safe(engine, meses_q, local_param),
        _run_safe(engine, familia_monthly_q, local_param),
        _run_safe(engine, talle_color_q, local_param),
        _run_safe(engine, proveedor_q, local_param),
    )

    meses_con_datos = int(r_meses.scalar() or 0) if r_meses else 0

    # Build monthly data by familia
    familias_monthly: dict[tuple[str, str], dict[tuple[int, int], int]] = {}
    if r_familia_monthly:
        for row in r_familia_monthly.fetchall():
            key = (str(row[0]), str(row[1]))
            ym = (int(row[2]), int(row[3]))
            familias_monthly.setdefault(key, {})[ym] = int(row[4] or 0)

    # Build talle×color breakdown by familia
    familias_tc: dict[tuple[str, str], list[TalleColorVenta]] = {}
    if r_talle_color:
        for row in r_talle_color.fetchall():
            key = (str(row[0]), str(row[1]))
            familias_tc.setdefault(key, []).append(
                TalleColorVenta(talle=str(row[2]), color=str(row[3]), unidades=int(row[4] or 0))
            )

    # Build proveedor by familia
    familias_prov: dict[tuple[str, str], str | None] = {}
    if r_proveedor:
        for row in r_proveedor.fetchall():
            nm = str(row[2]) if row[2] else None
            familias_prov[(str(row[0]), str(row[1]))] = nm if nm else None

    # Build stock totals by familia from productos_data
    familias_stock_agg: dict[tuple[str, str], dict] = {}
    for _, p in productos_data:
        key = (p["nombre"], p.get("descripcion") or "")
        if key not in familias_stock_agg:
            familias_stock_agg[key] = {"stock": 0, "monto": 0.0, "costo": 0.0}
        familias_stock_agg[key]["stock"] += p["stock_actual"]
        familias_stock_agg[key]["monto"] += p["monto_stock"]
        if p["precio_costo"] > familias_stock_agg[key]["costo"]:
            familias_stock_agg[key]["costo"] = p["precio_costo"]

    # ABC by familia from nd_agg
    familias_abc: dict[tuple[str, str], str] = {}
    for ag in abc_por_descripcion:
        familias_abc[(str(ag["nombre"]), str(ag.get("descripcion") or ""))] = str(ag["clasificacion_abc"])

    # Compute familias_recompra
    familias_recompra: list[FamiliaRecompra] = []
    all_keys = set(familias_monthly.keys()) | set(familias_stock_agg.keys())
    for key in all_keys:
        nombre, desc = key
        monthly = familias_monthly.get(key, {})
        # Annual average daily (last 12 months only)
        last_12 = sum(v for (y, m), v in monthly.items()
                      if (y * 12 + m) >= (fecha_hasta.year * 12 + fecha_hasta.month - 11))
        avg_daily_anual = round(last_12 / 365.0, 4)

        stock_info = familias_stock_agg.get(key, {"stock": 0, "monto": 0.0, "costo": 0.0})
        tc_list = familias_tc.get(key, [])
        prov = familias_prov.get(key)
        abc = familias_abc.get(key, "C")
        temporada, fase = _detect_season(monthly)

        ventas_mensuales = [
            {"mes": f"{y}-{m:02d}", "unidades": v}
            for (y, m), v in sorted(monthly.items())
        ]

        familias_recompra.append(FamiliaRecompra(
            nombre=nombre,
            descripcion=desc,
            stock_total=stock_info["stock"],
            precio_costo=stock_info["costo"],
            monto_stock=round(stock_info["monto"], 2),
            ventas_mensuales=ventas_mensuales,
            talle_color_breakdown=tc_list,
            proveedor_nombre=prov,
            promedio_diario_anual=avg_daily_anual,
            temporada_detectada=temporada,
            fase_temporada=fase,
            clasificacion_abc=abc,
        ))

    # Sort: zero stock first, then by coverage days ascending
    familias_recompra.sort(key=lambda f: (
        0 if f.stock_total == 0 else 1,
        f.stock_total / f.promedio_diario_anual if f.promedio_diario_anual > 0 else 9999.0,
    ))

    return StockResponse(
        productos=productos,
        abc_por_nombre=abc_por_nombre,
        mas_vendidos=mas_vendidos,
        bajo_stock=bajo_stock,
        monto_total_stock=round(kpi_monto_total, 2),
        monto_total_stock_compra=round(kpi_monto_total, 2),
        rotacion_general=round(tot_vendidas_u / max(tot_stock_u, 1), 2) if tot_stock_u > 0 else 0.0,
        rotacion_promedio_mensual=round(kpi_rotacion_mensual, 4),
        rotacion_mensual=rotacion_mensual,
        cobertura_general=cobertura_general,
        cobertura_general_dias=cobertura_general,
        calce_financiero_dias=round(kpi_calce, 2) if kpi_calce is not None else None,
        compras_total_periodo=round(kpi_compras, 2),
        tasa_crecimiento_ventas=round(tasa_crecimiento * 100, 2),
        analisis_stock=analisis_stock,
        abc_por_descripcion=abc_por_descripcion,
        mas_vendidos_por_nombre=mas_vendidos_por_nombre,
        mas_vendidos_por_descripcion=mas_vendidos_por_descripcion,
        total_productos=kpi_total_productos,
        total_skus=kpi_total_skus,
        skus_sin_stock=sum(1 for p in productos if p.stock_actual == 0),
        skus_bajo_stock=len(bajo_stock),
        substock_count=analisis_stock["substock"],
        sobrestock_count=analisis_stock["sobrestock"],
        dias_periodo=dias_periodo,
        meses_con_datos=meses_con_datos,
        familias_recompra=familias_recompra,
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
    # Determine global week range
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

    # Sort by prediccion_30d descending (most demand first = most relevant for reordering)
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


# ── Predicciones ─────────────────────────────────────────────────────────────────

async def get_predicciones(
    platform_session: AsyncSession,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    local_id: int | None = None,
    modelo: str = 'basico',
    periodo_dias: int = 30,
    sobre_stock_pct: float = 0.0,
) -> PrediccionesResponse:
    """Predicción de demanda y recomendación de stock.

    - `modelo` puede ser 'basico', 'temporada' o 'quiebre'.
    - `periodo_dias` define el horizonte de recomendación.
    - `sobre_stock_pct` aplica un margen extra sobre la recomendación.
    """
    engine = await _get_tenant_engine(platform_session, tenant_id, registry)
    fecha_hasta = fecha_hasta or _today()
    fecha_desde = fecha_desde or (fecha_hasta - timedelta(days=90))
    dias_hist = max((fecha_hasta - fecha_desde).days or 1, 1)

    model_factor = 1.0
    if modelo == 'temporada':
        model_factor = 1.25
    elif modelo == 'quiebre':
        model_factor = 1.5

    params: dict[str, Any] = {
        'desde': fecha_desde,
        'hasta': fecha_hasta,
        'local_id': local_id,
    }

    ventas_q = text(
        """
        WITH StockCalc AS (
            SELECT sm.ProductoID,
                   COALESCE(SUM(CASE
                       WHEN LOWER(ISNULL(sm.TipoMovimiento,'')) IN ('entrada','compra','devolucion_cliente','ingreso','receipt','purchase','in','entrada_compra','ingreso_compra','comprado') THEN sm.Cantidad
                       WHEN LOWER(ISNULL(sm.TipoMovimiento,'')) IN ('salida','venta','devolucion_proveedor','egreso','sale','dispatch','out','salida_venta','egreso_venta','vendido') THEN -sm.Cantidad
                       ELSE 0 END), 0) as stock_actual
            FROM StockMovimiento sm
            GROUP BY sm.ProductoID
        )
        SELECT
            p.ProductoID as producto_id,
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            COALESCE(pd.Descripcion, '') as descripcion,
            COALESCE(pt.Talle, '') as talle,
            COALESCE(pc.Color, '') as color,
            COALESCE(MAX(sc.stock_actual), COALESCE(MAX(p.Stock), 0)) as stock_actual,
            COALESCE(SUM(vd.Cantidad), 0) as unidades
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        LEFT JOIN Productos p ON vd.ProductoID = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        LEFT JOIN StockCalc sc ON sc.ProductoID = p.ProductoID
        WHERE vc.Fecha >= :desde AND vc.Fecha < DATEADD(day, 1, :hasta)
          AND (:local_id IS NULL OR vc.LocalID = :local_id)
        GROUP BY p.ProductoID, pn.Nombre, pd.Descripcion, pt.Talle, pc.Color
        ORDER BY unidades DESC
        """
    )

    async with engine.connect() as conn:
        r = await conn.execute(ventas_q, params)
        rows = _rows_to_dicts(r)

    productos: list[dict[str, Any]] = []
    for row in rows:
        unidades = float(row.get('unidades') or 0)
        promedio_diario = unidades / dias_hist
        prediccion = promedio_diario * periodo_dias * model_factor
        recomendado = max(row.get('stock_actual') or 0, prediccion)
        recomendado *= 1 + (sobre_stock_pct / 100.0)

        productos.append({
            'producto_id': int(row.get('producto_id') or 0),
            'nombre': str(row.get('nombre') or ''),
            'descripcion': str(row.get('descripcion') or ''),
            'talle': str(row.get('talle') or ''),
            'color': str(row.get('color') or ''),
            'stock_actual': int(row.get('stock_actual') or 0),
            'promedio_diario': round(promedio_diario, 2),
            'prediccion_30_dias': round(prediccion, 2),
            'recomendacion_stock_30_dias': round(recomendado, 2),
            'modelo': modelo,
            'sobre_stock_pct': float(sobre_stock_pct),
        })

    return PrediccionesResponse(
        periodo_dias=periodo_dias,
        modelo=modelo,
        sobre_stock_pct=sobre_stock_pct,
        productos=productos,
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

    serie_q = text(
        f"SELECT CAST(cc.Fecha AS DATE) as fecha, COALESCE(SUM(cd.Subtotal),0) as total, COUNT(DISTINCT cc.CompraId) as cantidad "
        f"FROM CompraDetalle cd INNER JOIN CompraCabecera cc ON cd.CompraId=cc.CompraId "
        f"WHERE {base_where} GROUP BY CAST(cc.Fecha AS DATE) ORDER BY fecha"
    )

    top_q = text(
        f"SELECT TOP 20 COALESCE(pn.Nombre,'Sin nombre') as nombre, COALESCE(pt.Talle,'') as talle, "
        f"COALESCE(pc.Color,'') as color, COALESCE(SUM(cd.Subtotal),0) as total, COALESCE(SUM(cd.Cantidad),0) as cantidad "
        f"FROM CompraDetalle cd INNER JOIN CompraCabecera cc ON cd.CompraId=cc.CompraId "
        f"LEFT JOIN Productos p ON cd.ProductoId=p.ProductoID "
        f"LEFT JOIN ProductoNombre pn ON p.ProductoNombreId=pn.Id "
        f"LEFT JOIN ProductoTalle pt ON p.ProductoTalleId=pt.Id "
        f"LEFT JOIN ProductoColor pc ON p.ProductoColorId=pc.Id "
        f"WHERE {base_where} GROUP BY pn.Nombre,pt.Talle,pc.Color ORDER BY total DESC"
    )

    uni_q = text(
        f"SELECT COALESCE(SUM(cd.Cantidad),0) FROM CompraDetalle cd "
        f"INNER JOIN CompraCabecera cc ON cd.CompraId=cc.CompraId "
        f"WHERE {base_where}"
    )

    prov_q = text(
        f"SELECT COALESCE(pr.Nombre,'Sin proveedor') as nombre, COALESCE(SUM(cd.Subtotal),0) as total, "
        f"COUNT(DISTINCT cc.CompraId) as cantidad_ordenes "
        f"FROM CompraDetalle cd INNER JOIN CompraCabecera cc ON cd.CompraId=cc.CompraId {prov_join} "
        f"WHERE {base_where} GROUP BY pr.ProveedorID, pr.Nombre ORDER BY total DESC"
    )

    ultimas_q = text(
        f"""
        SELECT TOP 50 cc.CompraId as id, CAST(cc.Fecha AS DATE) as fecha,
            COALESCE(pr.Nombre,'Sin proveedor') as proveedor,
            COALESCE(l.Nombre,'Sin local') as local_nombre,
            COALESCE(mp.Nombre,'Sin método') as metodo_pago,
            COUNT(cd.CompraDetalleId) as items_distintos,
            SUM(cd.Cantidad) as unidades,
            SUM(cd.Subtotal) as total
        FROM CompraCabecera cc
        LEFT JOIN CompraDetalle cd ON cd.CompraId=cc.CompraId
        {prov_join}
        LEFT JOIN Locales l ON cc.LocalId=l.LocalID
        LEFT JOIN MetodoPago mp ON cc.MetodoPagoId=mp.MetodoPagoID
        WHERE {base_where}
        GROUP BY cc.CompraId, cc.Fecha, pr.Nombre, l.Nombre, mp.Nombre
        ORDER BY cc.Fecha DESC, cc.CompraId DESC
        """
    )

    ordenes_detalle_q = text(
        """
        SELECT
            cc.CompraId as compra_id,
            CAST(cc.Fecha AS DATE) as fecha,
            COALESCE(pr.Nombre, 'Sin proveedor') as proveedor,
            COALESCE(SUM(COALESCE(cd.Subtotal, cd.Cantidad * cd.CostoUnitario)), 0) as total
        FROM CompraCabecera cc
        LEFT JOIN Proveedores pr ON cc.ProveedorId = pr.ProveedorId
        INNER JOIN CompraDetalle cd ON cc.CompraId = cd.CompraId
        WHERE cc.Fecha >= :desde AND cc.Fecha < DATEADD(day, 1, :hasta)
            AND (:local_id IS NULL OR cc.LocalId = :local_id)
        GROUP BY cc.CompraId, cc.Fecha, pr.Nombre
        ORDER BY cc.Fecha DESC
        """
    )

    items_q = text(
        """
        SELECT
            cd.CompraId as compra_id,
            COALESCE(pn.Nombre, 'Sin nombre') as nombre,
            COALESCE(pd.Descripcion, '') as descripcion,
            COALESCE(pt.Talle, '') as talle,
            COALESCE(pc.Color, '') as color,
            COALESCE(cd.Cantidad, 0) as cantidad,
            COALESCE(cd.CostoUnitario, 0) as costo_unitario,
            COALESCE(cd.Subtotal, 0) as subtotal
        FROM CompraDetalle cd
        INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
        LEFT JOIN Productos p ON cd.ProductoId = p.ProductoID
        LEFT JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        WHERE cc.Fecha >= :desde AND cc.Fecha < DATEADD(day, 1, :hasta)
            AND (:local_id IS NULL OR cc.LocalId = :local_id)
        ORDER BY cc.Fecha DESC, cd.CompraDetalleId
        """
    )

    # Run base queries
    r_serie, r_top, r_uni, r_prov, r_ord = await asyncio.gather(
        _run(engine, serie_q, params),
        _run(engine, top_q, params),
        _run(engine, uni_q, params),
        _run_safe(engine, prov_q, params),
        _run_safe(engine, ultimas_q, params),
    )

    # Additional data (top providers and detailed order items)
    proveedores_rows: list[dict[str, Any]] = []
    ordenes: list[dict[str, Any]] = []
    async with engine.connect() as conn:
        if await _column_exists(conn, "CompraCabecera", "ProveedorId") and await _table_exists(conn, "Proveedores"):
            r_top_proveedores = await conn.execute(
                text(
                    """
                    SELECT TOP 20
                        COALESCE(pr.Nombre, 'Sin proveedor') as proveedor,
                        COALESCE(SUM(COALESCE(cd.Subtotal, cd.Cantidad * cd.CostoUnitario)), 0) as total,
                        COUNT(DISTINCT cc.CompraId) as ordenes
                    FROM CompraDetalle cd
                    INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
                    LEFT JOIN Proveedores pr ON cc.ProveedorId = pr.ProveedorId
                    WHERE cc.Fecha >= :desde AND cc.Fecha < DATEADD(day, 1, :hasta)
                        AND (:local_id IS NULL OR cc.LocalId = :local_id)
                    GROUP BY pr.Nombre
                    ORDER BY total DESC
                    """
                ),
                params,
            )
            proveedores_rows = _rows_to_dicts(r_top_proveedores)

            ordenes_rows = _rows_to_dicts(await conn.execute(ordenes_detalle_q, params))
            items_rows = _rows_to_dicts(await conn.execute(items_q, params))

            items_by_order: dict[int, list[dict[str, Any]]] = {}
            for item in items_rows:
                cid = int(item.get("compra_id") or 0)
                items_by_order.setdefault(cid, []).append(item)

            for ord in ordenes_rows:
                cid = int(ord.get("compra_id") or 0)
                ordenes.append({
                    "compra_id": cid,
                    "fecha": str(ord.get("fecha") or ""),
                    "proveedor": str(ord.get("proveedor") or ""),
                    "total": float(ord.get("total") or 0),
                    "items": items_by_order.get(cid, []),
                })

    serie_rows = _rows(r_serie)
    for r in serie_rows:
        r["total"] = float(r.get("total", 0))
        r["cantidad"] = int(r.get("cantidad", 0))
        r["fecha"] = str(r["fecha"])

    prod_rows = _rows(r_top)
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

    ultimas: list[dict] = []
    if r_ord:
        ultimas = _rows(r_ord)
        for r in ultimas:
            r["total"] = float(r.get("total", 0))
            r["unidades"] = int(r.get("unidades", 0))
            r["items_distintos"] = int(r.get("items_distintos", 0))
            r["fecha"] = str(r["fecha"])

    analisis = {
        "concentracion_top10_pct": round(sum(r.get("pct", 0) for r in por_proveedor[:10]), 1) if por_proveedor else 0,
        "cantidad_proveedores": len(por_proveedor),
        "proveedor_principal_pct": por_proveedor[0]["pct"] if por_proveedor else 0,
    }

    top_proveedores: list[dict] = []
    if proveedores_rows:
        tot_tp = sum(float(r.get("total", 0)) for r in proveedores_rows)
        for r in proveedores_rows:
            r["total"] = float(r.get("total", 0))
            r["ordenes"] = int(r.get("ordenes", 0))
            r["pct"] = round(r["total"] / tot_tp * 100, 1) if tot_tp > 0 else 0
        top_proveedores = proveedores_rows

    return ComprasResponse(
        serie_temporal=serie_rows,
        top_productos=prod_rows,
        por_proveedor=por_proveedor,
        ultimas_compras=ultimas,
        top_proveedores=top_proveedores,
        analisis=analisis,
        ordenes=ordenes,
        total_periodo=total_periodo,
        cantidad_ordenes=cant_ordenes,
        promedio_por_orden=total_periodo / cant_ordenes if cant_ordenes else 0.0,
        unidades_totales=unidades_totales,
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
    q_prod = text("SELECT TOP 100 Nombre as nombre FROM ProductoNombre ORDER BY Nombre")

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
    nombres_raw = r_prod.fetchall() if r_prod else []
    nombres_producto = [str(row[0]) for row in nombres_raw if row[0]]

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


# ── AI Analysis ───────────────────────────────────────────────────────────────

async def get_predicciones_ai(
    grupos: list[dict[str, Any]],
    periodo_dias: int,
    fecha_actual: str,
) -> AiAnalysisResponse:
    """Call Claude to analyze product demand predictions and suggest adjustments."""
    import json as _json

    from ..config import get_settings

    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        return AiAnalysisResponse(
            insights="IA no configurada. Agregue ANTHROPIC_API_KEY en las variables de entorno del servidor.",
            ajustes=[],
            advertencia="ANTHROPIC_API_KEY no configurado",
        )

    try:
        import anthropic  # type: ignore[import]
    except ImportError:
        return AiAnalysisResponse(
            insights="Paquete 'anthropic' no instalado en el servidor.",
            ajustes=[],
            advertencia="anthropic no instalado",
        )

    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    # Build product summary (limit to top 60 by prediccion)
    grupos_sorted = sorted(grupos, key=lambda g: g.get("prediccion", 0), reverse=True)[:60]
    lines = []
    for g in grupos_sorted:
        nombre = g.get("nombre", "")
        desc = g.get("descripcion", "")
        key = f"{nombre}::{desc}" if desc else nombre
        stock = g.get("stock", 0)
        pred = g.get("prediccion", 0)
        prom = g.get("promedio_diario", 0)
        lines.append(f"- {key}: stock={stock}, pred_{periodo_dias}d={pred:.1f}, prom_diario={prom:.2f}")

    productos_text = "\n".join(lines)

    prompt = f"""Eres un asistente experto en análisis de inventario para un negocio de retail de indumentaria en Argentina.
Fecha actual: {fecha_actual}

Analiza las siguientes predicciones de demanda para un horizonte de {periodo_dias} días y proporciona:
1. Un análisis conciso de los patrones observados (2-3 párrafos en español)
2. Factores de ajuste sugeridos solo para productos donde hay una razón clara y justificada

Productos (nombre::descripcion, stock_actual, predicción, promedio diario de ventas):
{productos_text}

Responde ÚNICAMENTE con un objeto JSON válido con este formato exacto (sin texto adicional antes o después):
{{
  "insights": "análisis breve en español...",
  "ajustes": [
    {{"producto_key": "Nombre::Descripcion", "factor": 1.2, "razon": "motivo concreto del ajuste"}}
  ]
}}

Reglas:
- Factor 1.0 = sin cambio, 1.2 = +20% demanda esperada, 0.8 = -20%
- Solo incluye ajustes con factor diferente a 1.0 y con justificación clara
- Considera: temporada (invierno/verano), tendencias del mercado textil argentino, relación stock/demanda
- No inventes datos, basa los ajustes en los patrones que observas en los números"""

    try:
        message = await client.messages.create(
            model="claude-opus-4-6",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        content = message.content[0].text.strip()

        # Strip potential markdown code blocks
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()

        data = _json.loads(content)
        ajustes = [
            AiInsightAjuste(
                producto_key=str(a.get("producto_key", "")),
                factor=float(a.get("factor", 1.0)),
                razon=str(a.get("razon", "")),
            )
            for a in data.get("ajustes", [])
            if abs(float(a.get("factor", 1.0)) - 1.0) > 0.01
        ]
        return AiAnalysisResponse(
            insights=str(data.get("insights", "")),
            ajustes=ajustes,
        )
    except _json.JSONDecodeError as e:
        return AiAnalysisResponse(
            insights=f"Error al procesar respuesta de IA (JSON inválido): {e}",
            ajustes=[],
            advertencia=str(e),
        )
    except Exception as e:
        return AiAnalysisResponse(
            insights=f"Error al consultar IA: {e}",
            ajustes=[],
            advertencia=str(e),
        )


# ── Recomendación Simple ──────────────────────────────────────────────────────

async def get_recomendacion_simple(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    local_id: int | None = None,
) -> RecomendacionSimpleResponse:
    engine = await _get_engine(platform_session, tenant_id, registry)

    # Main aggregated query (with Anulada filter)
    main_q = text("""
        WITH ventas_30d AS (
            SELECT p.ProductoNombreId,
                   SUM(vd.Cantidad) AS UnidadesVendidas
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        stock_actual AS (
            SELECT p.ProductoNombreId,
                   SUM(ISNULL(p.Stock, 0)) AS StockTotal
            FROM Productos p
            WHERE (:local_id IS NULL OR p.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ultimo_proveedor AS (
            SELECT p.ProductoNombreId,
                   prov.Nombre AS ProveedorNombre,
                   ROW_NUMBER() OVER (PARTITION BY p.ProductoNombreId ORDER BY cc.Fecha DESC) AS rn
            FROM CompraDetalle cd
            INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
            INNER JOIN Productos p ON cd.ProductoId = p.ProductoID
            INNER JOIN Proveedores prov ON cc.ProveedorId = prov.ProveedorId
        )
        SELECT
            pn.Nombre,
            ISNULL(v.UnidadesVendidas, 0) AS Vendidas30d,
            ISNULL(s.StockTotal, 0) AS StockActual,
            ROUND(ISNULL(v.UnidadesVendidas, 0) / 30.0, 2) AS VelocidadDiaria,
            CASE
                WHEN ISNULL(v.UnidadesVendidas, 0) = 0 THEN 999
                ELSE ROUND(ISNULL(s.StockTotal, 0) / (ISNULL(v.UnidadesVendidas, 0) / 30.0), 0)
            END AS CoberturaDias,
            up.ProveedorNombre,
            CASE
                WHEN ISNULL(v.UnidadesVendidas, 0) - ISNULL(s.StockTotal, 0) > 0
                THEN ISNULL(v.UnidadesVendidas, 0) - ISNULL(s.StockTotal, 0)
                ELSE 0
            END AS SugerenciaCompra
        FROM ProductoNombre pn
        LEFT JOIN ventas_30d v ON pn.Id = v.ProductoNombreId
        LEFT JOIN stock_actual s ON pn.Id = s.ProductoNombreId
        LEFT JOIN ultimo_proveedor up ON pn.Id = up.ProductoNombreId AND up.rn = 1
        WHERE ISNULL(s.StockTotal, 0) > 0 OR ISNULL(v.UnidadesVendidas, 0) > 0
        ORDER BY
            CASE
                WHEN ISNULL(v.UnidadesVendidas, 0) = 0 THEN 4
                WHEN ISNULL(s.StockTotal, 0) / (ISNULL(v.UnidadesVendidas, 0) / 30.0) < 7 THEN 1
                WHEN ISNULL(s.StockTotal, 0) / (ISNULL(v.UnidadesVendidas, 0) / 30.0) < 15 THEN 2
                WHEN ISNULL(s.StockTotal, 0) / (ISNULL(v.UnidadesVendidas, 0) / 30.0) < 45 THEN 3
                ELSE 5
            END,
            ISNULL(v.UnidadesVendidas, 0) DESC
    """)

    # Fallback query without Anulada (for tenants whose schema lacks the column)
    main_q_fallback = text("""
        WITH ventas_30d AS (
            SELECT p.ProductoNombreId,
                   SUM(vd.Cantidad) AS UnidadesVendidas
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        stock_actual AS (
            SELECT p.ProductoNombreId,
                   SUM(ISNULL(p.Stock, 0)) AS StockTotal
            FROM Productos p
            WHERE (:local_id IS NULL OR p.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ultimo_proveedor AS (
            SELECT p.ProductoNombreId,
                   prov.Nombre AS ProveedorNombre,
                   ROW_NUMBER() OVER (PARTITION BY p.ProductoNombreId ORDER BY cc.Fecha DESC) AS rn
            FROM CompraDetalle cd
            INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
            INNER JOIN Productos p ON cd.ProductoId = p.ProductoID
            INNER JOIN Proveedores prov ON cc.ProveedorId = prov.ProveedorId
        )
        SELECT
            pn.Nombre,
            ISNULL(v.UnidadesVendidas, 0) AS Vendidas30d,
            ISNULL(s.StockTotal, 0) AS StockActual,
            ROUND(ISNULL(v.UnidadesVendidas, 0) / 30.0, 2) AS VelocidadDiaria,
            CASE
                WHEN ISNULL(v.UnidadesVendidas, 0) = 0 THEN 999
                ELSE ROUND(ISNULL(s.StockTotal, 0) / (ISNULL(v.UnidadesVendidas, 0) / 30.0), 0)
            END AS CoberturaDias,
            up.ProveedorNombre,
            CASE
                WHEN ISNULL(v.UnidadesVendidas, 0) - ISNULL(s.StockTotal, 0) > 0
                THEN ISNULL(v.UnidadesVendidas, 0) - ISNULL(s.StockTotal, 0)
                ELSE 0
            END AS SugerenciaCompra
        FROM ProductoNombre pn
        LEFT JOIN ventas_30d v ON pn.Id = v.ProductoNombreId
        LEFT JOIN stock_actual s ON pn.Id = s.ProductoNombreId
        LEFT JOIN ultimo_proveedor up ON pn.Id = up.ProductoNombreId AND up.rn = 1
        WHERE ISNULL(s.StockTotal, 0) > 0 OR ISNULL(v.UnidadesVendidas, 0) > 0
        ORDER BY
            CASE
                WHEN ISNULL(v.UnidadesVendidas, 0) = 0 THEN 4
                WHEN ISNULL(s.StockTotal, 0) / (ISNULL(v.UnidadesVendidas, 0) / 30.0) < 7 THEN 1
                WHEN ISNULL(s.StockTotal, 0) / (ISNULL(v.UnidadesVendidas, 0) / 30.0) < 15 THEN 2
                WHEN ISNULL(s.StockTotal, 0) / (ISNULL(v.UnidadesVendidas, 0) / 30.0) < 45 THEN 3
                ELSE 5
            END,
            ISNULL(v.UnidadesVendidas, 0) DESC
    """)

    # SKU detail query (with Anulada)
    sku_q = text("""
        WITH ventas_30d AS (
            SELECT vd.ProductoID,
                   SUM(vd.Cantidad) AS UnidadesVendidas
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY vd.ProductoID
        )
        SELECT
            pn.Nombre AS NombreGrupo,
            pd.Descripcion,
            pt.Talle,
            pc.Color,
            ISNULL(p.Stock, 0) AS Stock,
            ISNULL(v.UnidadesVendidas, 0) AS Vendidas30d,
            ROUND(ISNULL(v.UnidadesVendidas, 0) / 30.0, 2) AS VelocidadDiaria
        FROM Productos p
        INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        LEFT JOIN ventas_30d v ON p.ProductoID = v.ProductoID
        WHERE (:local_id IS NULL OR p.LocalID = :local_id)
          AND (ISNULL(p.Stock, 0) > 0 OR ISNULL(v.UnidadesVendidas, 0) > 0)
    """)

    # SKU detail fallback (without Anulada)
    sku_q_fallback = text("""
        WITH ventas_30d AS (
            SELECT vd.ProductoID,
                   SUM(vd.Cantidad) AS UnidadesVendidas
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY vd.ProductoID
        )
        SELECT
            pn.Nombre AS NombreGrupo,
            pd.Descripcion,
            pt.Talle,
            pc.Color,
            ISNULL(p.Stock, 0) AS Stock,
            ISNULL(v.UnidadesVendidas, 0) AS Vendidas30d,
            ROUND(ISNULL(v.UnidadesVendidas, 0) / 30.0, 2) AS VelocidadDiaria
        FROM Productos p
        INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        LEFT JOIN ventas_30d v ON p.ProductoID = v.ProductoID
        WHERE (:local_id IS NULL OR p.LocalID = :local_id)
          AND (ISNULL(p.Stock, 0) > 0 OR ISNULL(v.UnidadesVendidas, 0) > 0)
    """)

    params = {"local_id": local_id}

    r_main, r_sku = await asyncio.gather(
        _run_safe(engine, main_q, params),
        _run_safe(engine, sku_q, params),
    )

    # Try fallbacks if primary queries failed (Anulada column may not exist)
    if r_main is None:
        r_main = await _run_safe(engine, main_q_fallback, params)
    if r_sku is None:
        r_sku = await _run_safe(engine, sku_q_fallback, params)

    main_rows = _rows(r_main) if r_main else []
    sku_rows = _rows(r_sku) if r_sku else []

    # Build SKU map: nombre → list of RecomendacionSku
    sku_map: dict[str, list[RecomendacionSku]] = {}
    for row in sku_rows:
        nombre = str(row.get("NombreGrupo") or "")
        sku_map.setdefault(nombre, []).append(
            RecomendacionSku(
                descripcion=row.get("Descripcion"),
                talle=row.get("Talle"),
                color=row.get("Color"),
                stock=int(row.get("Stock") or 0),
                vendidas_30d=int(row.get("Vendidas30d") or 0),
                velocidad_diaria=float(row.get("VelocidadDiaria") or 0),
            )
        )

    def _estado(cobertura: float) -> str:
        if cobertura < 7:
            return "CRITICO"
        if cobertura < 15:
            return "BAJO"
        if cobertura < 45:
            return "OK"
        return "EXCESO"

    items: list[RecomendacionItem] = []
    for row in main_rows:
        nombre = str(row.get("Nombre") or "")
        cobertura = float(row.get("CoberturaDias") or 999)
        items.append(
            RecomendacionItem(
                nombre=nombre,
                vendidas_30d=int(row.get("Vendidas30d") or 0),
                stock_actual=int(row.get("StockActual") or 0),
                velocidad_diaria=float(row.get("VelocidadDiaria") or 0),
                cobertura_dias=cobertura,
                estado=_estado(cobertura),
                proveedor_nombre=row.get("ProveedorNombre"),
                sugerencia_compra=int(row.get("SugerenciaCompra") or 0),
                skus=sku_map.get(nombre, []),
            )
        )

    return RecomendacionSimpleResponse(items=items)


# ── Advanced tables auto-creation ─────────────────────────────────────────────

async def _ensure_advanced_tables(engine: AsyncEngine) -> None:
    """Create ProductoClasificacion table and add LeadTimeDias to Proveedores if needed."""
    async with engine.begin() as conn:
        # Check/create ProductoClasificacion
        if not await _table_exists(conn, "ProductoClasificacion"):
            await conn.execute(text("""
                CREATE TABLE ProductoClasificacion (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    ProductoNombreId INT NOT NULL,
                    TipoRecompra VARCHAR(20) NOT NULL DEFAULT 'Basico',
                    StockSeguridadDias INT NOT NULL DEFAULT 7,
                    TemporadaMesInicio INT NULL,
                    TemporadaMesFin INT NULL,
                    TemporadaMesLiquidacion INT NULL,
                    TemporadaCantidadEstimada INT NULL,
                    ModificadoEn DATETIME2 DEFAULT SYSUTCDATETIME(),
                    ModificadoPor NVARCHAR(50),
                    CONSTRAINT UQ_ProductoClasificacion_Nombre UNIQUE (ProductoNombreId)
                )
            """))
        # Check/add LeadTimeDias to Proveedores
        if not await _column_exists(conn, "Proveedores", "LeadTimeDias"):
            await conn.execute(text(
                "ALTER TABLE Proveedores ADD LeadTimeDias INT NOT NULL DEFAULT 7"
            ))


# ── Recomendación Avanzada ────────────────────────────────────────────────────

async def get_recomendacion_avanzada(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    local_id: int | None = None,
) -> RecomendacionAvanzadaResponse:
    engine = await _get_engine(platform_session, tenant_id, registry)

    # Ensure advanced tables exist
    try:
        await _ensure_advanced_tables(engine)
    except Exception:
        pass  # If creation fails (permissions etc.), continue with defaults

    costo_col = await _get_costo_col_producto(engine, tenant_id)
    _cost = costo_col or "PrecioCompra"

    # Main advanced query: 90d velocity + 30d velocity + 30-60d velocity (for tendencia) + costo + lead time + clasificacion
    main_q = text(f"""
        WITH ventas_90d AS (
            SELECT p.ProductoNombreId,
                   SUM(vd.Cantidad) AS Vendidas90d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ventas_30d AS (
            SELECT p.ProductoNombreId,
                   SUM(vd.Cantidad) AS Vendidas30d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ventas_30_60d AS (
            SELECT p.ProductoNombreId,
                   SUM(vd.Cantidad) AS Vendidas3060d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -60, GETDATE())
              AND vc.Fecha < DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        stock_actual AS (
            SELECT p.ProductoNombreId,
                   SUM(ISNULL(p.Stock, 0)) AS StockTotal,
                   AVG(ISNULL(p.{_cost}, 0)) AS CostoPromedio
            FROM Productos p
            WHERE (:local_id IS NULL OR p.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ultimo_proveedor AS (
            SELECT p.ProductoNombreId,
                   prov.Nombre AS ProveedorNombre,
                   prov.ProveedorId,
                   ISNULL(prov.LeadTimeDias, 7) AS LeadTimeDias,
                   ROW_NUMBER() OVER (PARTITION BY p.ProductoNombreId ORDER BY cc.Fecha DESC) AS rn
            FROM CompraDetalle cd
            INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
            INNER JOIN Productos p ON cd.ProductoId = p.ProductoID
            INNER JOIN Proveedores prov ON cc.ProveedorId = prov.ProveedorId
        ),
        clasificacion AS (
            SELECT ProductoNombreId,
                   TipoRecompra,
                   StockSeguridadDias
            FROM ProductoClasificacion
        )
        SELECT
            pn.Id AS ProductoNombreId,
            pn.Nombre,
            ISNULL(v90.Vendidas90d, 0) AS Vendidas90d,
            ISNULL(v30.Vendidas30d, 0) AS Vendidas30d,
            ISNULL(v3060.Vendidas3060d, 0) AS Vendidas3060d,
            ISNULL(s.StockTotal, 0) AS StockActual,
            ISNULL(s.CostoPromedio, 0) AS CostoPromedio,
            up.ProveedorNombre,
            up.ProveedorId,
            ISNULL(up.LeadTimeDias, 7) AS LeadTimeDias,
            ISNULL(cl.TipoRecompra, 'Basico') AS TipoRecompra,
            ISNULL(cl.StockSeguridadDias, 7) AS StockSeguridadDias
        FROM ProductoNombre pn
        LEFT JOIN ventas_90d v90 ON pn.Id = v90.ProductoNombreId
        LEFT JOIN ventas_30d v30 ON pn.Id = v30.ProductoNombreId
        LEFT JOIN ventas_30_60d v3060 ON pn.Id = v3060.ProductoNombreId
        LEFT JOIN stock_actual s ON pn.Id = s.ProductoNombreId
        LEFT JOIN ultimo_proveedor up ON pn.Id = up.ProductoNombreId AND up.rn = 1
        LEFT JOIN clasificacion cl ON pn.Id = cl.ProductoNombreId
        WHERE ISNULL(s.StockTotal, 0) > 0 OR ISNULL(v90.Vendidas90d, 0) > 0
    """)

    # Fallback without Anulada + without ProductoClasificacion + without LeadTimeDias
    main_q_fallback = text(f"""
        WITH ventas_90d AS (
            SELECT p.ProductoNombreId,
                   SUM(vd.Cantidad) AS Vendidas90d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Fecha >= DATEADD(DAY, -90, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ventas_30d AS (
            SELECT p.ProductoNombreId,
                   SUM(vd.Cantidad) AS Vendidas30d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ventas_30_60d AS (
            SELECT p.ProductoNombreId,
                   SUM(vd.Cantidad) AS Vendidas3060d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Fecha >= DATEADD(DAY, -60, GETDATE())
              AND vc.Fecha < DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        stock_actual AS (
            SELECT p.ProductoNombreId,
                   SUM(ISNULL(p.Stock, 0)) AS StockTotal,
                   AVG(ISNULL(p.{_cost}, 0)) AS CostoPromedio
            FROM Productos p
            WHERE (:local_id IS NULL OR p.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ultimo_proveedor AS (
            SELECT p.ProductoNombreId,
                   prov.Nombre AS ProveedorNombre,
                   prov.ProveedorId,
                   7 AS LeadTimeDias,
                   ROW_NUMBER() OVER (PARTITION BY p.ProductoNombreId ORDER BY cc.Fecha DESC) AS rn
            FROM CompraDetalle cd
            INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
            INNER JOIN Productos p ON cd.ProductoId = p.ProductoID
            INNER JOIN Proveedores prov ON cc.ProveedorId = prov.ProveedorId
        )
        SELECT
            pn.Id AS ProductoNombreId,
            pn.Nombre,
            ISNULL(v90.Vendidas90d, 0) AS Vendidas90d,
            ISNULL(v30.Vendidas30d, 0) AS Vendidas30d,
            ISNULL(v3060.Vendidas3060d, 0) AS Vendidas3060d,
            ISNULL(s.StockTotal, 0) AS StockActual,
            ISNULL(s.CostoPromedio, 0) AS CostoPromedio,
            up.ProveedorNombre,
            up.ProveedorId,
            ISNULL(up.LeadTimeDias, 7) AS LeadTimeDias,
            'Basico' AS TipoRecompra,
            7 AS StockSeguridadDias
        FROM ProductoNombre pn
        LEFT JOIN ventas_90d v90 ON pn.Id = v90.ProductoNombreId
        LEFT JOIN ventas_30d v30 ON pn.Id = v30.ProductoNombreId
        LEFT JOIN ventas_30_60d v3060 ON pn.Id = v3060.ProductoNombreId
        LEFT JOIN stock_actual s ON pn.Id = s.ProductoNombreId
        LEFT JOIN ultimo_proveedor up ON pn.Id = up.ProductoNombreId AND up.rn = 1
        WHERE ISNULL(s.StockTotal, 0) > 0 OR ISNULL(v90.Vendidas90d, 0) > 0
    """)

    # SKU detail query (reuse from simple with Anulada)
    sku_q = text("""
        WITH ventas_30d AS (
            SELECT vd.ProductoID,
                   SUM(vd.Cantidad) AS UnidadesVendidas
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY vd.ProductoID
        )
        SELECT
            pn.Nombre AS NombreGrupo,
            pd.Descripcion,
            pt.Talle,
            pc.Color,
            ISNULL(p.Stock, 0) AS Stock,
            ISNULL(v.UnidadesVendidas, 0) AS Vendidas30d,
            ROUND(ISNULL(v.UnidadesVendidas, 0) / 30.0, 2) AS VelocidadDiaria
        FROM Productos p
        INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        LEFT JOIN ventas_30d v ON p.ProductoID = v.ProductoID
        WHERE (:local_id IS NULL OR p.LocalID = :local_id)
          AND (ISNULL(p.Stock, 0) > 0 OR ISNULL(v.UnidadesVendidas, 0) > 0)
    """)

    sku_q_fallback = text("""
        WITH ventas_30d AS (
            SELECT vd.ProductoID,
                   SUM(vd.Cantidad) AS UnidadesVendidas
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY vd.ProductoID
        )
        SELECT
            pn.Nombre AS NombreGrupo,
            pd.Descripcion,
            pt.Talle,
            pc.Color,
            ISNULL(p.Stock, 0) AS Stock,
            ISNULL(v.UnidadesVendidas, 0) AS Vendidas30d,
            ROUND(ISNULL(v.UnidadesVendidas, 0) / 30.0, 2) AS VelocidadDiaria
        FROM Productos p
        INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        LEFT JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        LEFT JOIN ventas_30d v ON p.ProductoID = v.ProductoID
        WHERE (:local_id IS NULL OR p.LocalID = :local_id)
          AND (ISNULL(p.Stock, 0) > 0 OR ISNULL(v.UnidadesVendidas, 0) > 0)
    """)

    params = {"local_id": local_id}

    r_main, r_sku = await asyncio.gather(
        _run_safe(engine, main_q, params),
        _run_safe(engine, sku_q, params),
    )

    if r_main is None:
        r_main = await _run_safe(engine, main_q_fallback, params)
    if r_sku is None:
        r_sku = await _run_safe(engine, sku_q_fallback, params)

    main_rows = _rows(r_main) if r_main else []
    sku_rows = _rows(r_sku) if r_sku else []

    # Build SKU map
    sku_map: dict[str, list[RecomendacionAvanzadaSku]] = {}
    for row in sku_rows:
        nombre = str(row.get("NombreGrupo") or "")
        sku_map.setdefault(nombre, []).append(
            RecomendacionAvanzadaSku(
                descripcion=row.get("Descripcion"),
                talle=row.get("Talle"),
                color=row.get("Color"),
                stock=int(row.get("Stock") or 0),
                vendidas_30d=int(row.get("Vendidas30d") or 0),
                velocidad_diaria=float(row.get("VelocidadDiaria") or 0),
            )
        )

    today = _today()

    def _tendencia(v30: int, v3060: int) -> str:
        if v3060 == 0:
            return "stable" if v30 == 0 else "up"
        pct = (v30 - v3060) / v3060
        if pct > 0.2:
            return "up"
        if pct < -0.2:
            return "down"
        return "stable"

    def _estado(cobertura: float, punto_reorden: int) -> str:
        if cobertura < punto_reorden:
            return "CRITICO" if cobertura < 7 else "BAJO"
        if cobertura > 60:
            return "EXCESO"
        return "OK"

    def _build_proyeccion(stock: int, vel: float, lead_time: int) -> list[dict[str, Any]]:
        """Build daily stock projection for the chart."""
        if vel <= 0:
            return [{"dia": 0, "stock": stock}]
        horizonte = max(60, int(lead_time * 1.5))
        pts: list[dict[str, Any]] = []
        for d in range(horizonte + 1):
            remaining = max(0, stock - vel * d)
            pts.append({"dia": d, "stock": round(remaining, 1)})
            if remaining == 0:
                break
        return pts

    items: list[RecomendacionAvanzadaItem] = []
    for row in main_rows:
        nombre = str(row.get("Nombre") or "")
        pn_id = int(row.get("ProductoNombreId") or 0)
        v90 = int(row.get("Vendidas90d") or 0)
        v30 = int(row.get("Vendidas30d") or 0)
        v3060 = int(row.get("Vendidas3060d") or 0)
        stock = int(row.get("StockActual") or 0)
        costo = float(row.get("CostoPromedio") or 0)
        lead_time = int(row.get("LeadTimeDias") or 7)
        seguridad = int(row.get("StockSeguridadDias") or 7)
        tipo = str(row.get("TipoRecompra") or "Basico")

        # Use 90d velocity as base (spec V1)
        vel_diaria = round(v90 / 90.0, 2) if v90 > 0 else 0.0
        cobertura = round(stock / vel_diaria, 0) if vel_diaria > 0 else 999.0
        punto_reorden = lead_time + seguridad

        # Sugerencia based on tipo
        if tipo == "Quiebre":
            sugerencia = int(vel_diaria * lead_time * 1.1) if stock == 0 else 0
        else:  # Basico (and Temporada fallback for now)
            sugerencia = max(0, int(vel_diaria * punto_reorden * 1.2) - stock)

        inversion = round(sugerencia * costo, 2)

        # Fecha límite compra: HOY + (cobertura - punto_reorden)
        dias_hasta = cobertura - punto_reorden if cobertura < 999 else 999
        if dias_hasta < 999 and vel_diaria > 0:
            fecha_limite = (today + timedelta(days=int(dias_hasta))).isoformat() if dias_hasta > 0 else None
        else:
            fecha_limite = None

        estado = _estado(cobertura, punto_reorden)

        items.append(
            RecomendacionAvanzadaItem(
                nombre=nombre,
                producto_nombre_id=pn_id,
                vendidas_30d=v30,
                stock_actual=stock,
                velocidad_diaria=vel_diaria,
                cobertura_dias=cobertura,
                estado=estado,
                tipo=tipo,
                lead_time_dias=lead_time,
                stock_seguridad_dias=seguridad,
                punto_reorden=punto_reorden,
                tendencia=_tendencia(v30, v3060),
                costo_promedio=round(costo, 2),
                inversion_sugerida=inversion,
                sugerencia_compra=sugerencia,
                fecha_limite_compra=fecha_limite,
                proveedor_nombre=row.get("ProveedorNombre"),
                proveedor_id=row.get("ProveedorId"),
                skus=sku_map.get(nombre, []),
                proyeccion_stock=_build_proyeccion(stock, vel_diaria, lead_time),
            )
        )

    # Sort: CRITICO first, then BAJO, OK, EXCESO; within same estado by vendidas desc
    estado_order = {"CRITICO": 0, "BAJO": 1, "OK": 2, "EXCESO": 3}
    items.sort(key=lambda i: (estado_order.get(i.estado, 9), -i.vendidas_30d))

    # Summary cards
    inversion_total = sum(i.inversion_sugerida for i in items)
    productos_criticos = sum(1 for i in items if i.estado == "CRITICO")
    comprar_7d = sum(
        1 for i in items
        if i.fecha_limite_compra is not None
        and i.fecha_limite_compra <= (today + timedelta(days=7)).isoformat()
    ) + sum(1 for i in items if i.fecha_limite_compra is None and i.cobertura_dias < i.punto_reorden)
    productos_exceso = sum(1 for i in items if i.estado == "EXCESO")

    return RecomendacionAvanzadaResponse(
        items=items,
        inversion_total_sugerida=round(inversion_total, 2),
        productos_criticos=productos_criticos,
        comprar_antes_7d=comprar_7d,
        productos_exceso=productos_exceso,
    )


# ── Update clasificacion / lead time ──────────────────────────────────────────

async def update_clasificacion(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    data: ClasificacionUpdate,
) -> None:
    engine = await _get_engine(platform_session, tenant_id, registry)
    try:
        await _ensure_advanced_tables(engine)
    except Exception:
        pass

    sets: list[str] = []
    params: dict[str, Any] = {"pn_id": data.producto_nombre_id}
    if data.tipo_recompra is not None:
        sets.append("TipoRecompra = :tipo")
        params["tipo"] = data.tipo_recompra
    if data.stock_seguridad_dias is not None:
        sets.append("StockSeguridadDias = :seg")
        params["seg"] = data.stock_seguridad_dias

    if not sets:
        return

    sets.append("ModificadoEn = SYSUTCDATETIME()")
    set_clause = ", ".join(sets)

    upsert_q = text(f"""
        MERGE ProductoClasificacion AS target
        USING (SELECT :pn_id AS ProductoNombreId) AS source
        ON target.ProductoNombreId = source.ProductoNombreId
        WHEN MATCHED THEN UPDATE SET {set_clause}
        WHEN NOT MATCHED THEN INSERT (ProductoNombreId, {', '.join(
            (['TipoRecompra'] if data.tipo_recompra is not None else []) +
            (['StockSeguridadDias'] if data.stock_seguridad_dias is not None else [])
        )})
        VALUES (:pn_id, {', '.join(
            ([':tipo'] if data.tipo_recompra is not None else []) +
            ([':seg'] if data.stock_seguridad_dias is not None else [])
        )});
    """)

    async with engine.begin() as conn:
        await conn.execute(upsert_q, params)


async def update_lead_time(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    data: LeadTimeUpdate,
) -> None:
    engine = await _get_engine(platform_session, tenant_id, registry)
    try:
        await _ensure_advanced_tables(engine)
    except Exception:
        pass

    async with engine.begin() as conn:
        await conn.execute(
            text("UPDATE Proveedores SET LeadTimeDias = :lt WHERE ProveedorId = :pid"),
            {"lt": data.lead_time_dias, "pid": data.proveedor_id},
        )
