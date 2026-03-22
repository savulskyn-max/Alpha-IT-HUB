"""
Analytics service: executes SQL queries against the tenant's Azure SQL database.
Uses asyncio.gather for parallel query execution to minimize latency.
"""
from __future__ import annotations

import asyncio
import time
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
    CalendarioMesKpi,
    CeldaHeatmap,
    ClasificacionUpdate,
    ComprasResponse,
    FamiliaRecompra,
    FiltrosDisponibles,
    FlujoCajaEntry,
    ForecastResponse,
    GastosResponse,
    KpiSummary,
    LeadTimeUpdate,
    MasVendido,
    MultilocalProducto,
    OrdenCalendario,
    OrdenCompraPlanCreate,
    OrdenCompraPlanUpdate,
    PrediccionesResponse,
    ProductForecast,
    ProductoStock,
    RecomendacionAvanzadaItem,
    RecomendacionAvanzadaResponse,
    RecomendacionAvanzadaSku,
    RecomendacionItem,
    RecomendacionSimpleResponse,
    RecomendacionSku,
    ColorDistribucion,
    ModelCurveResponse,
    ModeloStock,
    ProductModelsResponse,
    StockAnalysisAlerta,
    StockAnalysisKpis,
    StockAnalysisProducto,
    StockAnalysisResponse,
    StockAnalysisTransferencia,
    StockCalendarResponse,
    StockMultilocalResponse,
    StockResponse,
    TalleColorVenta,
    TalleDistribucion,
    TemporadaConfigSchema,
    TransferenciaMultilocal,
    VentasPorFecha,
    VentasResponse,
)

logger = structlog.get_logger()


# ── Analysis cache (5-minute TTL, invalidated by write events) ────────────────

_ANALYSIS_CACHE: dict[str, tuple[float, StockAnalysisResponse]] = {}
_ANALYSIS_CACHE_TTL = 300  # seconds


def _analysis_cache_key(tenant_id: str, local_id: int | None, modo: str) -> str:
    return f"{tenant_id}:{local_id}:{modo}"


def _analysis_cache_get(key: str) -> StockAnalysisResponse | None:
    entry = _ANALYSIS_CACHE.get(key)
    if entry is None:
        return None
    ts, data = entry
    if time.monotonic() - ts > _ANALYSIS_CACHE_TTL:
        del _ANALYSIS_CACHE[key]
        return None
    return data


def _analysis_cache_set(key: str, data: StockAnalysisResponse) -> None:
    _ANALYSIS_CACHE[key] = (time.monotonic(), data)


def _analysis_cache_invalidate(tenant_id: str) -> None:
    stale = [k for k in _ANALYSIS_CACHE if k.startswith(f"{tenant_id}:")]
    for k in stale:
        del _ANALYSIS_CACHE[k]


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
                   StockSeguridadDias,
                   TemporadaMesInicio,
                   TemporadaMesFin,
                   TemporadaMesLiquidacion,
                   TemporadaCantidadEstimada
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
            ISNULL(cl.StockSeguridadDias, 7) AS StockSeguridadDias,
            cl.TemporadaMesInicio,
            cl.TemporadaMesFin,
            cl.TemporadaMesLiquidacion,
            cl.TemporadaCantidadEstimada
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
            7 AS StockSeguridadDias,
            NULL AS TemporadaMesInicio,
            NULL AS TemporadaMesFin,
            NULL AS TemporadaMesLiquidacion,
            NULL AS TemporadaCantidadEstimada
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

    # Monthly sales by ProductoNombreId (for temporada timeline chart)
    ventas_mensuales_q = text("""
        SELECT p.ProductoNombreId,
               MONTH(vc.Fecha) AS Mes,
               YEAR(vc.Fecha) AS Anio,
               SUM(vd.Cantidad) AS Unidades
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Anulada = 0
          AND vc.Fecha >= DATEADD(MONTH, -24, GETDATE())
          AND (:local_id IS NULL OR vc.LocalID = :local_id)
        GROUP BY p.ProductoNombreId, MONTH(vc.Fecha), YEAR(vc.Fecha)
    """)
    ventas_mensuales_q_fb = text("""
        SELECT p.ProductoNombreId,
               MONTH(vc.Fecha) AS Mes,
               YEAR(vc.Fecha) AS Anio,
               SUM(vd.Cantidad) AS Unidades
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Fecha >= DATEADD(MONTH, -24, GETDATE())
          AND (:local_id IS NULL OR vc.LocalID = :local_id)
        GROUP BY p.ProductoNombreId, MONTH(vc.Fecha), YEAR(vc.Fecha)
    """)

    r_main, r_sku, r_ventas_m = await asyncio.gather(
        _run_safe(engine, main_q, params),
        _run_safe(engine, sku_q, params),
        _run_safe(engine, ventas_mensuales_q, params),
    )

    if r_main is None:
        r_main = await _run_safe(engine, main_q_fallback, params)
    if r_sku is None:
        r_sku = await _run_safe(engine, sku_q_fallback, params)
    if r_ventas_m is None:
        r_ventas_m = await _run_safe(engine, ventas_mensuales_q_fb, params)

    main_rows = _rows(r_main) if r_main else []
    sku_rows = _rows(r_sku) if r_sku else []
    ventas_m_rows = _rows(r_ventas_m) if r_ventas_m else []

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

    # Build monthly sales map: pn_id → {(year, month): units}
    ventas_m_map: dict[int, dict[tuple[int, int], int]] = {}
    for row in ventas_m_rows:
        pn_id_m = int(row.get("ProductoNombreId") or 0)
        mes = int(row.get("Mes") or 0)
        anio = int(row.get("Anio") or 0)
        unidades = int(row.get("Unidades") or 0)
        ventas_m_map.setdefault(pn_id_m, {})[(anio, mes)] = unidades

    today = _today()
    current_year = today.year
    current_month = today.month

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

    def _month_in_range(month: int, start: int, end: int) -> bool:
        """Check if month is in [start, end] range, handling year wrap."""
        if start <= end:
            return start <= month <= end
        return month >= start or month <= end

    def _fecha_orden_temporada(
        mes_inicio: int, lead_time: int, seguridad: int
    ) -> date:
        """Calculate the order emission date for the next upcoming season."""
        # Build target date: 1st of mes_inicio in the appropriate year
        target_year = current_year
        target_date = date(target_year, mes_inicio, 1)
        # If start already passed this year, use next year
        if target_date < today:
            target_date = date(target_year + 1, mes_inicio, 1)
        return target_date - timedelta(days=lead_time + seguridad)

    def _temporada_fase(
        mes_inicio: int | None, mes_fin: int | None, mes_liq: int | None,
        lead_time: int, seguridad: int,
    ) -> tuple[str, date | None]:
        """Return (fase, fecha_orden) for a Temporada product."""
        if mes_inicio is None or mes_fin is None:
            return "fuera", None
        mes_liq_eff = mes_liq if mes_liq is not None else mes_fin

        fecha_orden = _fecha_orden_temporada(mes_inicio, lead_time, seguridad)

        # Check which phase we're in
        if _month_in_range(current_month, mes_inicio, mes_liq_eff - 1 if mes_liq_eff > 1 else 12):
            return "en_temporada", fecha_orden
        if mes_liq is not None and _month_in_range(current_month, mes_liq_eff, mes_fin):
            return "liquidacion", fecha_orden
        # Pre-temporada: between fecha_orden and start of season
        if fecha_orden <= today:
            return "pre_temporada", fecha_orden
        return "fuera", fecha_orden

    def _ventas_temporada_anterior(
        pn_id: int, mes_inicio: int, mes_fin: int,
    ) -> int | None:
        """Sum sales from the same season window in the previous year."""
        monthly = ventas_m_map.get(pn_id, {})
        if not monthly:
            return None
        total = 0
        found = False
        # Iterate months of the season in last year's data
        m = mes_inicio
        while True:
            # Check both last year and two years ago for cross-year seasons
            for y in [current_year - 1, current_year - 2]:
                if (y, m) in monthly:
                    total += monthly[(y, m)]
                    found = True
            if m == mes_fin:
                break
            m = m % 12 + 1
            if m == mes_inicio:
                break  # safety: full loop
        return total if found else None

    def _build_ventas_mensuales(pn_id: int) -> list[dict[str, Any]]:
        """Build [{mes: 1, unidades: X}, ...] for the last 12 months of last year."""
        monthly = ventas_m_map.get(pn_id, {})
        result = []
        for m in range(1, 13):
            # Prefer last year data; fallback to 2 years ago
            u = monthly.get((current_year - 1, m), monthly.get((current_year - 2, m), 0))
            result.append({"mes": m, "unidades": u})
        return result

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

        # Temporada config from DB
        t_mes_inicio = row.get("TemporadaMesInicio")
        t_mes_fin = row.get("TemporadaMesFin")
        t_mes_liq = row.get("TemporadaMesLiquidacion")
        t_cant_est = row.get("TemporadaCantidadEstimada")
        t_mes_inicio = int(t_mes_inicio) if t_mes_inicio is not None else None
        t_mes_fin = int(t_mes_fin) if t_mes_fin is not None else None
        t_mes_liq = int(t_mes_liq) if t_mes_liq is not None else None
        t_cant_est = int(t_cant_est) if t_cant_est is not None else None

        # Use 90d velocity as base (spec V1)
        vel_diaria = round(v90 / 90.0, 2) if v90 > 0 else 0.0
        cobertura = round(stock / vel_diaria, 0) if vel_diaria > 0 else 999.0
        punto_reorden = lead_time + seguridad

        # ── Temporada-specific logic ──────────────────────────────────────
        temporada_fase: str | None = None
        temporada_fecha_orden: str | None = None
        temporada_ventas_ant: int | None = None
        temporada_alerta: str | None = None
        ventas_mens: list[dict[str, Any]] = []

        if tipo == "Temporada":
            fase, fecha_ord = _temporada_fase(
                t_mes_inicio, t_mes_fin, t_mes_liq, lead_time, seguridad
            )
            temporada_fase = fase
            if fecha_ord is not None:
                temporada_fecha_orden = fecha_ord.isoformat()

            if t_mes_inicio is not None and t_mes_fin is not None:
                temporada_ventas_ant = _ventas_temporada_anterior(
                    pn_id, t_mes_inicio, t_mes_fin
                )

            ventas_mens = _build_ventas_mensuales(pn_id)

            # Sugerencia and estado based on fase
            if fase == "fuera":
                sugerencia = 0
                estado = "OK"  # grey in UI, labeled "Fuera de temp."
                fecha_limite = None
            elif fase == "pre_temporada":
                # Suggest: ventas_anterior × 1.1 or manual estimate
                if temporada_ventas_ant is not None and temporada_ventas_ant > 0:
                    sugerencia = int(temporada_ventas_ant * 1.1)
                elif t_cant_est is not None and t_cant_est > 0:
                    sugerencia = t_cant_est
                else:
                    # Fallback: average monthly × months of season × 1.2
                    monthly_avg = v90 / 3.0 if v90 > 0 else 0
                    meses_temp = 0
                    if t_mes_inicio is not None and t_mes_fin is not None:
                        if t_mes_inicio <= t_mes_fin:
                            meses_temp = t_mes_fin - t_mes_inicio + 1
                        else:
                            meses_temp = (12 - t_mes_inicio + 1) + t_mes_fin
                    sugerencia = int(monthly_avg * max(meses_temp, 1) * 1.2)
                estado = "CRITICO"  # Orange alert: "¡Emitir orden!"
                fecha_limite = temporada_fecha_orden
            elif fase == "en_temporada":
                # Normal velocity logic applies during active season
                sugerencia = max(0, int(vel_diaria * punto_reorden * 1.2) - stock)
                estado = _estado(cobertura, punto_reorden)
                # Compare real vs projected velocity
                if temporada_ventas_ant is not None and t_mes_inicio is not None and t_mes_fin is not None:
                    if t_mes_inicio <= t_mes_fin:
                        meses_temp = t_mes_fin - t_mes_inicio + 1
                    else:
                        meses_temp = (12 - t_mes_inicio + 1) + t_mes_fin
                    dias_temp = meses_temp * 30
                    vel_proyectada = temporada_ventas_ant / max(dias_temp, 1)
                    if vel_diaria > vel_proyectada * 1.3:
                        temporada_alerta = "Demanda superior a la esperada, considerar reposición urgente"
                    elif vel_diaria < vel_proyectada * 0.7 and vel_proyectada > 0:
                        temporada_alerta = "Demanda menor a la esperada, considerar adelantar liquidación"
                dias_hasta = cobertura - punto_reorden if cobertura < 999 else 999
                fecha_limite = (today + timedelta(days=int(dias_hasta))).isoformat() if 0 < dias_hasta < 999 else None
            else:  # liquidacion
                sugerencia = 0
                estado = "BAJO"  # Yellow in UI, labeled "Liquidación"
                fecha_limite = None

            inversion = round(sugerencia * costo, 2)

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
                    proyeccion_stock=[],  # Temporada uses timeline chart instead
                    temporada_mes_inicio=t_mes_inicio,
                    temporada_mes_fin=t_mes_fin,
                    temporada_mes_liquidacion=t_mes_liq,
                    temporada_cantidad_estimada=t_cant_est,
                    temporada_fase=temporada_fase,
                    temporada_fecha_orden=temporada_fecha_orden,
                    temporada_ventas_anterior=temporada_ventas_ant,
                    temporada_alerta=temporada_alerta,
                    ventas_mensuales=ventas_mens,
                )
            )
            continue

        # ── Básico / Quiebre logic (unchanged) ────────────────────────────
        if tipo == "Quiebre":
            sugerencia = int(vel_diaria * lead_time * 1.1) if stock == 0 else 0
        else:  # Basico
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

    # Sort: CRITICO first, then BAJO, OK, EXCESO; pre_temporada items join CRITICO
    estado_order = {"CRITICO": 0, "BAJO": 1, "OK": 2, "EXCESO": 3}
    items.sort(key=lambda i: (estado_order.get(i.estado, 9), -i.vendidas_30d))

    # Summary cards
    inversion_total = sum(i.inversion_sugerida for i in items)
    productos_criticos = sum(1 for i in items if i.estado == "CRITICO")
    comprar_7d = sum(
        1 for i in items
        if i.fecha_limite_compra is not None
        and i.fecha_limite_compra <= (today + timedelta(days=7)).isoformat()
    ) + sum(
        1 for i in items
        if i.fecha_limite_compra is None and i.cobertura_dias < i.punto_reorden
        and i.temporada_fase not in ("fuera", "liquidacion")
    ) + sum(
        1 for i in items if i.temporada_fase == "pre_temporada"
    )
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
    insert_cols: list[str] = []
    insert_vals: list[str] = []
    params: dict[str, Any] = {"pn_id": data.producto_nombre_id}

    def _add(col: str, param_name: str, value: Any) -> None:
        if value is not None:
            sets.append(f"{col} = :{param_name}")
            insert_cols.append(col)
            insert_vals.append(f":{param_name}")
            params[param_name] = value

    _add("TipoRecompra", "tipo", data.tipo_recompra)
    _add("StockSeguridadDias", "seg", data.stock_seguridad_dias)
    _add("TemporadaMesInicio", "t_inicio", data.temporada_mes_inicio)
    _add("TemporadaMesFin", "t_fin", data.temporada_mes_fin)
    _add("TemporadaMesLiquidacion", "t_liq", data.temporada_mes_liquidacion)
    _add("TemporadaCantidadEstimada", "t_cant", data.temporada_cantidad_estimada)

    if not sets:
        return

    sets.append("ModificadoEn = SYSUTCDATETIME()")
    set_clause = ", ".join(sets)

    upsert_q = text(f"""
        MERGE ProductoClasificacion AS target
        USING (SELECT :pn_id AS ProductoNombreId) AS source
        ON target.ProductoNombreId = source.ProductoNombreId
        WHEN MATCHED THEN UPDATE SET {set_clause}
        WHEN NOT MATCHED THEN INSERT (ProductoNombreId, {', '.join(insert_cols)})
        VALUES (:pn_id, {', '.join(insert_vals)});
    """)

    async with engine.begin() as conn:
        await conn.execute(upsert_q, params)
    _analysis_cache_invalidate(tenant_id)


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
    _analysis_cache_invalidate(tenant_id)


# ── Stock Analysis — Motor de Inteligencia ────────────────────────────────────

async def get_stock_analysis(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    local_id: int | None = None,
    modo: str = "avanzado",
) -> StockAnalysisResponse:
    """Unified stock analysis endpoint with adaptive demand model and 5-min cache."""
    cache_key = _analysis_cache_key(tenant_id, local_id, modo)
    cached = _analysis_cache_get(cache_key)
    if cached is not None:
        return cached

    engine = await _get_engine(platform_session, tenant_id, registry)

    try:
        await _ensure_advanced_tables(engine)
    except Exception:
        pass

    costo_col = await _get_costo_col_producto(engine, tenant_id)
    _cost = costo_col or "PrecioCompra"

    params: dict[str, Any] = {"local_id": local_id}

    # ── KPI queries ─────────────────────────────────────────────────────────

    q_valor_stock = text(f"""
        SELECT ISNULL(SUM(ISNULL(p.{_cost}, 0) * ISNULL(p.Stock, 0)), 0) AS ValorStock
        FROM Productos p
        WHERE (:local_id IS NULL OR p.LocalID = :local_id)
          AND p.Stock > 0
    """)

    q_rotacion = text("""
        WITH ventas_periodo AS (
            SELECT SUM(vd.Cantidad) AS UnidadesVendidas
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

    q_calce = text(f"""
        WITH compras_periodo AS (
            SELECT ISNULL(SUM(cc.Total), 0) AS TotalCompras
            FROM CompraCabecera cc
            WHERE cc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR cc.LocalId = :local_id)
        ),
        cmv_diario AS (
            SELECT
                ISNULL(
                    SUM(vd.Cantidad * ISNULL(p.{_cost}, 0))
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
            CASE WHEN cd.CMVDiario = 0 THEN 999
            ELSE CEILING(cp.TotalCompras / cd.CMVDiario)
            END AS CalceDias
        FROM compras_periodo cp, cmv_diario cd
    """)

    q_compras = text("""
        SELECT ISNULL(SUM(cc.Total), 0) AS ComprasPeriodo
        FROM CompraCabecera cc
        WHERE cc.Fecha >= DATEADD(MONTH, -1, GETDATE())
          AND (:local_id IS NULL OR cc.LocalId = :local_id)
    """)

    q_a_reponer = text("""
        WITH promedio_venta AS (
            SELECT vd.ProductoID,
                   SUM(vd.Cantidad) * 1.0 / 30 AS PromDiario
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY vd.ProductoID
        )
        SELECT COUNT(DISTINCT p.ProductoNombreId) AS ProductosAReponer
        FROM Productos p
        INNER JOIN promedio_venta pv ON p.ProductoID = pv.ProductoID
        WHERE p.Stock < CEILING(pv.PromDiario * 30)
          AND (:local_id IS NULL OR p.LocalID = :local_id)
    """)

    q_skus = text("""
        SELECT COUNT(*) AS TotalSKUs
        FROM Productos p
        WHERE (:local_id IS NULL OR p.LocalID = :local_id)
    """)

    # Revenue per ProductoNombre (last 30d) for clase_a computation
    q_revenue = text("""
        SELECT p.ProductoNombreId,
               SUM(vd.Cantidad * vd.PrecioUnitario) AS Revenue
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Anulada = 0
          AND vc.Fecha >= DATEADD(MONTH, -1, GETDATE())
          AND (:local_id IS NULL OR vc.LocalID = :local_id)
        GROUP BY p.ProductoNombreId
    """)

    # ── Product main query (velocity + cost + lead time + clasificacion) ────

    main_q = text(f"""
        WITH ventas_90d AS (
            SELECT p.ProductoNombreId, SUM(vd.Cantidad) AS Vendidas90d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ventas_30d AS (
            SELECT p.ProductoNombreId, SUM(vd.Cantidad) AS Vendidas30d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ventas_30_60d AS (
            SELECT p.ProductoNombreId, SUM(vd.Cantidad) AS Vendidas3060d
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
            SELECT ProductoNombreId, TipoRecompra, StockSeguridadDias,
                   TemporadaMesInicio, TemporadaMesFin,
                   TemporadaMesLiquidacion, TemporadaCantidadEstimada
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
            ISNULL(cl.StockSeguridadDias, 7) AS StockSeguridadDias,
            cl.TemporadaMesInicio,
            cl.TemporadaMesFin,
            cl.TemporadaMesLiquidacion,
            cl.TemporadaCantidadEstimada
        FROM ProductoNombre pn
        LEFT JOIN ventas_90d v90 ON pn.Id = v90.ProductoNombreId
        LEFT JOIN ventas_30d v30 ON pn.Id = v30.ProductoNombreId
        LEFT JOIN ventas_30_60d v3060 ON pn.Id = v3060.ProductoNombreId
        LEFT JOIN stock_actual s ON pn.Id = s.ProductoNombreId
        LEFT JOIN ultimo_proveedor up ON pn.Id = up.ProductoNombreId AND up.rn = 1
        LEFT JOIN clasificacion cl ON pn.Id = cl.ProductoNombreId
        WHERE ISNULL(s.StockTotal, 0) > 0 OR ISNULL(v90.Vendidas90d, 0) > 0
    """)

    # Fallback without Anulada / without ProductoClasificacion / without LeadTimeDias
    main_q_fallback = text(f"""
        WITH ventas_90d AS (
            SELECT p.ProductoNombreId, SUM(vd.Cantidad) AS Vendidas90d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Fecha >= DATEADD(DAY, -90, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ventas_30d AS (
            SELECT p.ProductoNombreId, SUM(vd.Cantidad) AS Vendidas30d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ventas_30_60d AS (
            SELECT p.ProductoNombreId, SUM(vd.Cantidad) AS Vendidas3060d
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
            7 AS StockSeguridadDias,
            NULL AS TemporadaMesInicio,
            NULL AS TemporadaMesFin,
            NULL AS TemporadaMesLiquidacion,
            NULL AS TemporadaCantidadEstimada
        FROM ProductoNombre pn
        LEFT JOIN ventas_90d v90 ON pn.Id = v90.ProductoNombreId
        LEFT JOIN ventas_30d v30 ON pn.Id = v30.ProductoNombreId
        LEFT JOIN ventas_30_60d v3060 ON pn.Id = v3060.ProductoNombreId
        LEFT JOIN stock_actual s ON pn.Id = s.ProductoNombreId
        LEFT JOIN ultimo_proveedor up ON pn.Id = up.ProductoNombreId AND up.rn = 1
        WHERE ISNULL(s.StockTotal, 0) > 0 OR ISNULL(v90.Vendidas90d, 0) > 0
    """)

    # ── Year-ago data for factorCalendario and tendenciaInteranual ───────────

    q_año_ant = text("""
        WITH ventas_90d_ant AS (
            SELECT p.ProductoNombreId,
                   SUM(vd.Cantidad) AS Vendidas90dAnt
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -455, GETDATE())
              AND vc.Fecha <  DATEADD(DAY, -365, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ventas_anuales_ant AS (
            SELECT p.ProductoNombreId,
                   SUM(vd.Cantidad) AS VentasAnualesAnt,
                   COUNT(DISTINCT CAST(YEAR(vc.Fecha) AS VARCHAR) + '-' + CAST(MONTH(vc.Fecha) AS VARCHAR)) AS MesesConDatosAnt
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -730, GETDATE())
              AND vc.Fecha <  DATEADD(DAY, -365, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        )
        SELECT pn.Id AS ProductoNombreId,
               ISNULL(v.Vendidas90dAnt, 0) AS Vendidas90dAnt,
               ISNULL(va.VentasAnualesAnt, 0) AS VentasAnualesAnt,
               ISNULL(va.MesesConDatosAnt, 0) AS MesesConDatosAnt
        FROM ProductoNombre pn
        LEFT JOIN ventas_90d_ant v ON pn.Id = v.ProductoNombreId
        LEFT JOIN ventas_anuales_ant va ON pn.Id = va.ProductoNombreId
    """)

    q_año_ant_fallback = text("""
        WITH ventas_90d_ant AS (
            SELECT p.ProductoNombreId,
                   SUM(vd.Cantidad) AS Vendidas90dAnt
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Fecha >= DATEADD(DAY, -455, GETDATE())
              AND vc.Fecha <  DATEADD(DAY, -365, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        ),
        ventas_anuales_ant AS (
            SELECT p.ProductoNombreId,
                   SUM(vd.Cantidad) AS VentasAnualesAnt,
                   COUNT(DISTINCT CAST(YEAR(vc.Fecha) AS VARCHAR) + '-' + CAST(MONTH(vc.Fecha) AS VARCHAR)) AS MesesConDatosAnt
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            WHERE vc.Fecha >= DATEADD(DAY, -730, GETDATE())
              AND vc.Fecha <  DATEADD(DAY, -365, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        )
        SELECT pn.Id AS ProductoNombreId,
               ISNULL(v.Vendidas90dAnt, 0) AS Vendidas90dAnt,
               ISNULL(va.VentasAnualesAnt, 0) AS VentasAnualesAnt,
               ISNULL(va.MesesConDatosAnt, 0) AS MesesConDatosAnt
        FROM ProductoNombre pn
        LEFT JOIN ventas_90d_ant v ON pn.Id = v.ProductoNombreId
        LEFT JOIN ventas_anuales_ant va ON pn.Id = va.ProductoNombreId
    """)

    # ── SKU counts per ProductoNombre ────────────────────────────────────────

    q_sku_counts = text("""
        SELECT pn.Id AS ProductoNombreId,
               COUNT(p.ProductoID) AS CantidadModelos,
               SUM(CASE WHEN ISNULL(p.Stock, 0) = 0 THEN 1 ELSE 0 END) AS ModelosCriticos
        FROM Productos p
        INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        WHERE (:local_id IS NULL OR p.LocalID = :local_id)
        GROUP BY pn.Id
    """)

    # ── Per-local stock (for transferencias, only when local_id is NULL) ────

    q_por_local: Any = None
    if local_id is None:
        q_por_local = text(f"""
            WITH ventas_90d AS (
                SELECT p.ProductoNombreId, l.LocalID,
                       SUM(vd.Cantidad) AS Vendidas90d
                FROM VentaDetalle vd
                INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
                INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
                INNER JOIN Locales l ON vc.LocalID = l.LocalID
                WHERE vc.Anulada = 0
                  AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
                GROUP BY p.ProductoNombreId, l.LocalID
            )
            SELECT p.ProductoNombreId,
                   pn.Nombre AS ProductoNombre,
                   l.LocalID,
                   l.Nombre AS LocalNombre,
                   SUM(ISNULL(p.Stock, 0)) AS StockTotal,
                   ISNULL(v.Vendidas90d, 0) AS Vendidas90d,
                   AVG(ISNULL(p.{_cost}, 0)) AS CostoPromedio
            FROM Productos p
            INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
            INNER JOIN Locales l ON p.LocalID = l.LocalID
            LEFT JOIN ventas_90d v ON p.ProductoNombreId = v.ProductoNombreId
                                   AND l.LocalID = v.LocalID
            GROUP BY p.ProductoNombreId, pn.Nombre, l.LocalID, l.Nombre, v.Vendidas90d
        """)

    # ── Execute all queries in parallel ─────────────────────────────────────

    queries = [
        _run_safe(engine, q_valor_stock, params),
        _run_safe(engine, q_rotacion, params),
        _run_safe(engine, q_calce, params),
        _run_safe(engine, q_compras, params),
        _run_safe(engine, q_a_reponer, params),
        _run_safe(engine, q_skus, params),
        _run_safe(engine, q_revenue, params),
        _run_safe(engine, main_q, params),
        _run_safe(engine, q_año_ant, params),
        _run_safe(engine, q_sku_counts, params),
    ]
    if q_por_local is not None:
        queries.append(_run_safe(engine, q_por_local, {}))

    results = await asyncio.gather(*queries)

    (
        r_valor, r_rotacion, r_calce, r_compras,
        r_a_reponer, r_skus, r_revenue, r_main,
        r_año_ant, r_sku_counts
    ) = results[:10]
    r_por_local = results[10] if len(results) > 10 else None

    # Retry fallbacks where needed
    if r_main is None:
        r_main = await _run_safe(engine, main_q_fallback, params)
    if r_año_ant is None:
        r_año_ant = await _run_safe(engine, q_año_ant_fallback, params)

    # ── Build KPIs ───────────────────────────────────────────────────────────

    valor_stock = float((r_valor.scalar() if r_valor else None) or 0)
    rotacion = float((r_rotacion.scalar() if r_rotacion else None) or 0)
    calce = float((r_calce.scalar() if r_calce else None) or 999)
    compras_periodo = float((r_compras.scalar() if r_compras else None) or 0)
    a_reponer = int((r_a_reponer.scalar() if r_a_reponer else None) or 0)
    total_skus = int((r_skus.scalar() if r_skus else None) or 0)

    # clase_a: count ProductoNombre representing 80% of revenue (Pareto)
    revenue_rows = _rows(r_revenue) if r_revenue else []
    revenue_sorted = sorted(
        [float(row.get("Revenue") or 0) for row in revenue_rows],
        reverse=True,
    )
    total_rev = sum(revenue_sorted)
    clase_a = 0
    if total_rev > 0:
        acum = 0.0
        for r in revenue_sorted:
            acum += r
            clase_a += 1
            if acum >= total_rev * 0.80:
                break

    kpis = StockAnalysisKpis(
        valor_stock=round(valor_stock, 2),
        rotacion=rotacion,
        calce=calce,
        compras_periodo=round(compras_periodo, 2),
        clase_a=clase_a,
        a_reponer=a_reponer,
        total_skus=total_skus,
    )

    # ── Build lookup maps ────────────────────────────────────────────────────

    main_rows = _rows(r_main) if r_main else []

    año_ant_map: dict[int, tuple[int, int, int]] = {}  # pn_id → (v90d_ant, v_anual_ant, meses_con_datos)
    for row in (_rows(r_año_ant) if r_año_ant else []):
        pn_id_a = int(row.get("ProductoNombreId") or 0)
        año_ant_map[pn_id_a] = (
            int(row.get("Vendidas90dAnt") or 0),
            int(row.get("VentasAnualesAnt") or 0),
            int(row.get("MesesConDatosAnt") or 0),
        )

    sku_count_map: dict[int, tuple[int, int]] = {}  # pn_id → (cantidad, criticos)
    for row in (_rows(r_sku_counts) if r_sku_counts else []):
        pn_id_s = int(row.get("ProductoNombreId") or 0)
        sku_count_map[pn_id_s] = (
            int(row.get("CantidadModelos") or 0),
            int(row.get("ModelosCriticos") or 0),
        )

    # ── Helper functions ─────────────────────────────────────────────────────

    today = _today()
    current_year = today.year
    current_month = today.month

    def _clamp(v: float, lo: float, hi: float) -> float:
        return max(lo, min(hi, v))

    def _compute_factors(
        v90d: int, v30d: int, v3060d: int,
        v90d_ant: int, v_anual_ant: int,
        tipo: str,
        meses_con_datos_ant: int = 0,
    ) -> tuple[float, float, float]:
        """Return (velocidadBase, factorTendencia, factorCalendario).

        Seasonal factor smoothing rules:
        - If < 12 months of prior-year data → factor = 1.0 (insufficient baseline)
        - With only 1 year of baseline data → clamp factor to [0.5, 2.0]
        - Smoothing: blend raw factor towards 1.0 to reduce single-year noise
        """
        velocidad_base = round(v90d / 90.0, 4) if v90d > 0 else 0.0

        # Short-term trend: 30d velocity vs 30-60d velocity
        vel_30 = v30d / 30.0
        vel_3060 = v3060d / 30.0
        if vel_3060 > 0:
            factor_tendencia = _clamp(vel_30 / vel_3060, 0.3, 3.0)
        elif vel_30 > 0:
            factor_tendencia = 1.0
        else:
            factor_tendencia = 1.0

        # Calendar/seasonal factor: same 90d window last year vs annual avg
        # With smoothing to avoid atypical-month inflation
        if v_anual_ant > 0 and meses_con_datos_ant >= 12:
            promedio_diario_ant = v_anual_ant / 365.0
            vel_mismo_periodo_ant = v90d_ant / 90.0
            raw_factor = vel_mismo_periodo_ant / promedio_diario_ant if promedio_diario_ant > 0 else 1.0
            # Smooth: blend 70% raw + 30% neutral to reduce single-year noise
            factor_calendario = 0.7 * raw_factor + 0.3
            # With only 1 year of baseline, clamp tightly to [0.5, 2.0]
            factor_calendario = _clamp(factor_calendario, 0.5, 2.0)
            # Adjust by tipo
            if tipo == "Temporada":
                factor_calendario = _clamp(factor_calendario * 1.3, 0.5, 2.5)
            elif tipo == "Basico":
                factor_calendario = 0.7 * factor_calendario + 0.3
        else:
            # Not enough historical data — no seasonal adjustment
            factor_calendario = 1.0

        return velocidad_base, round(factor_tendencia, 3), round(factor_calendario, 3)

    def _tendencia_interanual(v90d: int, v90d_ant: int) -> float:
        if v90d_ant > 0:
            return round((v90d - v90d_ant) / v90d_ant * 100.0, 1)
        return 0.0

    def _estado_from_cobertura(cobertura: float, punto_reorden: int) -> str:
        if cobertura < punto_reorden:
            return "CRITICO" if cobertura < 7 else "BAJO"
        if cobertura > 60:
            return "EXCESO"
        return "OK"

    def _month_in_range(month: int, start: int, end: int) -> bool:
        if start <= end:
            return start <= month <= end
        return month >= start or month <= end

    def _fecha_orden_temporada(mes_inicio: int, lead_time: int, seguridad: int) -> date:
        target = date(current_year, mes_inicio, 1)
        if target < today:
            target = date(current_year + 1, mes_inicio, 1)
        return target - timedelta(days=lead_time + seguridad)

    def _temporada_fase(
        mes_inicio: int | None, mes_fin: int | None, mes_liq: int | None,
        lead_time: int, seguridad: int,
    ) -> tuple[str, date | None]:
        if mes_inicio is None or mes_fin is None:
            return "fuera", None
        mes_liq_eff = mes_liq if mes_liq is not None else mes_fin
        fecha_orden = _fecha_orden_temporada(mes_inicio, lead_time, seguridad)
        if _month_in_range(current_month, mes_inicio, mes_liq_eff - 1 if mes_liq_eff > 1 else 12):
            return "en_temporada", fecha_orden
        if mes_liq is not None and _month_in_range(current_month, mes_liq_eff, mes_fin):
            return "liquidacion", fecha_orden
        if fecha_orden <= today:
            return "pre_temporada", fecha_orden
        return "fuera", fecha_orden

    # ── Build productos ──────────────────────────────────────────────────────

    productos: list[StockAnalysisProducto] = []

    for row in main_rows:
        pn_id = int(row.get("ProductoNombreId") or 0)
        nombre = str(row.get("Nombre") or "")
        v90d = int(row.get("Vendidas90d") or 0)
        v30d = int(row.get("Vendidas30d") or 0)
        v3060d = int(row.get("Vendidas3060d") or 0)
        stock = int(row.get("StockActual") or 0)
        costo = float(row.get("CostoPromedio") or 0)
        lead_time = int(row.get("LeadTimeDias") or 7)
        seguridad = int(row.get("StockSeguridadDias") or 7)
        tipo = str(row.get("TipoRecompra") or "Basico")

        t_mes_inicio = row.get("TemporadaMesInicio")
        t_mes_fin = row.get("TemporadaMesFin")
        t_mes_liq = row.get("TemporadaMesLiquidacion")
        t_cant_est = row.get("TemporadaCantidadEstimada")
        t_mes_inicio = int(t_mes_inicio) if t_mes_inicio is not None else None
        t_mes_fin = int(t_mes_fin) if t_mes_fin is not None else None
        t_mes_liq = int(t_mes_liq) if t_mes_liq is not None else None
        t_cant_est = int(t_cant_est) if t_cant_est is not None else None

        v90d_ant, v_anual_ant, meses_con_datos_ant = año_ant_map.get(pn_id, (0, 0, 0))
        cant_modelos, modelos_criticos = sku_count_map.get(pn_id, (0, 0))

        # Adaptive demand model
        vel_base, f_tendencia, f_calendario = _compute_factors(
            v90d, v30d, v3060d, v90d_ant, v_anual_ant, tipo, meses_con_datos_ant
        )
        demanda_diaria = round(vel_base * f_tendencia * f_calendario, 4)
        cobertura = round(stock / demanda_diaria, 1) if demanda_diaria > 0 else 999.0
        punto_reorden = lead_time + seguridad
        tendencia_ioa = _tendencia_interanual(v90d, v90d_ant)

        # ── Temporada logic ──────────────────────────────────────────────────
        estado_temporada: str | None = None
        temporada_config: TemporadaConfigSchema | None = None
        fecha_orden_str: str | None = None
        sugerencia = 0
        estado = "OK"

        if tipo == "Temporada":
            fase, fecha_ord = _temporada_fase(
                t_mes_inicio, t_mes_fin, t_mes_liq, lead_time, seguridad
            )
            estado_temporada = fase
            if fecha_ord is not None:
                fecha_orden_str = fecha_ord.isoformat()
            temporada_config = TemporadaConfigSchema(
                mes_inicio=t_mes_inicio,
                mes_fin=t_mes_fin,
                mes_liquidacion=t_mes_liq,
                cantidad_estimada=t_cant_est,
            )
            if fase == "fuera":
                sugerencia = 0
                estado = "OK"
            elif fase == "pre_temporada":
                # Suggest based on prior season data or estimate
                if v90d_ant > 0:
                    # Use prior season sales as proxy (3 months of prior season)
                    sugerencia = int(v90d_ant * 1.1)
                elif t_cant_est is not None and t_cant_est > 0:
                    sugerencia = t_cant_est
                else:
                    monthly_avg = v90d / 3.0 if v90d > 0 else 0
                    meses_temp = 0
                    if t_mes_inicio is not None and t_mes_fin is not None:
                        if t_mes_inicio <= t_mes_fin:
                            meses_temp = t_mes_fin - t_mes_inicio + 1
                        else:
                            meses_temp = (12 - t_mes_inicio + 1) + t_mes_fin
                    sugerencia = int(monthly_avg * max(meses_temp, 1) * 1.2)
                estado = "CRITICO"
            elif fase == "en_temporada":
                sugerencia = max(0, int(demanda_diaria * punto_reorden * 1.2) - stock)
                estado = _estado_from_cobertura(cobertura, punto_reorden)
                dias_hasta = cobertura - punto_reorden if cobertura < 999 else 999
                if 0 < dias_hasta < 999:
                    fecha_orden_str = (today + timedelta(days=int(dias_hasta))).isoformat()
            else:  # liquidacion
                sugerencia = 0
                estado = "BAJO"

        elif tipo == "Quiebre":
            sugerencia = int(demanda_diaria * lead_time * 1.1) if stock == 0 else 0
            estado = _estado_from_cobertura(cobertura, punto_reorden)
            dias_hasta = cobertura - punto_reorden if cobertura < 999 else 999
            if dias_hasta > 0 and dias_hasta < 999 and demanda_diaria > 0:
                fecha_orden_str = (today + timedelta(days=int(dias_hasta))).isoformat()

        else:  # Basico
            sugerencia = max(0, int(demanda_diaria * punto_reorden * 1.2) - stock)
            estado = _estado_from_cobertura(cobertura, punto_reorden)
            dias_hasta = cobertura - punto_reorden if cobertura < 999 else 999
            if dias_hasta > 0 and dias_hasta < 999 and demanda_diaria > 0:
                fecha_orden_str = (today + timedelta(days=int(dias_hasta))).isoformat()

        inversion = round(sugerencia * costo, 2)

        productos.append(StockAnalysisProducto(
            producto_nombre_id=pn_id,
            nombre=nombre,
            tipo=tipo,
            lead_time=lead_time,
            seguridad=seguridad,
            stock_total=stock,
            velocidad_base=round(vel_base, 3),
            factor_tendencia=f_tendencia,
            factor_calendario=f_calendario,
            demanda_proyectada_diaria=round(demanda_diaria, 3),
            cobertura_dias=cobertura,
            estado=estado,
            sugerencia_compra=sugerencia,
            inversion_sugerida=inversion,
            fecha_orden=fecha_orden_str,
            tendencia_interanual=tendencia_ioa,
            estado_temporada=estado_temporada,
            temporada_config=temporada_config,
            cantidad_modelos=cant_modelos,
            modelos_criticos=modelos_criticos,
        ))

    # Sort: CRITICO first, then BAJO, OK, EXCESO
    _estado_order = {"CRITICO": 0, "BAJO": 1, "OK": 2, "EXCESO": 3}
    productos.sort(key=lambda p: (_estado_order.get(p.estado, 9), -p.stock_total))

    # ── Build alertas (top 5 by urgency) ────────────────────────────────────

    alertas: list[StockAnalysisAlerta] = []
    prioridad = 1

    # 1. Temporada pre-temporada (order must be emitted)
    for p in productos:
        if len(alertas) >= 5:
            break
        if p.estado_temporada == "pre_temporada":
            fecha_txt = p.temporada_config.mes_inicio if p.temporada_config and p.temporada_config.mes_inicio else "?"
            alertas.append(StockAnalysisAlerta(
                tipo="temporada",
                producto=p.nombre,
                mensaje=f"Emitir orden de temporada. Inversión estimada: ${p.inversion_sugerida:,.0f}",
                accion=f"Ordenar {p.sugerencia_compra} unidades al proveedor",
                prioridad=prioridad,
            ))
            prioridad += 1

    # 2. CRITICO (non-temporada)
    for p in productos:
        if len(alertas) >= 5:
            break
        if p.estado == "CRITICO" and p.estado_temporada != "pre_temporada":
            dias_txt = f"{p.cobertura_dias:.0f}" if p.cobertura_dias < 999 else "0"
            alertas.append(StockAnalysisAlerta(
                tipo="critico",
                producto=p.nombre,
                mensaje=f"Stock crítico: {dias_txt} días de cobertura. Punto de reorden: {p.lead_time + p.seguridad}d",
                accion=f"Comprar {p.sugerencia_compra} unidades urgente",
                prioridad=prioridad,
            ))
            prioridad += 1

    # 3. BAJO
    for p in productos:
        if len(alertas) >= 5:
            break
        if p.estado == "BAJO":
            alertas.append(StockAnalysisAlerta(
                tipo="bajo",
                producto=p.nombre,
                mensaje=f"Stock bajo: {p.cobertura_dias:.0f} días de cobertura",
                accion=f"Programar compra de {p.sugerencia_compra} unidades",
                prioridad=prioridad,
            ))
            prioridad += 1

    # 4. EXCESO (fill remaining slots)
    for p in productos:
        if len(alertas) >= 5:
            break
        if p.estado == "EXCESO":
            alertas.append(StockAnalysisAlerta(
                tipo="exceso",
                producto=p.nombre,
                mensaje=f"Sobrestock: {p.cobertura_dias:.0f} días de cobertura. Capital inmovilizado.",
                accion="Revisar estrategia de liquidación o descuentos",
                prioridad=prioridad,
            ))
            prioridad += 1

    # 5. LIQUIDACION (products with no rotation — immobilized capital)
    for p in productos:
        if len(alertas) >= 6:
            break
        if p.cobertura_dias >= 999 or (p.cobertura_dias >= 365 and p.demanda_proyectada_diaria <= 0.05):
            # Avoid duplicate if same product already has another alert
            if not any(a.producto == p.nombre for a in alertas):
                alertas.append(StockAnalysisAlerta(
                    tipo="liquidacion",
                    producto=p.nombre,
                    modelo=None,
                    mensaje=(
                        f"Capital inmovilizado: {p.stock_total} unidades sin rotación. "
                        f"Evaluar liquidación o transferencia a local con demanda."
                    ),
                    accion="Revisar liquidación · considerar descuento o transferencia",
                    prioridad=prioridad,
                ))
                prioridad += 1

    # ── Build transferencias (only when viewing all locales) ─────────────────

    transferencias: list[StockAnalysisTransferencia] = []

    if r_por_local is not None:
        por_local_rows = _rows(r_por_local)
        # Build map: pn_id → list of {local_id, local_nombre, stock, vel_diaria, costo}
        local_stock_map: dict[int, list[dict[str, Any]]] = {}
        for row in por_local_rows:
            pn_id_l = int(row.get("ProductoNombreId") or 0)
            v90 = int(row.get("Vendidas90d") or 0)
            vel = round(v90 / 90.0, 3) if v90 > 0 else 0.0
            stk = int(row.get("StockTotal") or 0)
            cov = round(stk / vel, 1) if vel > 0 else 999.0
            local_stock_map.setdefault(pn_id_l, []).append({
                "local_id": int(row.get("LocalID") or 0),
                "local_nombre": str(row.get("LocalNombre") or ""),
                "producto_nombre": str(row.get("ProductoNombre") or ""),
                "stock": stk,
                "velocidad": vel,
                "cobertura": cov,
                "costo": float(row.get("CostoPromedio") or 0),
            })

        for pn_id_l, locales_data in local_stock_map.items():
            if len(locales_data) < 2:
                continue
            exceso = [l for l in locales_data if l["cobertura"] > 45 and l["stock"] > 0]
            deficit = [l for l in locales_data if l["cobertura"] < 15 and l["velocidad"] > 0]
            for ex in exceso:
                for de in deficit:
                    if ex["local_id"] == de["local_id"]:
                        continue
                    # Suggest transferring enough to balance both to ~30d coverage
                    transfer_qty = min(
                        int((ex["cobertura"] - 30) * ex["velocidad"]),
                        int((30 - de["cobertura"]) * de["velocidad"]),
                    )
                    if transfer_qty <= 0:
                        continue
                    ahorro = round(transfer_qty * ex["costo"] * 0.15, 2)  # ~15% savings vs re-buying
                    transferencias.append(StockAnalysisTransferencia(
                        producto=ex["producto_nombre"],
                        local_origen=ex["local_nombre"],
                        local_destino=de["local_nombre"],
                        cantidad=transfer_qty,
                        ahorro=ahorro,
                    ))
                    if len(transferencias) >= 10:
                        break
                if len(transferencias) >= 10:
                    break

        # Sort by highest ahorro first
        transferencias.sort(key=lambda t: -t.ahorro)

    result = StockAnalysisResponse(
        kpis=kpis,
        productos=productos,
        alertas=alertas,
        transferencias=transferencias,
    )
    _analysis_cache_set(cache_key, result)
    return result


# ── Stock Analysis — Product Models (lazy detail) ─────────────────────────────

async def get_product_models(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    producto_nombre_id: int,
    *,
    local_id: int | None = None,
) -> ProductModelsResponse:
    """Lazy-loaded model detail for a single ProductoNombre.

    Returns models (Descripcion level) with stock, demand, coverage,
    plus projection/timeline data for charts.
    """
    engine = await _get_engine(platform_session, tenant_id, registry)
    costo_col = await _get_costo_col_producto(engine, tenant_id)
    _cost = costo_col or "PrecioCompra"

    try:
        await _ensure_advanced_tables(engine)
    except Exception:
        pass

    params: dict[str, Any] = {"pn_id": producto_nombre_id, "local_id": local_id}

    # Product header (nombre, tipo, lead_time, seguridad, proveedor_id, stock)
    q_header = text(f"""
        SELECT
            pn.Nombre,
            ISNULL(cl.TipoRecompra, 'Basico') AS TipoRecompra,
            ISNULL(cl.StockSeguridadDias, 7) AS StockSeguridadDias,
            cl.TemporadaMesInicio,
            cl.TemporadaMesFin,
            cl.TemporadaMesLiquidacion,
            cl.TemporadaCantidadEstimada,
            ISNULL(up.LeadTimeDias, 7) AS LeadTimeDias,
            up.ProveedorId,
            (SELECT SUM(ISNULL(p2.Stock, 0)) FROM Productos p2
             WHERE p2.ProductoNombreId = :pn_id
               AND (:local_id IS NULL OR p2.LocalID = :local_id)) AS StockTotal
        FROM ProductoNombre pn
        LEFT JOIN ProductoClasificacion cl ON pn.Id = cl.ProductoNombreId
        LEFT JOIN (
            SELECT p.ProductoNombreId,
                   prov.LeadTimeDias,
                   cc.ProveedorId,
                   ROW_NUMBER() OVER (PARTITION BY p.ProductoNombreId ORDER BY cc.Fecha DESC) AS rn
            FROM CompraDetalle cd
            INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
            INNER JOIN Productos p ON cd.ProductoId = p.ProductoID
            INNER JOIN Proveedores prov ON cc.ProveedorId = prov.ProveedorId
        ) up ON pn.Id = up.ProductoNombreId AND up.rn = 1
        WHERE pn.Id = :pn_id
    """)

    # Models (Descripcion level) with stock + sales
    q_models = text(f"""
        WITH ventas_30d AS (
            SELECT vd.ProductoID, SUM(vd.Cantidad) AS Vendidas30d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY vd.ProductoID
        )
        SELECT
            pd.Id AS DescripcionId,
            pd.Descripcion,
            SUM(ISNULL(p.Stock, 0)) AS Stock,
            SUM(ISNULL(v.Vendidas30d, 0)) AS Vendidas30d
        FROM Productos p
        INNER JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        LEFT JOIN ventas_30d v ON p.ProductoID = v.ProductoID
        WHERE p.ProductoNombreId = :pn_id
          AND (:local_id IS NULL OR p.LocalID = :local_id)
        GROUP BY pd.Id, pd.Descripcion
        HAVING SUM(ISNULL(p.Stock, 0)) > 0 OR SUM(ISNULL(v.Vendidas30d, 0)) > 0
        ORDER BY SUM(ISNULL(v.Vendidas30d, 0)) DESC
    """)

    # 90d velocity for projection
    q_vel = text("""
        SELECT SUM(vd.Cantidad) AS Vendidas90d
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Anulada = 0
          AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
          AND p.ProductoNombreId = :pn_id
          AND (:local_id IS NULL OR vc.LocalID = :local_id)
    """)

    # Monthly sales (last 24 months for temporada timeline)
    q_mensuales = text("""
        SELECT MONTH(vc.Fecha) AS Mes, YEAR(vc.Fecha) AS Anio,
               SUM(vd.Cantidad) AS Unidades
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Anulada = 0
          AND vc.Fecha >= DATEADD(MONTH, -24, GETDATE())
          AND p.ProductoNombreId = :pn_id
          AND (:local_id IS NULL OR vc.LocalID = :local_id)
        GROUP BY MONTH(vc.Fecha), YEAR(vc.Fecha)
    """)

    # Fallback queries (without Anulada / without ProductoClasificacion)
    q_header_fb = text(f"""
        SELECT
            pn.Nombre,
            'Basico' AS TipoRecompra,
            7 AS StockSeguridadDias,
            NULL AS TemporadaMesInicio,
            NULL AS TemporadaMesFin,
            NULL AS TemporadaMesLiquidacion,
            NULL AS TemporadaCantidadEstimada,
            7 AS LeadTimeDias,
            (SELECT SUM(ISNULL(p2.Stock, 0)) FROM Productos p2
             WHERE p2.ProductoNombreId = :pn_id
               AND (:local_id IS NULL OR p2.LocalID = :local_id)) AS StockTotal
        FROM ProductoNombre pn
        WHERE pn.Id = :pn_id
    """)

    q_models_fb = text(f"""
        WITH ventas_30d AS (
            SELECT vd.ProductoID, SUM(vd.Cantidad) AS Vendidas30d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY vd.ProductoID
        )
        SELECT
            pd.Id AS DescripcionId,
            pd.Descripcion,
            SUM(ISNULL(p.Stock, 0)) AS Stock,
            SUM(ISNULL(v.Vendidas30d, 0)) AS Vendidas30d
        FROM Productos p
        INNER JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        LEFT JOIN ventas_30d v ON p.ProductoID = v.ProductoID
        WHERE p.ProductoNombreId = :pn_id
          AND (:local_id IS NULL OR p.LocalID = :local_id)
        GROUP BY pd.Id, pd.Descripcion
        HAVING SUM(ISNULL(p.Stock, 0)) > 0 OR SUM(ISNULL(v.Vendidas30d, 0)) > 0
        ORDER BY SUM(ISNULL(v.Vendidas30d, 0)) DESC
    """)

    q_vel_fb = text("""
        SELECT SUM(vd.Cantidad) AS Vendidas90d
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Fecha >= DATEADD(DAY, -90, GETDATE())
          AND p.ProductoNombreId = :pn_id
          AND (:local_id IS NULL OR vc.LocalID = :local_id)
    """)

    q_mensuales_fb = text("""
        SELECT MONTH(vc.Fecha) AS Mes, YEAR(vc.Fecha) AS Anio,
               SUM(vd.Cantidad) AS Unidades
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Fecha >= DATEADD(MONTH, -24, GETDATE())
          AND p.ProductoNombreId = :pn_id
          AND (:local_id IS NULL OR vc.LocalID = :local_id)
        GROUP BY MONTH(vc.Fecha), YEAR(vc.Fecha)
    """)

    r_header, r_models, r_vel, r_mensuales = await asyncio.gather(
        _run_safe(engine, q_header, params),
        _run_safe(engine, q_models, params),
        _run_safe(engine, q_vel, params),
        _run_safe(engine, q_mensuales, params),
    )

    if r_header is None:
        r_header = await _run_safe(engine, q_header_fb, params)
    if r_models is None:
        r_models = await _run_safe(engine, q_models_fb, params)
    if r_vel is None:
        r_vel = await _run_safe(engine, q_vel_fb, params)
    if r_mensuales is None:
        r_mensuales = await _run_safe(engine, q_mensuales_fb, params)

    header_row = _rows(r_header)[0] if r_header else {}
    if not header_row:
        raise ValueError(f"ProductoNombre {producto_nombre_id} not found")

    nombre = str(header_row.get("Nombre") or "")
    tipo = str(header_row.get("TipoRecompra") or "Basico")
    seguridad = int(header_row.get("StockSeguridadDias") or 7)
    lead_time = int(header_row.get("LeadTimeDias") or 7)
    proveedor_id = header_row.get("ProveedorId")
    proveedor_id = int(proveedor_id) if proveedor_id is not None else None
    stock_total = int(header_row.get("StockTotal") or 0)

    v90 = int((r_vel.scalar() if r_vel else None) or 0)
    vel_diaria = round(v90 / 90.0, 4) if v90 > 0 else 0.0
    cobertura = round(stock_total / vel_diaria, 1) if vel_diaria > 0 else 999.0
    punto_reorden = lead_time + seguridad

    def _est(cob: float) -> str:
        if cob < punto_reorden:
            return "CRITICO" if cob < 7 else "BAJO"
        if cob > 60:
            return "EXCESO"
        return "OK"

    estado = _est(cobertura)

    # Build projection
    proyeccion: list[dict[str, Any]] = []
    if vel_diaria > 0:
        horizonte = max(60, int(lead_time * 1.5))
        for d in range(horizonte + 1):
            remaining = max(0, stock_total - vel_diaria * d)
            proyeccion.append({"dia": d, "stock": round(remaining, 1)})
            if remaining == 0:
                break

    # Build monthly sales
    today = _today()
    current_year = today.year
    mensuales_rows = _rows(r_mensuales) if r_mensuales else []
    monthly_map: dict[tuple[int, int], int] = {}
    for row in mensuales_rows:
        monthly_map[(int(row.get("Anio") or 0), int(row.get("Mes") or 0))] = int(row.get("Unidades") or 0)
    ventas_mensuales: list[dict[str, Any]] = []
    for m in range(1, 13):
        u = monthly_map.get((current_year - 1, m), monthly_map.get((current_year - 2, m), 0))
        ventas_mensuales.append({"mes": m, "unidades": u})

    # Build models
    model_rows = _rows(r_models) if r_models else []
    modelos: list[ModeloStock] = []
    for row in model_rows:
        stk = int(row.get("Stock") or 0)
        sold = int(row.get("Vendidas30d") or 0)
        vel = round(sold / 30.0, 3)
        dem_30 = round(vel * 30, 1)
        cob = round(stk / vel, 1) if vel > 0 else 999.0
        deficit = max(0, int(dem_30 - stk))
        modelos.append(ModeloStock(
            descripcion_id=int(row.get("DescripcionId") or 0),
            descripcion=str(row.get("Descripcion") or ""),
            stock=stk,
            vendidas_30d=sold,
            velocidad_diaria=vel,
            demanda_30d=dem_30,
            cobertura_dias=cob,
            estado=_est(cob),
            deficit=deficit,
        ))

    return ProductModelsResponse(
        producto_nombre_id=producto_nombre_id,
        nombre=nombre,
        tipo=tipo,
        lead_time=lead_time,
        seguridad=seguridad,
        proveedor_id=proveedor_id,
        stock_total=stock_total,
        demanda_proyectada_diaria=vel_diaria,
        cobertura_dias=cobertura,
        estado=estado,
        proyeccion_stock=proyeccion,
        ventas_mensuales=ventas_mensuales,
        modelos=modelos,
    )


# ── Stock Analysis — Model Curve (talle + color distribution, lazy) ───────────

async def get_model_curve(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    producto_nombre_id: int,
    descripcion_id: int,
    *,
    local_id: int | None = None,
) -> ModelCurveResponse:
    """Lazy-loaded talle/color distribution for a single model (Descripcion)."""
    engine = await _get_engine(platform_session, tenant_id, registry)

    params: dict[str, Any] = {
        "pn_id": producto_nombre_id,
        "desc_id": descripcion_id,
        "local_id": local_id,
    }

    q_talles = text("""
        WITH ventas_30d AS (
            SELECT vd.ProductoID, SUM(vd.Cantidad) AS Vendidas30d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY vd.ProductoID
        )
        SELECT pt.Talle,
               SUM(ISNULL(p.Stock, 0)) AS Stock,
               SUM(ISNULL(v.Vendidas30d, 0)) AS Vendidas30d
        FROM Productos p
        INNER JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ventas_30d v ON p.ProductoID = v.ProductoID
        WHERE p.ProductoNombreId = :pn_id
          AND p.ProductoDescripcionId = :desc_id
          AND (:local_id IS NULL OR p.LocalID = :local_id)
        GROUP BY pt.Talle
        ORDER BY SUM(ISNULL(v.Vendidas30d, 0)) DESC
    """)

    q_colores = text("""
        WITH ventas_30d AS (
            SELECT vd.ProductoID, SUM(vd.Cantidad) AS Vendidas30d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY vd.ProductoID
        )
        SELECT pc.Color,
               SUM(ISNULL(p.Stock, 0)) AS Stock,
               SUM(ISNULL(v.Vendidas30d, 0)) AS Vendidas30d
        FROM Productos p
        INNER JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        LEFT JOIN ventas_30d v ON p.ProductoID = v.ProductoID
        WHERE p.ProductoNombreId = :pn_id
          AND p.ProductoDescripcionId = :desc_id
          AND (:local_id IS NULL OR p.LocalID = :local_id)
        GROUP BY pc.Color
        ORDER BY SUM(ISNULL(v.Vendidas30d, 0)) DESC
    """)

    q_desc = text("""
        SELECT pd.Descripcion
        FROM ProductoDescripcion pd WHERE pd.Id = :desc_id
    """)

    # Fallback queries without Anulada
    q_talles_fb = text("""
        WITH ventas_30d AS (
            SELECT vd.ProductoID, SUM(vd.Cantidad) AS Vendidas30d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY vd.ProductoID
        )
        SELECT pt.Talle,
               SUM(ISNULL(p.Stock, 0)) AS Stock,
               SUM(ISNULL(v.Vendidas30d, 0)) AS Vendidas30d
        FROM Productos p
        INNER JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN ventas_30d v ON p.ProductoID = v.ProductoID
        WHERE p.ProductoNombreId = :pn_id
          AND p.ProductoDescripcionId = :desc_id
          AND (:local_id IS NULL OR p.LocalID = :local_id)
        GROUP BY pt.Talle
        ORDER BY SUM(ISNULL(v.Vendidas30d, 0)) DESC
    """)

    q_colores_fb = text("""
        WITH ventas_30d AS (
            SELECT vd.ProductoID, SUM(vd.Cantidad) AS Vendidas30d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Fecha >= DATEADD(DAY, -30, GETDATE())
              AND (:local_id IS NULL OR vc.LocalID = :local_id)
            GROUP BY vd.ProductoID
        )
        SELECT pc.Color,
               SUM(ISNULL(p.Stock, 0)) AS Stock,
               SUM(ISNULL(v.Vendidas30d, 0)) AS Vendidas30d
        FROM Productos p
        INNER JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        LEFT JOIN ventas_30d v ON p.ProductoID = v.ProductoID
        WHERE p.ProductoNombreId = :pn_id
          AND p.ProductoDescripcionId = :desc_id
          AND (:local_id IS NULL OR p.LocalID = :local_id)
        GROUP BY pc.Color
        ORDER BY SUM(ISNULL(v.Vendidas30d, 0)) DESC
    """)

    r_talles, r_colores, r_desc = await asyncio.gather(
        _run_safe(engine, q_talles, params),
        _run_safe(engine, q_colores, params),
        _run_safe(engine, q_desc, {"desc_id": descripcion_id}),
    )

    if r_talles is None:
        r_talles = await _run_safe(engine, q_talles_fb, params)
    if r_colores is None:
        r_colores = await _run_safe(engine, q_colores_fb, params)

    desc_name = ""
    if r_desc:
        desc_row = r_desc.fetchone()
        desc_name = str(desc_row[0]) if desc_row else ""

    talle_rows = _rows(r_talles) if r_talles else []
    color_rows = _rows(r_colores) if r_colores else []

    total_demand_t = sum(int(r.get("Vendidas30d") or 0) for r in talle_rows) or 1
    total_demand_c = sum(int(r.get("Vendidas30d") or 0) for r in color_rows) or 1

    talles = [
        TalleDistribucion(
            talle=str(r.get("Talle") or ""),
            stock=int(r.get("Stock") or 0),
            vendidas_30d=int(r.get("Vendidas30d") or 0),
            pct_demanda=round(int(r.get("Vendidas30d") or 0) / total_demand_t * 100, 1),
        )
        for r in talle_rows
    ]

    colores = [
        ColorDistribucion(
            color=str(r.get("Color") or ""),
            stock=int(r.get("Stock") or 0),
            vendidas_30d=int(r.get("Vendidas30d") or 0),
            pct_demanda=round(int(r.get("Vendidas30d") or 0) / total_demand_c * 100, 1),
        )
        for r in color_rows
    ]

    return ModelCurveResponse(
        descripcion_id=descripcion_id,
        descripcion=desc_name,
        talles=talles,
        colores=colores,
    )


# ── Stock Calendar — Purchase Planning ────────────────────────────────────────

_MONTH_LABELS_ES = [
    "", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
]


async def _ensure_calendar_table(engine: AsyncEngine) -> None:
    """Create OrdenCompraPlan table if it doesn't exist yet."""
    async with engine.begin() as conn:
        if not await _table_exists(conn, "OrdenCompraPlan"):
            await conn.execute(text("""
                CREATE TABLE OrdenCompraPlan (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    ProductoNombreId INT NOT NULL,
                    ProveedorId INT NULL,
                    FechaEmision DATE NOT NULL,
                    FechaLlegadaEstimada DATE NULL,
                    Cantidad INT NOT NULL DEFAULT 0,
                    CostoUnitarioEstimado DECIMAL(18,2) NULL,
                    InversionEstimada DECIMAL(18,2) NULL,
                    Estado VARCHAR(20) NOT NULL DEFAULT 'planificada',
                    Origen VARCHAR(20) NOT NULL DEFAULT 'manual',
                    Notas NVARCHAR(500) NULL,
                    CreadoEn DATETIME2 DEFAULT SYSUTCDATETIME(),
                    ModificadoEn DATETIME2 DEFAULT SYSUTCDATETIME()
                )
            """))


async def get_stock_calendar(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    local_id: int | None = None,
    meses: int = 3,
) -> StockCalendarResponse:
    """Purchase planning calendar.

    Returns motor-suggested orders (products with upcoming reorder dates),
    user-created planned orders from OrdenCompraPlan, monthly investment KPIs,
    and a cash-flow projection.
    """
    _empty = StockCalendarResponse(
        ordenes=[], kpis_por_mes=[], flujo_caja=[],
        inversion_total=0, ordenes_urgentes=0,
    )

    try:
        engine = await _get_engine(platform_session, tenant_id, registry)
    except Exception as exc:
        logger.error("stock_calendar.engine_error", tenant_id=tenant_id, error=str(exc))
        return _empty

    try:
        costo_col = await _get_costo_col_producto(engine, tenant_id)
    except Exception as exc:
        logger.warning("stock_calendar.costo_col_fallback", tenant_id=tenant_id, error=str(exc))
        costo_col = None
    _cost = costo_col or "PrecioCompra"

    try:
        await _ensure_advanced_tables(engine)
        await _ensure_calendar_table(engine)
    except Exception:
        pass

    today = _today()
    horizon_end = date(today.year + (today.month + meses - 1) // 12,
                       (today.month + meses - 1) % 12 + 1, 1)
    params: dict[str, Any] = {"local_id": local_id}

    # ── 1. Motor-suggested orders: derive fecha_orden per product ──────────────
    q_motor = text(f"""
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
        stock_costo AS (
            SELECT p.ProductoNombreId,
                   SUM(ISNULL(p.Stock, 0)) AS StockTotal,
                   AVG(ISNULL(p.{_cost}, 0)) AS CostoPromedio
            FROM Productos p
            WHERE (:local_id IS NULL OR p.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        )
        SELECT
            pn.Id AS ProductoNombreId,
            pn.Nombre,
            ISNULL(v.Vendidas90d, 0) / 90.0 AS VelocidadDiaria,
            ISNULL(s.StockTotal, 0) AS StockTotal,
            ISNULL(s.CostoPromedio, 0) AS CostoPromedio,
            ISNULL(cl.TipoRecompra, 'Basico') AS TipoRecompra,
            ISNULL(cl.StockSeguridadDias, 7) AS Seguridad,
            ISNULL(up.LeadTimeDias, 7) AS LeadTime,
            up.ProveedorId,
            up.ProveedorNombre,
            cl.TemporadaMesInicio,
            cl.TemporadaMesFin,
            cl.TemporadaMesLiquidacion
        FROM ProductoNombre pn
        LEFT JOIN ventas_90d v ON pn.Id = v.ProductoNombreId
        LEFT JOIN stock_costo s ON pn.Id = s.ProductoNombreId
        LEFT JOIN ProductoClasificacion cl ON pn.Id = cl.ProductoNombreId
        LEFT JOIN (
            SELECT p.ProductoNombreId,
                   prov.LeadTimeDias,
                   cc.ProveedorId,
                   prov.Nombre AS ProveedorNombre,
                   ROW_NUMBER() OVER (PARTITION BY p.ProductoNombreId ORDER BY cc.Fecha DESC) AS rn
            FROM CompraDetalle cd
            INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
            INNER JOIN Productos p ON cd.ProductoId = p.ProductoID
            INNER JOIN Proveedores prov ON cc.ProveedorId = prov.ProveedorId
        ) up ON pn.Id = up.ProductoNombreId AND up.rn = 1
        WHERE ISNULL(v.Vendidas90d, 0) > 0 OR ISNULL(s.StockTotal, 0) > 0
    """)

    # Fallback without Anulada column
    q_motor_fb = text(f"""
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
        stock_costo AS (
            SELECT p.ProductoNombreId,
                   SUM(ISNULL(p.Stock, 0)) AS StockTotal,
                   AVG(ISNULL(p.{_cost}, 0)) AS CostoPromedio
            FROM Productos p
            WHERE (:local_id IS NULL OR p.LocalID = :local_id)
            GROUP BY p.ProductoNombreId
        )
        SELECT
            pn.Id AS ProductoNombreId,
            pn.Nombre,
            ISNULL(v.Vendidas90d, 0) / 90.0 AS VelocidadDiaria,
            ISNULL(s.StockTotal, 0) AS StockTotal,
            ISNULL(s.CostoPromedio, 0) AS CostoPromedio,
            'Basico' AS TipoRecompra,
            7 AS Seguridad,
            7 AS LeadTime,
            NULL AS ProveedorId,
            NULL AS ProveedorNombre,
            NULL AS TemporadaMesInicio,
            NULL AS TemporadaMesFin,
            NULL AS TemporadaMesLiquidacion
        FROM ProductoNombre pn
        LEFT JOIN ventas_90d v ON pn.Id = v.ProductoNombreId
        LEFT JOIN stock_costo s ON pn.Id = s.ProductoNombreId
        WHERE ISNULL(v.Vendidas90d, 0) > 0 OR ISNULL(s.StockTotal, 0) > 0
    """)

    # ── 2. User-created planned orders ────────────────────────────────────────
    q_plan = text("""
        SELECT op.Id, op.ProductoNombreId, pn.Nombre,
               op.ProveedorId, op.FechaEmision, op.FechaLlegadaEstimada,
               op.Cantidad, op.CostoUnitarioEstimado, op.InversionEstimada,
               op.Estado, op.Origen, op.Notas
        FROM OrdenCompraPlan op
        INNER JOIN ProductoNombre pn ON op.ProductoNombreId = pn.Id
        WHERE op.FechaEmision >= CAST(GETDATE() AS DATE)
          AND op.FechaEmision < DATEADD(MONTH, :meses, CAST(GETDATE() AS DATE))
        ORDER BY op.FechaEmision ASC
    """)

    # ── 3. CMV per month (last year data as proxy for next year projection) ───
    q_cmv = text("""
        SELECT YEAR(vc.Fecha) AS Anio,
               MONTH(vc.Fecha) AS Mes,
               SUM(vd.Cantidad * ISNULL(p.PrecioCompra, 0)) AS CMV
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Fecha >= DATEADD(MONTH, -14, GETDATE())
          AND (:local_id IS NULL OR vc.LocalID = :local_id)
        GROUP BY YEAR(vc.Fecha), MONTH(vc.Fecha)
    """)
    q_cmv_fb = text("""
        SELECT YEAR(vc.Fecha) AS Anio,
               MONTH(vc.Fecha) AS Mes,
               SUM(vd.Cantidad * ISNULL(p.PrecioCompra, 0)) AS CMV
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Fecha >= DATEADD(MONTH, -14, GETDATE())
          AND (:local_id IS NULL OR vc.LocalID = :local_id)
        GROUP BY YEAR(vc.Fecha), MONTH(vc.Fecha)
    """)

    try:
        r_motor, r_plan, r_cmv = await asyncio.gather(
            _run_safe(engine, q_motor, params),
            _run_safe(engine, q_plan, {"meses": meses}),
            _run_safe(engine, q_cmv, params),
        )
    except Exception as exc:
        logger.error("stock_calendar.query_error", tenant_id=tenant_id, error=str(exc))
        return _empty

    if r_motor is None:
        r_motor = await _run_safe(engine, q_motor_fb, params)
    if r_cmv is None:
        r_cmv = await _run_safe(engine, q_cmv_fb, params)

    motor_rows = _rows(r_motor) if r_motor else []
    plan_rows = _rows(r_plan) if r_plan else []
    cmv_rows = _rows(r_cmv) if r_cmv else []

    # ── Build CMV lookup {(year, month): cmv} ────────────────────────────────
    cmv_map: dict[tuple[int, int], float] = {}
    for row in cmv_rows:
        yr = int(row.get("Anio") or 0)
        mo = int(row.get("Mes") or 0)
        cmv_map[(yr, mo)] = float(row.get("CMV") or 0)

    # ── Compute motor-suggested orders ────────────────────────────────────────
    ordenes: list[OrdenCalendario] = []
    existing_pn_ids = {int(r.get("ProductoNombreId") or 0) for r in plan_rows}

    for row in motor_rows:
        pn_id = int(row.get("ProductoNombreId") or 0)
        vel = float(row.get("VelocidadDiaria") or 0)
        stock = float(row.get("StockTotal") or 0)
        lead = int(row.get("LeadTime") or 7)
        seg = int(row.get("Seguridad") or 7)
        costo = float(row.get("CostoPromedio") or 0)
        tipo = str(row.get("TipoRecompra") or "Basico")
        mes_ini = row.get("TemporadaMesInicio")

        if vel <= 0:
            continue

        # Compute fecha_emision_orden
        if tipo == "Temporada" and mes_ini is not None:
            target_year = today.year
            target_month = int(mes_ini)
            target = date(target_year, target_month, 1)
            if target <= today:
                target = target.replace(year=today.year + 1)
            fecha_orden = target - timedelta(days=lead + seg)
        else:
            punto_reorden = vel * (lead + seg)
            dias = (stock - punto_reorden) / vel
            fecha_orden = today + timedelta(days=max(0, int(dias)))

        # Skip if already past horizon or already has a user plan
        if fecha_orden > horizon_end:
            continue
        if pn_id in existing_pn_ids:
            continue  # motor suggestion superseded by user order

        sugerencia = max(0, int(vel * (lead + seg) * 1.2) - int(stock))
        if sugerencia == 0 and tipo != "Temporada":
            continue

        cobertura = stock / vel if vel > 0 else 999.0
        if cobertura < 7:
            urgencia = "CRITICO"
        elif cobertura < 15:
            urgencia = "BAJO"
        else:
            urgencia = "OK"

        ordenes.append(OrdenCalendario(
            id=None,
            producto_nombre_id=pn_id,
            nombre=str(row.get("Nombre") or ""),
            proveedor_id=row.get("ProveedorId"),
            proveedor_nombre=row.get("ProveedorNombre"),
            fecha_emision=fecha_orden,
            fecha_llegada=fecha_orden + timedelta(days=lead),
            cantidad=sugerencia,
            costo_unitario=costo,
            inversion_estimada=round(sugerencia * costo, 2),
            estado="sugerida",
            origen="motor",
            tipo=tipo,
            urgencia=urgencia,
            notas=None,
        ))

    # ── Append user-planned orders ────────────────────────────────────────────
    for row in plan_rows:
        fecha_e = row.get("FechaEmision")
        if isinstance(fecha_e, str):
            fecha_e = date.fromisoformat(fecha_e)
        elif hasattr(fecha_e, "date"):
            fecha_e = fecha_e.date()
        fecha_l = row.get("FechaLlegadaEstimada")
        if fecha_l and isinstance(fecha_l, str):
            fecha_l = date.fromisoformat(fecha_l)
        elif fecha_l and hasattr(fecha_l, "date"):
            fecha_l = fecha_l.date()

        cant = int(row.get("Cantidad") or 0)
        costo_u = float(row.get("CostoUnitarioEstimado") or 0)
        inv = float(row.get("InversionEstimada") or cant * costo_u)
        estado = str(row.get("Estado") or "planificada")

        # Derive urgencia from estado
        if estado == "ordenada":
            urgencia = "OK"
        elif estado == "confirmada":
            urgencia = "OK"
        else:
            urgencia = "BAJO"

        ordenes.append(OrdenCalendario(
            id=int(row.get("Id") or 0),
            producto_nombre_id=int(row.get("ProductoNombreId") or 0),
            nombre=str(row.get("Nombre") or ""),
            proveedor_id=row.get("ProveedorId"),
            proveedor_nombre=None,
            fecha_emision=fecha_e,
            fecha_llegada=fecha_l,
            cantidad=cant,
            costo_unitario=costo_u,
            inversion_estimada=round(inv, 2),
            estado=estado,
            origen=str(row.get("Origen") or "manual"),
            tipo="Basico",
            urgencia=urgencia,
            notas=row.get("Notas"),
        ))

    # Sort all orders by date
    ordenes.sort(key=lambda o: o.fecha_emision)

    # ── Build monthly KPIs ────────────────────────────────────────────────────
    kpis_map: dict[str, dict[str, Any]] = {}
    for i in range(meses):
        yr = today.year + (today.month + i - 1) // 12
        mo = (today.month + i - 1) % 12 + 1
        key = f"{yr:04d}-{mo:02d}"
        kpis_map[key] = {
            "mes": key,
            "mes_label": f"{_MONTH_LABELS_ES[mo]} {yr}",
            "inversion_planificada": 0.0,
            "inversion_sugerida": 0.0,
            "inversion_total": 0.0,
            "cantidad_ordenes": 0,
        }

    for orden in ordenes:
        key = orden.fecha_emision.strftime("%Y-%m")
        if key in kpis_map:
            kpis_map[key]["cantidad_ordenes"] += 1
            kpis_map[key]["inversion_total"] += orden.inversion_estimada
            if orden.origen == "motor":
                kpis_map[key]["inversion_sugerida"] += orden.inversion_estimada
            else:
                kpis_map[key]["inversion_planificada"] += orden.inversion_estimada

    kpis = [
        CalendarioMesKpi(
            mes=v["mes"],
            mes_label=v["mes_label"],
            inversion_planificada=round(v["inversion_planificada"], 2),
            inversion_sugerida=round(v["inversion_sugerida"], 2),
            inversion_total=round(v["inversion_total"], 2),
            cantidad_ordenes=v["cantidad_ordenes"],
        )
        for v in kpis_map.values()
    ]

    # ── Build cash-flow projection ────────────────────────────────────────────
    flujo_caja: list[FlujoCajaEntry] = []
    for i in range(meses):
        yr = today.year + (today.month + i - 1) // 12
        mo = (today.month + i - 1) % 12 + 1
        key = f"{yr:04d}-{mo:02d}"
        # Previous year's CMV for same month as proxy
        cmv = cmv_map.get((yr - 1, mo), cmv_map.get((yr - 2, mo), 0.0))
        compras = kpis_map.get(key, {}).get("inversion_total", 0.0)
        flujo_caja.append(FlujoCajaEntry(
            periodo=key,
            periodo_label=f"{_MONTH_LABELS_ES[mo]} {yr}",
            cmv_proyectado=round(cmv, 2),
            compras_planificadas=round(compras, 2),
            saldo_neto=round(cmv - compras, 2),
        ))

    inversion_total = round(sum(o.inversion_estimada for o in ordenes), 2)
    ordenes_urgentes = sum(1 for o in ordenes if o.urgencia == "CRITICO")

    return StockCalendarResponse(
        ordenes=ordenes,
        kpis_por_mes=kpis,
        flujo_caja=flujo_caja,
        inversion_total=inversion_total,
        ordenes_urgentes=ordenes_urgentes,
    )


async def create_calendar_order(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    body: OrdenCompraPlanCreate,
) -> dict[str, Any]:
    """Insert a manually-created purchase order into OrdenCompraPlan."""
    engine = await _get_engine(platform_session, tenant_id, registry)
    try:
        await _ensure_calendar_table(engine)
    except Exception:
        pass

    costo = float(body.costo_unitario or 0)
    inversion = round(body.cantidad * costo, 2)

    q = text("""
        INSERT INTO OrdenCompraPlan
            (ProductoNombreId, FechaEmision, Cantidad, CostoUnitarioEstimado,
             InversionEstimada, Estado, Origen, Notas)
        OUTPUT INSERTED.Id
        VALUES
            (:pn_id, :fecha, :cantidad, :costo, :inversion, :estado, 'manual', :notas)
    """)
    async with engine.begin() as conn:
        result = await conn.execute(q, {
            "pn_id": body.producto_nombre_id,
            "fecha": body.fecha_emision,
            "cantidad": body.cantidad,
            "costo": costo if costo > 0 else None,
            "inversion": inversion if inversion > 0 else None,
            "estado": body.estado,
            "notas": body.notas,
        })
        row = result.fetchone()
        new_id = int(row[0]) if row else 0

    _analysis_cache_invalidate(tenant_id)
    return {"id": new_id, "ok": True}


async def update_calendar_order(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    order_id: int,
    body: OrdenCompraPlanUpdate,
) -> dict[str, Any]:
    """Update a planned order (date, quantity, status, etc.)."""
    engine = await _get_engine(platform_session, tenant_id, registry)

    sets: list[str] = ["ModificadoEn = SYSUTCDATETIME()"]
    params: dict[str, Any] = {"id": order_id}

    if body.fecha_emision is not None:
        sets.append("FechaEmision = :fecha")
        params["fecha"] = body.fecha_emision
    if body.fecha_llegada is not None:
        sets.append("FechaLlegadaEstimada = :fecha_llegada")
        params["fecha_llegada"] = body.fecha_llegada
    if body.cantidad is not None:
        sets.append("Cantidad = :cantidad")
        params["cantidad"] = body.cantidad
    if body.costo_unitario is not None:
        sets.append("CostoUnitarioEstimado = :costo")
        params["costo"] = body.costo_unitario
        if body.cantidad is not None:
            sets.append("InversionEstimada = :inversion")
            params["inversion"] = round(body.cantidad * body.costo_unitario, 2)
    if body.estado is not None:
        sets.append("Estado = :estado")
        params["estado"] = body.estado
    if body.notas is not None:
        sets.append("Notas = :notas")
        params["notas"] = body.notas

    q = text(f"UPDATE OrdenCompraPlan SET {', '.join(sets)} WHERE Id = :id")
    async with engine.begin() as conn:
        await conn.execute(q, params)

    _analysis_cache_invalidate(tenant_id)
    return {"ok": True}


# ── Multilocal ─────────────────────────────────────────────────────────────────

async def get_stock_multilocal(
    session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    local_id: int | None = None,
) -> StockMultilocalResponse:
    """
    Multi-location stock heatmap and transfer recommendations.

    Heatmap: rows = ProductoNombre, cols = Locales, cells = cobertura in days.
    Transfers: only recommended when excess local (>45d) can cover deficit local
    (<15d) without leaving origin below 15d coverage after the transfer.
    """
    engine = await _get_engine(session, tenant_id, registry)
    costo_col = await _get_costo_col_producto(engine, tenant_id)
    _cost = costo_col if costo_col else "NULL"

    # Main per-product per-local query (always all locales for the heatmap)
    q_por_local = text(f"""
        WITH ventas_90d AS (
            SELECT p.ProductoNombreId, l.LocalID,
                   SUM(vd.Cantidad) AS Vendidas90d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            INNER JOIN Locales l ON vc.LocalID = l.LocalID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
            GROUP BY p.ProductoNombreId, l.LocalID
        )
        SELECT p.ProductoNombreId,
               pn.Nombre AS ProductoNombre,
               l.LocalID,
               l.Nombre AS LocalNombre,
               SUM(ISNULL(p.Stock, 0)) AS StockTotal,
               ISNULL(v.Vendidas90d, 0) AS Vendidas90d,
               AVG(ISNULL(p.{_cost}, 0)) AS CostoPromedio
        FROM Productos p
        INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        INNER JOIN Locales l ON p.LocalID = l.LocalID
        LEFT JOIN ventas_90d v ON p.ProductoNombreId = v.ProductoNombreId
                               AND l.LocalID = v.LocalID
        GROUP BY p.ProductoNombreId, pn.Nombre, l.LocalID, l.Nombre, v.Vendidas90d
        ORDER BY pn.Nombre, l.Nombre
    """)

    # Fallback without Anulada filter
    q_por_local_fb = text(f"""
        WITH ventas_90d AS (
            SELECT p.ProductoNombreId, l.LocalID,
                   SUM(vd.Cantidad) AS Vendidas90d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            INNER JOIN Locales l ON vc.LocalID = l.LocalID
            WHERE vc.Fecha >= DATEADD(DAY, -90, GETDATE())
            GROUP BY p.ProductoNombreId, l.LocalID
        )
        SELECT p.ProductoNombreId,
               pn.Nombre AS ProductoNombre,
               l.LocalID,
               l.Nombre AS LocalNombre,
               SUM(ISNULL(p.Stock, 0)) AS StockTotal,
               ISNULL(v.Vendidas90d, 0) AS Vendidas90d,
               AVG(ISNULL(p.{_cost}, 0)) AS CostoPromedio
        FROM Productos p
        INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        INNER JOIN Locales l ON p.LocalID = l.LocalID
        LEFT JOIN ventas_90d v ON p.ProductoNombreId = v.ProductoNombreId
                               AND l.LocalID = v.LocalID
        GROUP BY p.ProductoNombreId, pn.Nombre, l.LocalID, l.Nombre, v.Vendidas90d
        ORDER BY pn.Nombre, l.Nombre
    """)

    rows = await _run_safe(engine, q_por_local)
    if rows is None:
        rows = await _run_safe(engine, q_por_local_fb)
    if rows is None:
        return StockMultilocalResponse(
            productos=[], locales=[], transferencias=[], total_ahorro_potencial=0.0
        )

    raw = _rows(rows)

    # ── Collect unique locales (preserving order) ──────────────────────────────
    seen_local_ids: set[int] = set()
    locales_list: list[dict] = []
    for r in raw:
        lid = int(r["LocalID"])
        if lid not in seen_local_ids:
            seen_local_ids.add(lid)
            locales_list.append({"local_id": lid, "nombre": r["LocalNombre"]})

    # ── Group by ProductoNombre ───────────────────────────────────────────────
    from collections import defaultdict
    pn_map: dict[int, dict] = {}      # pn_id → {nombre, locales: list}
    # pn_local_map for transfer algorithm
    pn_local_entries: dict[int, list[dict]] = defaultdict(list)

    for r in raw:
        pn_id = int(r["ProductoNombreId"])
        stock = int(r["StockTotal"] or 0)
        vendidas = float(r["Vendidas90d"] or 0)
        vel = round(vendidas / 90, 4)  # units/day
        cobertura = round(stock / vel, 1) if vel > 0 else float("inf")
        cob_display = min(cobertura, 999.0)  # cap for display

        # Estado (traffic-light)
        if cobertura == float("inf") and stock == 0:
            estado = "SIN_STOCK"
        elif cobertura < 15:
            estado = "CRITICO"
        elif cobertura < 30:
            estado = "BAJO"
        elif cobertura > 60:
            estado = "EXCESO"
        else:
            estado = "OK"

        celda = CeldaHeatmap(
            local_id=int(r["LocalID"]),
            local_nombre=str(r["LocalNombre"]),
            stock=stock,
            velocidad_diaria=vel,
            cobertura_dias=cob_display if cobertura != float("inf") else 999.0,
            estado=estado,
        )

        if pn_id not in pn_map:
            pn_map[pn_id] = {"nombre": str(r["ProductoNombre"]), "locales": []}
        pn_map[pn_id]["locales"].append(celda)

        pn_local_entries[pn_id].append({
            "local_id": int(r["LocalID"]),
            "local_nombre": str(r["LocalNombre"]),
            "stock": stock,
            "velocidad": vel,
            "cobertura": cobertura,
            "costo": float(r["CostoPromedio"] or 0),
        })

    # ── Transfer algorithm ────────────────────────────────────────────────────
    transferencias: list[TransferenciaMultilocal] = []
    total_ahorro = 0.0

    for pn_id, locales_data in pn_local_entries.items():
        nombre = pn_map[pn_id]["nombre"]
        exceso = [l for l in locales_data if l["cobertura"] > 45 and l["stock"] > 0 and l["velocidad"] > 0]
        deficit = [l for l in locales_data if l["cobertura"] < 15 and l["velocidad"] > 0]

        for ex in exceso:
            for de in deficit:
                # How much can origin spare while keeping >15d coverage
                can_spare = int((ex["cobertura"] - 15) * ex["velocidad"])
                if can_spare <= 0:
                    continue
                # How much deficit local needs to reach 30d
                needs = int((30 - de["cobertura"]) * de["velocidad"])
                if needs <= 0:
                    continue

                transfer_qty = min(can_spare, needs, ex["stock"])
                if transfer_qty <= 0:
                    continue

                # Verify origin stays above 15d after transfer
                cobertura_origen_post = (ex["stock"] - transfer_qty) / ex["velocidad"] if ex["velocidad"] > 0 else 999.0
                if cobertura_origen_post < 15:
                    continue

                cobertura_destino_post = (de["stock"] + transfer_qty) / de["velocidad"] if de["velocidad"] > 0 else 999.0
                ahorro = round(transfer_qty * ex["costo"] * 0.15, 2)
                total_ahorro += ahorro

                transferencias.append(TransferenciaMultilocal(
                    producto_nombre_id=pn_id,
                    nombre=nombre,
                    origen_local_id=ex["local_id"],
                    origen_nombre=ex["local_nombre"],
                    destino_local_id=de["local_id"],
                    destino_nombre=de["local_nombre"],
                    cantidad=transfer_qty,
                    cobertura_origen_antes=round(min(ex["cobertura"], 999.0), 1),
                    cobertura_origen_despues=round(min(cobertura_origen_post, 999.0), 1),
                    cobertura_destino_antes=round(min(de["cobertura"], 999.0), 1),
                    cobertura_destino_despues=round(min(cobertura_destino_post, 999.0), 1),
                    ahorro_estimado=ahorro,
                    costo_unitario=ex["costo"],
                ))

    # Sort transfers by ahorro desc
    transferencias.sort(key=lambda t: t.ahorro_estimado, reverse=True)

    productos = [
        MultilocalProducto(
            producto_nombre_id=pn_id,
            nombre=data["nombre"],
            locales=data["locales"],
        )
        for pn_id, data in sorted(pn_map.items(), key=lambda kv: kv[1]["nombre"])
    ]

    return StockMultilocalResponse(
        productos=productos,
        locales=locales_list,
        transferencias=transferencias,
        total_ahorro_potencial=round(total_ahorro, 2),
    )


# ── Stock Demand Forecast (per-product with horizon) ────────────────────────

async def get_stock_demand_forecast(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    producto_nombre_id: int,
    horizonte_dias: int = 60,
    local_id: int | None = None,
) -> "StockDemandForecastResponse":
    """
    Demand projection for a single ProductoNombre with configurable horizon.

    Algorithm (from STOCK_V2.md, Prompt 2):
    1. Fetch monthly sales for the last 24 months.
    2. Compute base velocity from last 90 days.
    3. Trend factor: last 45d vs previous 45d.
    4. Calendar factor per month from last year's seasonality.
    5. Financial analysis: scenarios and recommendation.
    """
    from .schemas import (
        EscenarioCompra,
        FactorCalendario,
        RecomendacionCompra,
        StockDemandForecastResponse,
        VentaMensual,
    )

    engine = await _get_engine(platform_session, tenant_id, registry)

    local_filter_vc = "AND vc.LocalID = :local_id" if local_id else ""
    local_filter_p = "AND p.LocalID = :local_id" if local_id else ""
    local_filter_p2 = "AND p2.LocalID = :local_id" if local_id else ""
    params: dict[str, Any] = {"pn_id": producto_nombre_id}
    if local_id:
        params["local_id"] = local_id

    # ── Query 1: Monthly sales last 24 months ──────────────────────────────
    q_ventas_mensuales = text(f"""
        SELECT
            YEAR(vc.Fecha)  AS Anio,
            MONTH(vc.Fecha) AS Mes,
            SUM(vd.Cantidad) AS UnidadesVendidas,
            SUM(vd.Cantidad * vd.PrecioUnitario) AS MontoVendido
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Anulada = 0
          AND p.ProductoNombreId = :pn_id
          AND vc.Fecha >= DATEADD(MONTH, -24, GETDATE())
          {local_filter_vc}
        GROUP BY YEAR(vc.Fecha), MONTH(vc.Fecha)
        ORDER BY Anio, Mes
    """)

    # ── Query 2: Sales velocity windows (90d, last 45d, prev 45d) ──────────
    q_velocidad = text(f"""
        SELECT
            ISNULL(SUM(CASE WHEN vc.Fecha >= DATEADD(DAY, -90, GETDATE()) THEN vd.Cantidad END), 0) AS Vendidas90d,
            ISNULL(SUM(CASE WHEN vc.Fecha >= DATEADD(DAY, -45, GETDATE()) THEN vd.Cantidad END), 0) AS Vendidas45d,
            ISNULL(SUM(CASE WHEN vc.Fecha >= DATEADD(DAY, -90, GETDATE())
                             AND vc.Fecha < DATEADD(DAY, -45, GETDATE()) THEN vd.Cantidad END), 0) AS Vendidas45a90d
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Anulada = 0
          AND p.ProductoNombreId = :pn_id
          AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
          {local_filter_vc}
    """)

    # ── Query 3: Stock actual + cost + product name ────────────────────────
    q_stock = text(f"""
        SELECT
            pn.Nombre,
            SUM(ISNULL(p.Stock, 0)) AS StockActual,
            ROUND(AVG(ISNULL(p.PrecioCompra, 0)), 2) AS CostoPromedio,
            SUM(ISNULL(p.PrecioCompra, 0) * ISNULL(p.Stock, 0)) AS ValorStockProducto,
            (SELECT SUM(ISNULL(p2.PrecioCompra, 0) * ISNULL(p2.Stock, 0))
             FROM Productos p2
             WHERE 1=1 {local_filter_p2}) AS ValorStockTotal
        FROM Productos p
        INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
        WHERE p.ProductoNombreId = :pn_id
          {local_filter_p}
        GROUP BY pn.Nombre
    """)

    # Run all three queries in parallel
    r_ventas, r_vel, r_stock = await asyncio.gather(
        _run(engine, q_ventas_mensuales, params),
        _run(engine, q_velocidad, params),
        _run(engine, q_stock, params),
    )

    ventas_rows = _rows(r_ventas)
    vel_row = _rows(r_vel)
    stock_rows = _rows(r_stock)

    if not stock_rows:
        raise ValueError(f"ProductoNombreId {producto_nombre_id} not found")

    sr = stock_rows[0]
    nombre = sr["Nombre"]
    stock_actual = int(sr["StockActual"] or 0)
    costo_promedio = float(sr["CostoPromedio"] or 0)
    valor_stock_producto = float(sr["ValorStockProducto"] or 0)
    valor_stock_total = float(sr["ValorStockTotal"] or 0)

    # ── Step 2: Base velocity (90d) ────────────────────────────────────────
    vr = vel_row[0] if vel_row else {}
    vendidas_90d = int(vr.get("Vendidas90d") or 0)
    vendidas_45d = int(vr.get("Vendidas45d") or 0)
    vendidas_45a90d = int(vr.get("Vendidas45a90d") or 0)

    vel_base = vendidas_90d / 90.0 if vendidas_90d > 0 else 0.0

    # ── Step 3: Trend factor ───────────────────────────────────────────────
    vel_reciente = vendidas_45d / 45.0
    vel_anterior = vendidas_45a90d / 45.0
    if vel_anterior > 0:
        factor_tendencia = min(2.0, max(0.5, vel_reciente / vel_anterior))
    else:
        factor_tendencia = 1.0

    # ── Step 4: Calendar factors per month ─────────────────────────────────
    # Build a map of monthly sales for easy lookup
    ventas_map: dict[tuple[int, int], int] = {}
    for v in ventas_rows:
        ventas_map[(int(v["Anio"]), int(v["Mes"]))] = int(v["UnidadesVendidas"])

    # Calculate seasonal factors using smoothed approach
    today = _today()

    # Collect all available monthly sales grouped by month-of-year
    # to compute average for each calendar month across all available years
    month_buckets: dict[int, list[int]] = {m: [] for m in range(1, 13)}
    all_monthly_values: list[int] = []
    for (anio, mes), unidades in ventas_map.items():
        month_buckets[mes].append(unidades)
        all_monthly_values.append(unidades)

    # Count distinct months with data in prior year (13-24 months ago)
    prev_year_months = 0
    for m_offset in range(13, 25):
        dt = today - timedelta(days=m_offset * 30)
        if (dt.year, dt.month) in ventas_map:
            prev_year_months += 1

    promedio_mensual_general = (sum(all_monthly_values) / len(all_monthly_values)) if all_monthly_values else 0

    # Compute calendar factors for each month in the horizon
    factores_calendario: list[FactorCalendario] = []
    demanda_total = 0.0
    dias_restantes = horizonte_dias
    cursor = today

    while dias_restantes > 0:
        mes_actual = cursor.month
        anio_actual = cursor.year
        # Days remaining in this calendar month
        if cursor.month == 12:
            fin_mes = cursor.replace(year=cursor.year + 1, month=1, day=1)
        else:
            fin_mes = cursor.replace(month=cursor.month + 1, day=1)
        dias_en_este_mes = min(dias_restantes, (fin_mes - cursor).days)
        if dias_en_este_mes <= 0:
            dias_en_este_mes = dias_restantes  # safety

        # Seasonal factor with smoothing:
        # - If < 12 months of prior-year data → no seasonal adjustment (1.0)
        # - Use average of same-month sales across all years / overall monthly average
        # - Blend 70% raw + 30% neutral to reduce single-year noise
        # - Clamp to [0.5, 2.0] since we have limited baseline data
        if prev_year_months >= 12 and promedio_mensual_general > 0:
            bucket = month_buckets.get(mes_actual, [])
            avg_same_month = (sum(bucket) / len(bucket)) if bucket else 0
            if avg_same_month > 0:
                raw_factor = avg_same_month / promedio_mensual_general
                factor_cal = 0.7 * raw_factor + 0.3  # blend towards neutral
                factor_cal = max(0.5, min(2.0, factor_cal))  # clamp
            else:
                factor_cal = 1.0
        else:
            factor_cal = 1.0

        factor_cal = round(factor_cal, 2)
        factores_calendario.append(FactorCalendario(mes=mes_actual, factor=factor_cal))

        demanda_mes = vel_base * factor_tendencia * factor_cal * dias_en_este_mes
        demanda_total += demanda_mes

        dias_restantes -= dias_en_este_mes
        cursor = fin_mes

    demanda_total = round(demanda_total, 1)

    # ── Step 5: Coverage and financial analysis ────────────────────────────
    cobertura_sin_comprar = round(stock_actual / vel_base, 1) if vel_base > 0 else 999.0
    peso_en_stock = round(valor_stock_producto / valor_stock_total, 4) if valor_stock_total > 0 else 0.0

    # ── Scenarios ──────────────────────────────────────────────────────────
    vel_ajustada = vel_base * factor_tendencia
    if vel_ajustada <= 0:
        vel_ajustada = 0.001  # avoid division by zero

    unidades_necesarias = max(0, round(demanda_total - stock_actual))

    # Scenario quantities: 0, small, full coverage, double
    scenario_qtys = sorted({
        0,
        max(0, round(unidades_necesarias * 0.5)),
        unidades_necesarias,
        unidades_necesarias * 2,
    })

    escenarios: list[EscenarioCompra] = []
    recomendado_idx = -1

    for qty in scenario_qtys:
        inv = round(qty * costo_promedio, 2)
        cob = round((stock_actual + qty) / vel_ajustada, 1) if vel_ajustada > 0 else 999.0
        valor_post = valor_stock_producto + inv
        peso_post = round(valor_post / valor_stock_total, 4) if valor_stock_total > 0 else 0.0

        warning = None
        if peso_post > 0.25:
            warning = "Alto capital"
        elif peso_post > 0.15:
            warning = "Capital moderado"

        es_recomendado = (qty == unidades_necesarias and qty > 0)
        if es_recomendado:
            recomendado_idx = len(escenarios)

        escenarios.append(EscenarioCompra(
            comprar=int(qty),
            cobertura=cob,
            inversion=inv,
            pesoStock=round(peso_post, 4),
            recomendado=es_recomendado,
            warning=warning,
        ))

    # If recommended scenario exceeds 25% of stock, cap it at 15%
    rec_unidades = unidades_necesarias
    rec_inv = round(rec_unidades * costo_promedio, 2)
    if valor_stock_total > 0 and rec_inv / valor_stock_total > 0.25:
        # Cap investment at 15% of total stock value
        max_inv = valor_stock_total * 0.15
        rec_unidades = max(0, int(max_inv / costo_promedio)) if costo_promedio > 0 else 0
        rec_inv = round(rec_unidades * costo_promedio, 2)

    rec_cobertura = round((stock_actual + rec_unidades) / vel_ajustada, 1) if vel_ajustada > 0 else 999.0

    if rec_unidades == 0:
        mensaje = f"Stock actual cubre {round(cobertura_sin_comprar)} días, no se requiere compra"
    else:
        mensaje = f"Cubre {round(rec_cobertura)} días sin exceder 15% del capital total"

    # ── Build response ─────────────────────────────────────────────────────
    ventas_mensuales = [
        VentaMensual(
            anio=int(v["Anio"]),
            mes=int(v["Mes"]),
            unidades=int(v["UnidadesVendidas"]),
            monto=float(v["MontoVendido"] or 0),
        )
        for v in ventas_rows
    ]

    return StockDemandForecastResponse(
        productoNombreId=producto_nombre_id,
        nombre=nombre,
        horizonte=horizonte_dias,
        ventasMensuales=ventas_mensuales,
        stockActual=stock_actual,
        velocidadBase=round(vel_base, 2),
        factorTendencia=round(factor_tendencia, 2),
        factoresCalendario=factores_calendario,
        demandaProyectada=demanda_total,
        coberturaSinComprar=round(cobertura_sin_comprar, 1),
        costoPromedio=round(costo_promedio, 2),
        valorStockProducto=round(valor_stock_producto, 2),
        valorStockTotal=round(valor_stock_total, 2),
        pesoEnStockTotal=round(peso_en_stock, 4),
        escenarios=escenarios,
        recomendacion=RecomendacionCompra(
            unidades=rec_unidades,
            inversion=rec_inv,
            coberturaDias=rec_cobertura,
            mensaje=mensaje,
        ),
    )


# ── CAPA 2: Stock Models Ranking (Descripciones by velocity) ─────────────────

async def get_stock_models_ranking(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    producto_nombre_id: int,
    *,
    horizonte_dias: int = 60,
    local_id: int | None = None,
) -> "StockModelsRankingResponse":
    """
    Rank Descripciones within a ProductoNombre by exit velocity since last
    purchase, then distribute the recommended purchase units proportionally
    by a score combining velocity (60%) and urgency (40%).

    Algorithm from STOCK_V2.md, CAPA 2.
    """
    from .schemas import StockModeloDescripcion, StockModelsRankingResponse

    engine = await _get_engine(platform_session, tenant_id, registry)

    local_filter_vc = "AND vc.LocalID = :local_id" if local_id else ""
    local_filter_p = "AND p.LocalID = :local_id" if local_id else ""
    params: dict[str, Any] = {"pn_id": producto_nombre_id}
    if local_id:
        params["local_id"] = local_id

    # ── Main query: CAPA 2 from STOCK_V2.md ────────────────────────────────
    q_models = text(f"""
        WITH ultima_compra AS (
            SELECT p.ProductoDescripcionId,
                   MAX(cc.Fecha) AS FechaUltimaCompra
            FROM CompraDetalle cd
            INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
            INNER JOIN Productos p ON cd.ProductoId = p.ProductoID
            WHERE p.ProductoNombreId = :pn_id
            GROUP BY p.ProductoDescripcionId
        ),
        ventas_desde_compra AS (
            SELECT p.ProductoDescripcionId,
                   SUM(vd.Cantidad) AS VendidasDesdeCompra,
                   GREATEST(DATEDIFF(DAY, MAX(uc.FechaUltimaCompra), GETDATE()), 1) AS DiasDesdeCompra
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
            LEFT JOIN ultima_compra uc ON p.ProductoDescripcionId = uc.ProductoDescripcionId
            WHERE vc.Anulada = 0
              AND p.ProductoNombreId = :pn_id
              AND (uc.FechaUltimaCompra IS NULL OR vc.Fecha >= uc.FechaUltimaCompra)
              {local_filter_vc}
            GROUP BY p.ProductoDescripcionId
        )
        SELECT
            pd.Id AS DescripcionId,
            pd.Descripcion,
            SUM(ISNULL(p.Stock, 0)) AS StockTotal,
            ISNULL(vdc.VendidasDesdeCompra, 0) AS VendidasDesdeCompra,
            ISNULL(vdc.DiasDesdeCompra, 999) AS DiasDesdeCompra,
            CASE WHEN ISNULL(vdc.DiasDesdeCompra, 0) = 0 THEN 0
                 ELSE ROUND(ISNULL(vdc.VendidasDesdeCompra, 0) * 1.0 / vdc.DiasDesdeCompra, 2)
            END AS VelocidadSalida,
            CASE WHEN ISNULL(vdc.VendidasDesdeCompra, 0) = 0 THEN 999
                 ELSE ROUND(SUM(ISNULL(p.Stock, 0)) /
                      (ISNULL(vdc.VendidasDesdeCompra, 0) * 1.0 / vdc.DiasDesdeCompra), 0)
            END AS CoberturaDias,
            ROUND(AVG(ISNULL(p.PrecioCompra, 0)), 2) AS CostoPromedio
        FROM Productos p
        INNER JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        LEFT JOIN ventas_desde_compra vdc ON p.ProductoDescripcionId = vdc.ProductoDescripcionId
        WHERE p.ProductoNombreId = :pn_id
          {local_filter_p}
        GROUP BY pd.Id, pd.Descripcion, vdc.VendidasDesdeCompra, vdc.DiasDesdeCompra
        ORDER BY
            CASE WHEN ISNULL(vdc.DiasDesdeCompra, 0) = 0 THEN 0
                 ELSE ISNULL(vdc.VendidasDesdeCompra, 0) * 1.0 / vdc.DiasDesdeCompra
            END DESC
    """)

    # ── Alerta de color: colores con ventas > 0 en 90d pero stock = 0 ──────
    q_color_alert = text(f"""
        SELECT
            p.ProductoDescripcionId AS DescripcionId,
            pc.Color,
            SUM(ISNULL(vd_sub.Vendidas90d, 0)) AS Vendidas90d,
            SUM(ISNULL(p.Stock, 0)) AS StockColor
        FROM Productos p
        INNER JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        LEFT JOIN (
            SELECT vd.ProductoID, SUM(vd.Cantidad) AS Vendidas90d
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Anulada = 0
              AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
              {local_filter_vc}
            GROUP BY vd.ProductoID
        ) vd_sub ON p.ProductoID = vd_sub.ProductoID
        WHERE p.ProductoNombreId = :pn_id
          {local_filter_p}
        GROUP BY p.ProductoDescripcionId, pc.Color
        HAVING SUM(ISNULL(p.Stock, 0)) = 0 AND SUM(ISNULL(vd_sub.Vendidas90d, 0)) > 0
    """)

    # ── Total ventas 90d for the entire product (for % calculation in alerts) ──
    q_total_90d = text(f"""
        SELECT SUM(vd.Cantidad) AS Total90d
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Anulada = 0
          AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
          AND p.ProductoNombreId = :pn_id
          {local_filter_vc}
    """)

    # ── Recommended total from the demand forecast (reuse CAPA 1 logic) ────
    q_vel_90d = text(f"""
        SELECT
            ISNULL(SUM(CASE WHEN vc.Fecha >= DATEADD(DAY, -90, GETDATE()) THEN vd.Cantidad END), 0) AS Vendidas90d,
            ISNULL(SUM(CASE WHEN vc.Fecha >= DATEADD(DAY, -45, GETDATE()) THEN vd.Cantidad END), 0) AS Vendidas45d,
            ISNULL(SUM(CASE WHEN vc.Fecha >= DATEADD(DAY, -90, GETDATE())
                             AND vc.Fecha < DATEADD(DAY, -45, GETDATE()) THEN vd.Cantidad END), 0) AS Vendidas45a90d
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Anulada = 0
          AND p.ProductoNombreId = :pn_id
          AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
          {local_filter_vc}
    """)

    q_stock_total = text(f"""
        SELECT SUM(ISNULL(p.Stock, 0)) AS StockTotal
        FROM Productos p
        WHERE p.ProductoNombreId = :pn_id
          {local_filter_p}
    """)

    r_models, r_alerts, r_total_90d, r_vel, r_stock = await asyncio.gather(
        _run(engine, q_models, params),
        _run_safe(engine, q_color_alert, params),
        _run_safe(engine, q_total_90d, params),
        _run(engine, q_vel_90d, params),
        _run(engine, q_stock_total, params),
    )

    model_rows = _rows(r_models)
    if not model_rows:
        raise ValueError(f"ProductoNombreId {producto_nombre_id} not found or has no models")

    # ── Build color alert map ──────────────────────────────────────────────
    alert_rows = _rows(r_alerts) if r_alerts else []
    total_90d_row = _rows(r_total_90d) if r_total_90d else []
    total_ventas_90d = int(total_90d_row[0].get("Total90d") or 0) if total_90d_row else 0

    # Group alerts by DescripcionId
    alert_map: dict[int, list[str]] = {}
    for ar in alert_rows:
        desc_id = int(ar["DescripcionId"])
        color = str(ar["Color"] or "")
        vendidas = int(ar["Vendidas90d"] or 0)
        pct = round(vendidas / total_ventas_90d * 100) if total_ventas_90d > 0 else 0
        msg = f"{color} sin stock, {pct}% demanda"
        alert_map.setdefault(desc_id, []).append(msg)

    # ── Compute recomendacionTotal (units to buy for the horizon) ──────────
    vel_row = _rows(r_vel)
    vr = vel_row[0] if vel_row else {}
    vendidas_90d = int(vr.get("Vendidas90d") or 0)
    vendidas_45d = int(vr.get("Vendidas45d") or 0)
    vendidas_45a90d = int(vr.get("Vendidas45a90d") or 0)

    vel_base = vendidas_90d / 90.0 if vendidas_90d > 0 else 0.0
    vel_reciente = vendidas_45d / 45.0
    vel_anterior = vendidas_45a90d / 45.0
    factor_tendencia = min(2.0, max(0.5, vel_reciente / vel_anterior)) if vel_anterior > 0 else 1.0
    vel_ajustada = vel_base * factor_tendencia

    stock_total_val = int((_rows(r_stock)[0].get("StockTotal") or 0)) if r_stock else 0
    demanda_horizonte = vel_ajustada * horizonte_dias
    recomendacion_total = max(0, round(demanda_horizonte - stock_total_val))

    # ── Score computation: velocity 60% + urgency 40% ─────────────────────
    max_vel = max((float(r.get("VelocidadSalida") or 0) for r in model_rows), default=0.001)
    if max_vel <= 0:
        max_vel = 0.001

    scored_models: list[dict[str, Any]] = []
    for row in model_rows:
        vel = float(row.get("VelocidadSalida") or 0)
        cob = float(row.get("CoberturaDias") or 999)
        score = (vel / max_vel) * 0.6 + (1 - min(cob / 60.0, 1.0)) * 0.4
        scored_models.append({**row, "_score": round(score, 4), "_vel": vel, "_cob": cob})

    sum_scores = sum(m["_score"] for m in scored_models) or 0.001

    # ── Distribute units proportionally to score ──────────────────────────
    modelos: list[StockModeloDescripcion] = []
    for m in scored_models:
        desc_id = int(m["DescripcionId"])
        stock = int(m.get("StockTotal") or 0)
        vel = m["_vel"]
        cob = m["_cob"]
        costo = float(m.get("CostoPromedio") or 0)
        score = m["_score"]

        # Proportional allocation
        raw_units = recomendacion_total * (score / sum_scores)
        # Cap: don't buy more than projected demand minus current stock
        demanda_desc = vel * horizonte_dias
        max_units = max(0, round(demanda_desc - stock))
        units = min(round(raw_units), max_units)
        # Don't suggest purchase if coverage already exceeds horizon
        if cob >= horizonte_dias:
            units = 0

        inv = round(units * costo, 2)
        cob_post = round((stock + units) / vel, 1) if vel > 0 else 999.0

        # Alert string
        alerts = alert_map.get(desc_id)
        alerta_color = ", ".join(alerts) if alerts else None

        # Estado
        if units > 0:
            estado = "COMPRAR"
        elif cob > horizonte_dias:
            # Even if general coverage is OK, flag REVISAR when a color
            # with active demand has zero stock.
            estado = "REVISAR" if alerta_color else "OK"
        else:
            estado = "EXCESO" if stock > demanda_desc * 1.5 else ("REVISAR" if alerta_color else "OK")

        modelos.append(StockModeloDescripcion(
            descripcionId=desc_id,
            descripcion=str(m.get("Descripcion") or ""),
            stockTotal=stock,
            vendidasDesdeCompra=int(m.get("VendidasDesdeCompra") or 0),
            diasDesdeCompra=int(m.get("DiasDesdeCompra") or 999),
            velocidadSalida=round(vel, 2),
            coberturaDias=round(cob, 1),
            costoPromedio=round(costo, 2),
            score=round(score, 4),
            unidadesSugeridas=units,
            inversionSugerida=inv,
            coberturaPostCompra=round(cob_post, 1),
            estado=estado,
            alertaColor=alerta_color,
        ))

    return StockModelsRankingResponse(
        productoNombreId=producto_nombre_id,
        recomendacionTotal=recomendacion_total,
        modelos=modelos,
    )


# ── CAPA 3+4: Model detail (colores + talles + demanda por local) ────────────

async def get_stock_model_detail(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    producto_nombre_id: int,
    descripcion_id: int,
    *,
    local_id: int | None = None,
) -> "StockModelDetailResponse":
    """
    CAPA 3: Colors within a Descripcion with estado.
    CAPA 4: Talle distribution per color with demand %.
    Also: demand per local per color.
    """
    from .schemas import (
        ColorDetalle, DemandaLocal, StockModelDetailResponse, TalleDetalle,
    )

    engine = await _get_engine(platform_session, tenant_id, registry)

    local_filter_vc = "AND vc.LocalID = :local_id" if local_id else ""
    local_filter_p = "AND p.LocalID = :local_id" if local_id else ""
    params: dict[str, Any] = {"pn_id": producto_nombre_id, "desc_id": descripcion_id}
    if local_id:
        params["local_id"] = local_id

    # ── Descripcion name ─────────────────────────────────────────────────────
    q_desc = text("""
        SELECT Descripcion FROM ProductoDescripcion WHERE Id = :desc_id
    """)

    # ── CAPA 3: colores con stock y ventas 90d ───────────────────────────────
    q_colores = text(f"""
        SELECT
            pc.Id AS ColorId,
            pc.Color,
            SUM(ISNULL(p.Stock, 0)) AS StockColor,
            ISNULL(SUM(v.Cantidad), 0) AS VendidasColor,
            ROUND(ISNULL(SUM(v.Cantidad), 0) * 100.0 /
                NULLIF((SELECT SUM(vd2.Cantidad)
                        FROM VentaDetalle vd2
                        INNER JOIN VentaCabecera vc2 ON vd2.VentaID = vc2.VentaID
                        INNER JOIN Productos p2 ON vd2.ProductoID = p2.ProductoID
                        WHERE vc2.Anulada = 0 AND vc2.Fecha >= DATEADD(DAY, -90, GETDATE())
                        AND p2.ProductoDescripcionId = :desc_id
                        AND p2.ProductoNombreId = :pn_id
                        {local_filter_vc}), 0), 1) AS PctDemanda
        FROM Productos p
        INNER JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        LEFT JOIN (
            SELECT vd.ProductoID, SUM(vd.Cantidad) AS Cantidad
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
                {local_filter_vc}
            GROUP BY vd.ProductoID
        ) v ON p.ProductoID = v.ProductoID
        WHERE p.ProductoNombreId = :pn_id
          AND p.ProductoDescripcionId = :desc_id
          {local_filter_p}
        GROUP BY pc.Id, pc.Color
        ORDER BY VendidasColor DESC
    """)

    # ── CAPA 4: talles per color ─────────────────────────────────────────────
    q_talles = text(f"""
        SELECT
            p.ProductoColorId AS ColorId,
            pt.Talle,
            SUM(ISNULL(p.Stock, 0)) AS StockTalle,
            ISNULL(SUM(v.Cantidad), 0) AS VendidasTalle,
            ROUND(ISNULL(SUM(v.Cantidad), 0) * 100.0 /
                NULLIF((SELECT SUM(vd2.Cantidad)
                        FROM VentaDetalle vd2
                        INNER JOIN VentaCabecera vc2 ON vd2.VentaID = vc2.VentaID
                        INNER JOIN Productos p2 ON vd2.ProductoID = p2.ProductoID
                        WHERE vc2.Anulada = 0 AND vc2.Fecha >= DATEADD(DAY, -90, GETDATE())
                        AND p2.ProductoDescripcionId = :desc_id
                        AND p2.ProductoNombreId = :pn_id
                        AND p2.ProductoColorId = p.ProductoColorId
                        {local_filter_vc}), 0), 1) AS PctDemanda
        FROM Productos p
        INNER JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN (
            SELECT vd.ProductoID, SUM(vd.Cantidad) AS Cantidad
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
                {local_filter_vc}
            GROUP BY vd.ProductoID
        ) v ON p.ProductoID = v.ProductoID
        WHERE p.ProductoNombreId = :pn_id
          AND p.ProductoDescripcionId = :desc_id
          {local_filter_p}
        GROUP BY p.ProductoColorId, pt.Talle
        ORDER BY p.ProductoColorId, VendidasTalle DESC
    """)

    # ── Demanda por local per color ──────────────────────────────────────────
    q_local = text(f"""
        SELECT
            p.ProductoColorId AS ColorId,
            l.Nombre AS Local,
            SUM(vd.Cantidad) AS Vendidas,
            ROUND(SUM(vd.Cantidad) * 100.0 / NULLIF(
                (SELECT SUM(vd2.Cantidad)
                 FROM VentaDetalle vd2
                 INNER JOIN VentaCabecera vc2 ON vd2.VentaID = vc2.VentaID
                 INNER JOIN Productos p2 ON vd2.ProductoID = p2.ProductoID
                 WHERE vc2.Anulada = 0 AND vc2.Fecha >= DATEADD(DAY, -90, GETDATE())
                 AND p2.ProductoNombreId = :pn_id
                 AND p2.ProductoDescripcionId = :desc_id
                 AND p2.ProductoColorId = p.ProductoColorId), 0), 1) AS PctDemanda
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        INNER JOIN Locales l ON vc.LocalID = l.LocalID
        WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
          AND p.ProductoNombreId = :pn_id
          AND p.ProductoDescripcionId = :desc_id
          {local_filter_p}
        GROUP BY p.ProductoColorId, l.Nombre
        ORDER BY p.ProductoColorId, Vendidas DESC
    """)

    r_desc, r_colores, r_talles, r_local = await asyncio.gather(
        _run(engine, q_desc, params),
        _run(engine, q_colores, params),
        _run(engine, q_talles, params),
        _run_safe(engine, q_local, params),
    )

    # ── Parse descripcion ────────────────────────────────────────────────────
    desc_rows = _rows(r_desc)
    descripcion_name = str(desc_rows[0]["Descripcion"]) if desc_rows else ""

    # ── Parse talles → group by ColorId ──────────────────────────────────────
    talle_rows = _rows(r_talles)
    talles_by_color: dict[int, list[TalleDetalle]] = {}
    for tr in talle_rows:
        cid = int(tr["ColorId"])
        stock_t = int(tr.get("StockTalle") or 0)
        pct = float(tr.get("PctDemanda") or 0)
        talles_by_color.setdefault(cid, []).append(TalleDetalle(
            talle=str(tr.get("Talle") or ""),
            stock=stock_t,
            pctDemanda=pct,
            prioridad=stock_t == 0 and pct > 5.0,
        ))

    # ── Parse demanda por local → group by ColorId ───────────────────────────
    local_rows = _rows(r_local) if r_local else []
    locals_by_color: dict[int, list[DemandaLocal]] = {}
    for lr in local_rows:
        cid = int(lr["ColorId"])
        vendidas = int(lr.get("Vendidas") or 0)
        # unidadesMes = vendidas_90d / 3
        locals_by_color.setdefault(cid, []).append(DemandaLocal(
            local=str(lr.get("Local") or ""),
            pctDemanda=float(lr.get("PctDemanda") or 0),
            unidadesMes=round(vendidas / 3.0, 1),
        ))

    # ── Build colores list ───────────────────────────────────────────────────
    color_rows = _rows(r_colores)
    colores: list[ColorDetalle] = []
    for cr in color_rows:
        cid = int(cr["ColorId"])
        stock_c = int(cr.get("StockColor") or 0)
        vendidas_c = int(cr.get("VendidasColor") or 0)
        pct_c = float(cr.get("PctDemanda") or 0)

        # Estado by color
        if vendidas_c > 0 and stock_c == 0:
            estado = "REPONER"
        elif vendidas_c > 0 and stock_c > 0:
            # coverage check: stock / (vendidas_90d / 90)
            vel_color = vendidas_c / 90.0
            cob_color = stock_c / vel_color if vel_color > 0 else 999
            estado = "REVISAR" if cob_color < 15 else "OK"
        elif vendidas_c == 0 and stock_c > 0:
            estado = "SIN MOVIMIENTO"
        else:
            estado = "OK"

        colores.append(ColorDetalle(
            colorId=cid,
            color=str(cr.get("Color") or ""),
            stockTotal=stock_c,
            vendidas90d=vendidas_c,
            pctDemanda=pct_c,
            estado=estado,
            talles=talles_by_color.get(cid, []),
            demandaPorLocal=locals_by_color.get(cid, []),
        ))

    return StockModelDetailResponse(
        descripcionId=descripcion_id,
        descripcion=descripcion_name,
        colores=colores,
    )


# ── Liquidación: modelos sin rotación dentro de un ProductoNombre ─────────────

async def get_stock_liquidation(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    producto_nombre_id: int,
    *,
    local_id: int | None = None,
) -> "StockLiquidationResponse":
    """
    Detect Descripciones within a ProductoNombre that are candidates for
    liquidation: stock > 0, edad > 60d, and (vendidas90d=0 OR vel < 10%
    of avg OR cobertura > 365d). Includes SKU-level detail and checks if
    another local has demand for the model.
    """
    from .schemas import LiquidacionDetalle, LiquidacionModelo, StockLiquidationResponse

    engine = await _get_engine(platform_session, tenant_id, registry)

    local_filter_p = "AND p.LocalID = :local_id" if local_id else ""
    local_filter_vc = "AND vc.LocalID = :local_id" if local_id else ""
    params: dict[str, Any] = {"pn_id": producto_nombre_id}
    if local_id:
        params["local_id"] = local_id

    # ── Main query: detect liquidation candidates (from STOCK_V2.md) ─────────
    q_candidates = text(f"""
        WITH vel_por_desc AS (
            SELECT
                p.ProductoDescripcionId,
                pd.Descripcion,
                SUM(ISNULL(p.Stock, 0)) AS StockTotal,
                SUM(ISNULL(p.PrecioCompra, 0) * ISNULL(p.Stock, 0)) AS ValorStock,
                AVG(DATEDIFF(DAY, p.FechaCarga, GETDATE())) AS EdadPromDias,
                ISNULL(SUM(v90.Cantidad), 0) AS Vendidas90d,
                CASE WHEN ISNULL(SUM(v90.Cantidad), 0) = 0 THEN 0
                     ELSE ROUND(ISNULL(SUM(v90.Cantidad), 0) / 90.0, 3)
                END AS VelDiaria
            FROM Productos p
            INNER JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
            LEFT JOIN (
                SELECT vd.ProductoID, SUM(vd.Cantidad) AS Cantidad
                FROM VentaDetalle vd
                INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
                WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
                {local_filter_vc}
                GROUP BY vd.ProductoID
            ) v90 ON p.ProductoID = v90.ProductoID
            WHERE p.ProductoNombreId = :pn_id
              AND p.Stock > 0
              {local_filter_p}
            GROUP BY p.ProductoDescripcionId, pd.Descripcion
        ),
        vel_promedio_nombre AS (
            SELECT AVG(VelDiaria) AS VelPromedioNombre
            FROM vel_por_desc
            WHERE VelDiaria > 0
        )
        SELECT
            v.ProductoDescripcionId AS DescripcionId,
            v.Descripcion,
            v.StockTotal,
            v.ValorStock,
            v.EdadPromDias,
            v.Vendidas90d,
            v.VelDiaria,
            CASE WHEN v.VelDiaria = 0 THEN 999
                 ELSE ROUND(v.StockTotal / v.VelDiaria, 0)
            END AS CoberturaDias
        FROM vel_por_desc v
        CROSS JOIN vel_promedio_nombre vp
        WHERE v.StockTotal > 0
          AND (
              (v.Vendidas90d = 0 AND v.EdadPromDias > 60)
              OR (v.VelDiaria < vp.VelPromedioNombre * 0.1 AND v.EdadPromDias > 60)
              OR (v.VelDiaria > 0 AND v.StockTotal / v.VelDiaria > 365)
          )
        ORDER BY v.ValorStock DESC
    """)

    r_candidates = await _run(engine, q_candidates, params)
    candidate_rows = _rows(r_candidates)

    if not candidate_rows:
        return StockLiquidationResponse(
            capitalInmovilizado=0.0, capitalRecuperable=0.0, modelos=[],
        )

    desc_ids = [int(r["DescripcionId"]) for r in candidate_rows]
    desc_ids_csv = ",".join(str(d) for d in desc_ids)

    # ── SKU detail for all candidates in one query ────────────────────────────
    q_detail = text(f"""
        SELECT
            p.ProductoDescripcionId AS DescripcionId,
            pc.Color,
            pt.Talle,
            p.Stock,
            ISNULL(p.PrecioCompra, 0) AS PrecioCosto,
            ISNULL(p.PrecioVenta, 0) AS PrecioVenta,
            DATEDIFF(DAY, p.FechaCarga, GETDATE()) AS DiasEnStock,
            ISNULL(v.Vendidas, 0) AS Vendidas90d
        FROM Productos p
        LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        LEFT JOIN (
            SELECT vd.ProductoID, SUM(vd.Cantidad) AS Vendidas
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
            {local_filter_vc}
            GROUP BY vd.ProductoID
        ) v ON p.ProductoID = v.ProductoID
        WHERE p.ProductoNombreId = :pn_id
          AND p.ProductoDescripcionId IN ({desc_ids_csv})
          AND p.Stock > 0
          {local_filter_p}
        ORDER BY p.ProductoDescripcionId,
                 ISNULL(v.Vendidas, 0) ASC,
                 DATEDIFF(DAY, p.FechaCarga, GETDATE()) DESC
    """)

    # ── Check other-local demand for each candidate ───────────────────────────
    other_local_filter = f"AND p.LocalID != :local_id" if local_id else ""
    q_other_local = text(f"""
        SELECT DISTINCT p.ProductoDescripcionId AS DescripcionId
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        WHERE vc.Anulada = 0
          AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
          AND p.ProductoNombreId = :pn_id
          AND p.ProductoDescripcionId IN ({desc_ids_csv})
          {other_local_filter}
    """)

    r_detail, r_other = await asyncio.gather(
        _run(engine, q_detail, params),
        _run_safe(engine, q_other_local, params),
    )

    # ── Group detail rows by DescripcionId ────────────────────────────────────
    detail_by_desc: dict[int, list[dict[str, Any]]] = {}
    for dr in _rows(r_detail):
        did = int(dr["DescripcionId"])
        detail_by_desc.setdefault(did, []).append(dr)

    other_local_ids = {int(r["DescripcionId"]) for r in (_rows(r_other) if r_other else [])}

    # ── Discount suggestion (from STOCK_V2.md) ────────────────────────────────
    def _descuento(edad: int, vendidas: int, cobertura: float) -> int:
        if vendidas == 0 and edad > 120:
            return 40
        if vendidas == 0 and edad > 60:
            return 30
        if cobertura > 365:
            return 30
        if cobertura > 180:
            return 20
        return 15

    # ── Build response ────────────────────────────────────────────────────────
    total_inmovilizado = 0.0
    total_recuperable = 0.0
    modelos: list[LiquidacionModelo] = []

    for row in candidate_rows:
        did = int(row["DescripcionId"])
        edad = int(row.get("EdadPromDias") or 0)
        vendidas = int(row.get("Vendidas90d") or 0)
        cobertura = float(row.get("CoberturaDias") or 999)
        valor_stock = float(row.get("ValorStock") or 0)
        stock_total = int(row.get("StockTotal") or 0)

        descuento = _descuento(edad, vendidas, cobertura)

        # Capital recuperable = sum(stock × precioVenta × (1 - desc/100))
        skus = detail_by_desc.get(did, [])
        cap_rec = sum(
            int(s.get("Stock") or 0) * float(s.get("PrecioVenta") or 0) * (1 - descuento / 100)
            for s in skus
        )

        total_inmovilizado += valor_stock
        total_recuperable += cap_rec

        detalle = [
            LiquidacionDetalle(
                color=str(s.get("Color") or ""),
                talle=str(s.get("Talle") or ""),
                stock=int(s.get("Stock") or 0),
                diasEnStock=int(s.get("DiasEnStock") or 0),
                vendidas=int(s.get("Vendidas90d") or 0),
            )
            for s in skus
        ]

        modelos.append(LiquidacionModelo(
            descripcionId=did,
            descripcion=str(row.get("Descripcion") or ""),
            stockTotal=stock_total,
            valorStock=round(valor_stock, 2),
            edadPromDias=edad,
            vendidas90d=vendidas,
            descuentoSugerido=descuento,
            capitalRecuperable=round(cap_rec, 2),
            detalle=detalle,
            tieneDemandaOtroLocal=did in other_local_ids,
        ))

    return StockLiquidationResponse(
        capitalInmovilizado=round(total_inmovilizado, 2),
        capitalRecuperable=round(total_recuperable, 2),
        modelos=modelos,
    )


# ── Proveedor + precio promedio para un ProductoDescripcion ──────────────────

async def get_proveedor_producto(
    platform_session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    producto_nombre_id: int,
    descripcion_id: int,
) -> "ProveedorProductoResponse":
    """Return last supplier and average purchase price for a Descripcion."""
    from .schemas import ProveedorProductoResponse

    engine = await _get_engine(platform_session, tenant_id, registry)
    params: dict[str, Any] = {"pn_id": producto_nombre_id, "desc_id": descripcion_id}

    q_prov = text("""
        SELECT TOP 1
            prov.ProveedorId, prov.Nombre, prov.Telefono, prov.Email
        FROM CompraDetalle cd
        INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
        INNER JOIN Proveedores prov ON cc.ProveedorId = prov.ProveedorId
        INNER JOIN Productos p ON cd.ProductoId = p.ProductoID
        WHERE p.ProductoNombreId = :pn_id
          AND p.ProductoDescripcionId = :desc_id
        ORDER BY cc.Fecha DESC
    """)

    q_precio = text("""
        SELECT ROUND(AVG(ISNULL(p.PrecioCompra, 0)), 2) AS PrecioCompraPromedio
        FROM Productos p
        WHERE p.ProductoNombreId = :pn_id
          AND p.ProductoDescripcionId = :desc_id
          AND p.PrecioCompra > 0
    """)

    r_prov, r_precio = await asyncio.gather(
        _run_safe(engine, q_prov, params),
        _run_safe(engine, q_precio, params),
    )

    prov_rows = _rows(r_prov) if r_prov else []
    precio_rows = _rows(r_precio) if r_precio else []

    prov = prov_rows[0] if prov_rows else {}
    precio = float(precio_rows[0].get("PrecioCompraPromedio") or 0) if precio_rows else 0.0

    return ProveedorProductoResponse(
        proveedorId=int(prov["ProveedorId"]) if prov.get("ProveedorId") else None,
        nombre=str(prov["Nombre"]) if prov.get("Nombre") else None,
        telefono=str(prov["Telefono"]) if prov.get("Telefono") else None,
        email=str(prov["Email"]) if prov.get("Email") else None,
        precioCompraPromedio=precio,
    )

# ── Multilocal Detail: Descripcion+Color level ──────────────────────────────

async def get_stock_multilocal_detail(
    session,
    tenant_id: str,
    registry: TenantConnectionRegistry,
    *,
    producto_nombre_id: int,
) -> "MultilocalDetailResponse":
    """
    Detailed multilocal breakdown at Descripcion+Color level for one product.
    Returns heatmap grid, specific transfer recs with talle breakdown, and
    demand-per-local for proportional order distribution.
    """
    from .schemas import (
        CeldaHeatmapDetalle, MultilocalColorDetalle, MultilocalDescripcionDetalle,
        TalleTransferencia, TransferenciaDetallada, DemandaLocal,
        MultilocalDetailResponse,
    )

    engine = await _get_engine(session, tenant_id, registry)
    costo_col = await _get_costo_col_producto(engine, tenant_id)
    _cost = costo_col if costo_col else "NULL"
    params: dict[str, Any] = {"pn_id": producto_nombre_id}

    # ── Q1: Stock + velocity at Desc+Color+Local level ──────────────────────
    q_grid = text(f"""
        SELECT pd.Id AS DescripcionId, pd.Descripcion,
               pc.Id AS ColorId, pc.Color,
               l.LocalID, l.Nombre AS LocalNombre,
               SUM(ISNULL(p.Stock, 0)) AS Stock,
               AVG(ISNULL(p.{_cost}, 0)) AS CostoPromedio,
               ISNULL(d.VelDiaria, 0) AS VelDiaria
        FROM Productos p
        INNER JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        INNER JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        INNER JOIN Locales l ON p.LocalID = l.LocalID
        LEFT JOIN (
            SELECT p2.ProductoDescripcionId, p2.ProductoColorId, vc.LocalID,
                   SUM(vd.Cantidad) * 1.0 / 90 AS VelDiaria
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p2 ON vd.ProductoID = p2.ProductoID
            WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
              AND p2.ProductoNombreId = :pn_id
            GROUP BY p2.ProductoDescripcionId, p2.ProductoColorId, vc.LocalID
        ) d ON p.ProductoDescripcionId = d.ProductoDescripcionId
           AND p.ProductoColorId = d.ProductoColorId
           AND p.LocalID = d.LocalID
        WHERE p.ProductoNombreId = :pn_id
        GROUP BY pd.Id, pd.Descripcion, pc.Id, pc.Color,
                 l.LocalID, l.Nombre, d.VelDiaria
        ORDER BY pd.Descripcion, pc.Color, l.Nombre
    """)

    # Fallback without Anulada
    q_grid_fb = text(f"""
        SELECT pd.Id AS DescripcionId, pd.Descripcion,
               pc.Id AS ColorId, pc.Color,
               l.LocalID, l.Nombre AS LocalNombre,
               SUM(ISNULL(p.Stock, 0)) AS Stock,
               AVG(ISNULL(p.{_cost}, 0)) AS CostoPromedio,
               ISNULL(d.VelDiaria, 0) AS VelDiaria
        FROM Productos p
        INNER JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
        INNER JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
        INNER JOIN Locales l ON p.LocalID = l.LocalID
        LEFT JOIN (
            SELECT p2.ProductoDescripcionId, p2.ProductoColorId, vc.LocalID,
                   SUM(vd.Cantidad) * 1.0 / 90 AS VelDiaria
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
            INNER JOIN Productos p2 ON vd.ProductoID = p2.ProductoID
            WHERE vc.Fecha >= DATEADD(DAY, -90, GETDATE())
              AND p2.ProductoNombreId = :pn_id
            GROUP BY p2.ProductoDescripcionId, p2.ProductoColorId, vc.LocalID
        ) d ON p.ProductoDescripcionId = d.ProductoDescripcionId
           AND p.ProductoColorId = d.ProductoColorId
           AND p.LocalID = d.LocalID
        WHERE p.ProductoNombreId = :pn_id
        GROUP BY pd.Id, pd.Descripcion, pc.Id, pc.Color,
                 l.LocalID, l.Nombre, d.VelDiaria
        ORDER BY pd.Descripcion, pc.Color, l.Nombre
    """)

    # ── Q2: Talle-level stock per local (for transfer breakdown) ────────────
    q_talles = text("""
        SELECT p.ProductoDescripcionId, p.ProductoColorId, p.LocalID,
               pt.Nombre AS Talle, pt.Id AS TalleId,
               SUM(ISNULL(p.Stock, 0)) AS Stock
        FROM Productos p
        INNER JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
        WHERE p.ProductoNombreId = :pn_id
        GROUP BY p.ProductoDescripcionId, p.ProductoColorId, p.LocalID,
                 pt.Nombre, pt.Id
        HAVING SUM(ISNULL(p.Stock, 0)) > 0
        ORDER BY pt.Id
    """)

    # ── Q3: Aggregate demand per local ──────────────────────────────────────
    q_demanda = text("""
        SELECT vc.LocalID, l.Nombre AS LocalNombre,
               SUM(vd.Cantidad) * 1.0 / 90 AS DemandaDiaria
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
        INNER JOIN Locales l ON vc.LocalID = l.LocalID
        WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
          AND p.ProductoNombreId = :pn_id
        GROUP BY vc.LocalID, l.Nombre
    """)

    # ── Q4: Product name lookup ─────────────────────────────────────────────
    q_nombre = text("SELECT Nombre FROM ProductoNombre WHERE Id = :pn_id")

    grid_res = await _run_safe(engine, q_grid, params)
    if grid_res is None:
        grid_res = await _run_safe(engine, q_grid_fb, params)
    talle_res, demanda_res, nombre_res = await asyncio.gather(
        _run_safe(engine, q_talles, params),
        _run_safe(engine, q_demanda, params),
        _run_safe(engine, q_nombre, params),
    )

    nombre_rows = _rows(nombre_res) if nombre_res else []
    prod_nombre = str(nombre_rows[0]["Nombre"]) if nombre_rows else ""

    if grid_res is None:
        return MultilocalDetailResponse(
            producto_nombre_id=producto_nombre_id, nombre=prod_nombre,
            descripciones=[], transferencias=[], demanda_por_local=[],
        )

    raw = _rows(grid_res)
    talle_raw = _rows(talle_res) if talle_res else []
    demanda_raw = _rows(demanda_res) if demanda_res else []

    # ── Build talle lookup: (desc_id, color_id, local_id) → [(talle, stock)] ──
    from collections import defaultdict
    talle_map: dict[tuple, list[dict]] = defaultdict(list)
    for tr in talle_raw:
        key = (int(tr["ProductoDescripcionId"]), int(tr["ProductoColorId"]), int(tr["LocalID"]))
        talle_map[key].append({"talle": str(tr["Talle"]), "stock": int(tr["Stock"] or 0)})

    # ── Build heatmap grid + transfer data ──────────────────────────────────
    # desc_id → color_id → [{local, stock, vel, cob, costo}]
    grid_data: dict[int, dict] = {}  # desc_id → {descripcion, colores: {color_id → {color, locals}}}
    transfer_entries: list[dict] = []  # flat list for transfer algo

    for r in raw:
        desc_id = int(r["DescripcionId"])
        color_id = int(r["ColorId"])
        stock = int(r["Stock"] or 0)
        vel = round(float(r["VelDiaria"] or 0), 4)
        cob = round(stock / vel, 1) if vel > 0 else (999.0 if stock > 0 else 0.0)
        costo = float(r["CostoPromedio"] or 0)

        if cob == 0 and stock == 0:
            estado = "SIN_STOCK"
        elif cob < 15:
            estado = "CRITICO"
        elif cob < 30:
            estado = "BAJO"
        elif cob > 60:
            estado = "EXCESO"
        else:
            estado = "OK"

        celda = CeldaHeatmapDetalle(
            local_id=int(r["LocalID"]), local_nombre=str(r["LocalNombre"]),
            stock=stock, velocidad_diaria=vel,
            cobertura_dias=min(cob, 999.0), estado=estado,
        )

        if desc_id not in grid_data:
            grid_data[desc_id] = {"descripcion": str(r["Descripcion"]), "colores": {}}
        colores = grid_data[desc_id]["colores"]
        if color_id not in colores:
            colores[color_id] = {"color": str(r["Color"]), "locales": []}
        colores[color_id]["locales"].append(celda)

        transfer_entries.append({
            "desc_id": desc_id, "descripcion": str(r["Descripcion"]),
            "color_id": color_id, "color": str(r["Color"]),
            "local_id": int(r["LocalID"]), "local_nombre": str(r["LocalNombre"]),
            "stock": stock, "vel": vel, "cob": cob if cob != float("inf") else 999.0,
            "costo": costo,
        })

    # ── Transfer algorithm at Desc+Color level ──────────────────────────────
    # Group entries by (desc_id, color_id)
    dc_groups: dict[tuple, list[dict]] = defaultdict(list)
    for e in transfer_entries:
        dc_groups[(e["desc_id"], e["color_id"])].append(e)

    transferencias: list[TransferenciaDetallada] = []
    for (desc_id, color_id), locals_data in dc_groups.items():
        exceso = [l for l in locals_data if l["cob"] > 60 and l["stock"] > 0]
        deficit = [l for l in locals_data if l["cob"] < 15 and l["vel"] > 0]

        for ex in exceso:
            for de in deficit:
                can_spare = int((ex["cob"] - 15) * ex["vel"]) if ex["vel"] > 0 else 0
                if can_spare <= 0:
                    continue
                needs = int((30 - de["cob"]) * de["vel"]) if de["vel"] > 0 else 0
                if needs <= 0:
                    continue

                transfer_qty = min(can_spare, needs, ex["stock"])
                if transfer_qty <= 0:
                    continue

                cob_orig_post = (ex["stock"] - transfer_qty) / ex["vel"] if ex["vel"] > 0 else 999.0
                if cob_orig_post < 15:
                    continue

                cob_dest_post = (de["stock"] + transfer_qty) / de["vel"] if de["vel"] > 0 else 999.0
                ahorro = round(transfer_qty * ex["costo"] * 0.15, 2)

                # Get talle breakdown from origin
                talle_key = (desc_id, color_id, ex["local_id"])
                origin_talles = talle_map.get(talle_key, [])
                remaining = transfer_qty
                talles: list[TalleTransferencia] = []
                for t in origin_talles:
                    if remaining <= 0:
                        break
                    take = min(t["stock"], remaining)
                    if take > 0:
                        talles.append(TalleTransferencia(talle=t["talle"], cantidad=take))
                        remaining -= take

                transferencias.append(TransferenciaDetallada(
                    descripcion_id=desc_id, descripcion=ex["descripcion"],
                    color_id=color_id, color=ex["color"],
                    origen_local_id=ex["local_id"], origen_nombre=ex["local_nombre"],
                    destino_local_id=de["local_id"], destino_nombre=de["local_nombre"],
                    cantidad=transfer_qty, talles=talles,
                    cobertura_origen_antes=round(min(ex["cob"], 999.0), 1),
                    cobertura_origen_despues=round(min(cob_orig_post, 999.0), 1),
                    cobertura_destino_antes=round(min(de["cob"], 999.0), 1),
                    cobertura_destino_despues=round(min(cob_dest_post, 999.0), 1),
                    ahorro_estimado=ahorro,
                    costo_unitario=ex["costo"],
                ))

    transferencias.sort(key=lambda t: t.ahorro_estimado, reverse=True)

    # ── Build response ──────────────────────────────────────────────────────
    descripciones = []
    for desc_id, ddata in sorted(grid_data.items(), key=lambda kv: kv[1]["descripcion"]):
        colores = [
            MultilocalColorDetalle(
                color_id=cid, color=cdata["color"], locales=cdata["locales"],
            )
            for cid, cdata in sorted(ddata["colores"].items(), key=lambda kv: kv[1]["color"])
        ]
        descripciones.append(MultilocalDescripcionDetalle(
            descripcion_id=desc_id, descripcion=ddata["descripcion"], colores=colores,
        ))

    demanda_por_local = [
        DemandaLocal(
            local_id=int(d["LocalID"]),
            local_nombre=str(d["LocalNombre"]),
            demanda_diaria=round(float(d["DemandaDiaria"] or 0), 2),
        )
        for d in demanda_raw
    ]

    return MultilocalDetailResponse(
        producto_nombre_id=producto_nombre_id,
        nombre=prod_nombre,
        descripciones=descripciones,
        transferencias=transferencias,
        demanda_por_local=demanda_por_local,
    )
