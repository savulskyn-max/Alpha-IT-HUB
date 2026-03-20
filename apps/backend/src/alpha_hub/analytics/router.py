"""
Analytics router: exposes business intelligence endpoints per tenant.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.platform import get_platform_session
from ..database.tenant import TenantConnectionRegistry
from ..dependencies import require_admin
from ..models.platform import User
from . import service
from .schemas import (
    AiAnalysisResponse,
    ClasificacionUpdate,
    ComprasResponse,
    FiltrosDisponibles,
    ForecastResponse,
    GastosResponse,
    KpiSummary,
    LeadTimeUpdate,
    ModelCurveResponse,
    OrdenCompraPlanCreate,
    OrdenCompraPlanUpdate,
    PrediccionesResponse,
    ProductModelsResponse,
    RecomendacionAvanzadaResponse,
    RecomendacionSimpleResponse,
    StockAnalysisResponse,
    StockCalendarResponse,
    StockDemandForecastResponse,
    StockModelDetailResponse,
    StockModelsRankingResponse,
    StockMultilocalResponse,
    StockLiquidationResponse,
    ProveedorProductoResponse,
    StockResponse,
    VentasResponse,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])


async def _get_db() -> AsyncSession:  # type: ignore[return]
    async with get_platform_session() as session:
        yield session  # type: ignore[misc]


def _get_registry(request: Request) -> TenantConnectionRegistry:
    registry = getattr(request.app.state, "tenant_registry", None)
    if registry is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Tenant registry not available")
    return registry


def _handle(e: Exception) -> HTTPException:
    if isinstance(e, ValueError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Error querying tenant database: {e}")


# ── KPIs ──────────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/kpis", response_model=KpiSummary)
async def get_kpis(tenant_id: str, request: Request, _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db)) -> KpiSummary:
    try:
        return await service.get_kpis(session, tenant_id, _get_registry(request))
    except Exception as e:
        raise _handle(e)


# ── Ventas ────────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/ventas", response_model=VentasResponse)
async def get_ventas(
    tenant_id: str, request: Request,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    local_id: int | None = None,
    metodo_pago_ids: str | None = None,   # comma-separated, e.g. "1,3,5"
    tipo_venta: str | None = None,
    producto_nombre: str | None = None,
    talle_id: int | None = None,
    color_id: int | None = None,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> VentasResponse:
    try:
        return await service.get_ventas(
            session, tenant_id, _get_registry(request),
            fecha_desde=fecha_desde, fecha_hasta=fecha_hasta,
            local_id=local_id, metodo_pago_ids=metodo_pago_ids,
            tipo_venta=tipo_venta, producto_nombre=producto_nombre,
            talle_id=talle_id, color_id=color_id,
        )
    except Exception as e:
        raise _handle(e)


# ── Gastos ────────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/gastos", response_model=GastosResponse)
async def get_gastos(
    tenant_id: str, request: Request,
    fecha_desde: date | None = None, fecha_hasta: date | None = None,
    local_id: int | None = None, metodo_pago_ids: str | None = None,
    tipo_id: int | None = None, categoria_id: int | None = None,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> GastosResponse:
    try:
        return await service.get_gastos(
            session, tenant_id, _get_registry(request),
            fecha_desde=fecha_desde, fecha_hasta=fecha_hasta,
            local_id=local_id, metodo_pago_ids=metodo_pago_ids,
            tipo_id=tipo_id, categoria_id=categoria_id,
        )
    except Exception as e:
        raise _handle(e)


# ── Stock ─────────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/stock", response_model=StockResponse)
async def get_stock(
    tenant_id: str, request: Request,
    fecha_desde: date | None = None, fecha_hasta: date | None = None,
    local_id: int | None = None,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> StockResponse:
    try:
        return await service.get_stock(
            session, tenant_id, _get_registry(request),
            local_id=local_id, fecha_desde=fecha_desde, fecha_hasta=fecha_hasta,
        )
    except Exception as e:
        raise _handle(e)


@router.get("/{tenant_id}/stock/recomendacion", response_model=RecomendacionSimpleResponse)
async def get_stock_recomendacion(
    tenant_id: str, request: Request,
    local_id: int | None = None,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> RecomendacionSimpleResponse:
    """Simple purchase recommendation table grouped by ProductoNombre."""
    try:
        return await service.get_recomendacion_simple(
            session, tenant_id, _get_registry(request), local_id=local_id,
        )
    except Exception as e:
        raise _handle(e)


@router.get("/{tenant_id}/stock/recomendacion-avanzada", response_model=RecomendacionAvanzadaResponse)
async def get_stock_recomendacion_avanzada(
    tenant_id: str, request: Request,
    local_id: int | None = None,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> RecomendacionAvanzadaResponse:
    """Advanced purchase recommendation with lead times, projections, and editable fields."""
    try:
        return await service.get_recomendacion_avanzada(
            session, tenant_id, _get_registry(request), local_id=local_id,
        )
    except Exception as e:
        raise _handle(e)


@router.put("/{tenant_id}/stock/clasificacion")
async def update_clasificacion(
    tenant_id: str, request: Request,
    body: ClasificacionUpdate,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> dict:
    """Update product classification (tipo, stock seguridad)."""
    try:
        await service.update_clasificacion(session, tenant_id, _get_registry(request), body)
        return {"ok": True}
    except Exception as e:
        raise _handle(e)


@router.put("/{tenant_id}/stock/proveedor-leadtime")
async def update_proveedor_leadtime(
    tenant_id: str, request: Request,
    body: LeadTimeUpdate,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> dict:
    """Update supplier lead time."""
    try:
        await service.update_lead_time(session, tenant_id, _get_registry(request), body)
        return {"ok": True}
    except Exception as e:
        raise _handle(e)


@router.get("/{tenant_id}/stock/analysis", response_model=StockAnalysisResponse)
async def get_stock_analysis(
    tenant_id: str, request: Request,
    local_id: int | None = None,
    modo: str = "avanzado",
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> StockAnalysisResponse:
    """
    Unified stock analysis with adaptive demand model (Motor de Inteligencia).

    Returns KPIs, per-product demand projections, top-5 alerts, and cross-store
    transfer opportunities. Results are cached for 5 minutes and invalidated
    on any classification or lead-time update.

    - **local_id**: filter by store (null = all stores)
    - **modo**: "simple" (30d velocity) or "avanzado" (adaptive model with YoY factors)
    """
    try:
        return await service.get_stock_analysis(
            session, tenant_id, _get_registry(request),
            local_id=local_id, modo=modo,
        )
    except Exception as e:
        raise _handle(e)


@router.get("/{tenant_id}/stock/analysis/{producto_nombre_id}/models", response_model=ProductModelsResponse)
async def get_product_models(
    tenant_id: str, producto_nombre_id: int, request: Request,
    local_id: int | None = None,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> ProductModelsResponse:
    """Lazy-loaded detail: models (Descripcion) for a specific ProductoNombre."""
    try:
        return await service.get_product_models(
            session, tenant_id, _get_registry(request),
            producto_nombre_id=producto_nombre_id, local_id=local_id,
        )
    except Exception as e:
        raise _handle(e)


@router.get("/{tenant_id}/stock/analysis/{producto_nombre_id}/models/{descripcion_id}/curve", response_model=ModelCurveResponse)
async def get_model_curve(
    tenant_id: str, producto_nombre_id: int, descripcion_id: int, request: Request,
    local_id: int | None = None,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> ModelCurveResponse:
    """Lazy-loaded detail: talle + color distribution for a specific model."""
    try:
        return await service.get_model_curve(
            session, tenant_id, _get_registry(request),
            producto_nombre_id=producto_nombre_id, descripcion_id=descripcion_id, local_id=local_id,
        )
    except Exception as e:
        raise _handle(e)


@router.get("/{tenant_id}/stock/calendar", response_model=StockCalendarResponse)
async def get_stock_calendar(
    tenant_id: str, request: Request,
    local_id: int | None = None,
    meses: int = 3,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> StockCalendarResponse:
    """
    Purchase planning calendar.

    Combines motor-suggested reorder dates with user-created planned orders.
    Returns monthly investment KPIs and a cash-flow projection.

    - **meses**: planning horizon in months (default 3, max 12)
    """
    try:
        return await service.get_stock_calendar(
            session, tenant_id, _get_registry(request),
            local_id=local_id, meses=min(max(meses, 1), 12),
        )
    except Exception as e:
        raise _handle(e)


@router.post("/{tenant_id}/stock/calendar")
async def create_calendar_order(
    tenant_id: str, request: Request,
    body: OrdenCompraPlanCreate,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> dict:
    """Create a manual planned purchase order."""
    try:
        return await service.create_calendar_order(session, tenant_id, _get_registry(request), body)
    except Exception as e:
        raise _handle(e)


@router.put("/{tenant_id}/stock/calendar/{order_id}")
async def update_calendar_order(
    tenant_id: str, order_id: int, request: Request,
    body: OrdenCompraPlanUpdate,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> dict:
    """Update a planned purchase order (date, quantity, status, notes)."""
    try:
        return await service.update_calendar_order(session, tenant_id, _get_registry(request), order_id, body)
    except Exception as e:
        raise _handle(e)


@router.get("/{tenant_id}/stock/forecast", response_model=ForecastResponse)
async def get_stock_forecast(
    tenant_id: str, request: Request,
    local_id: int | None = None,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> ForecastResponse:
    """Sales forecast per product using Holt's double exponential smoothing + seasonal adjustment."""
    try:
        return await service.get_stock_forecast(
            session, tenant_id, _get_registry(request), local_id=local_id,
        )
    except Exception as e:
        raise _handle(e)


@router.get("/{tenant_id}/stock/forecast/{producto_nombre_id}", response_model=StockDemandForecastResponse)
async def get_stock_demand_forecast(
    tenant_id: str, producto_nombre_id: int, request: Request,
    horizonte_dias: int = 60,
    local_id: int | None = None,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> StockDemandForecastResponse:
    """Per-product demand forecast with configurable horizon, scenarios, and purchase recommendation."""
    try:
        return await service.get_stock_demand_forecast(
            session, tenant_id, _get_registry(request),
            producto_nombre_id=producto_nombre_id,
            horizonte_dias=min(max(horizonte_dias, 1), 365),
            local_id=local_id,
        )
    except Exception as e:
        raise _handle(e)


@router.get("/{tenant_id}/stock/models/{producto_nombre_id}", response_model=StockModelsRankingResponse)
async def get_stock_models_ranking(
    tenant_id: str, producto_nombre_id: int, request: Request,
    horizonte_dias: int = 60,
    local_id: int | None = None,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> StockModelsRankingResponse:
    """CAPA 2: rank Descripciones by exit velocity since last purchase with purchase suggestions."""
    try:
        return await service.get_stock_models_ranking(
            session, tenant_id, _get_registry(request),
            producto_nombre_id=producto_nombre_id,
            horizonte_dias=min(max(horizonte_dias, 1), 365),
            local_id=local_id,
        )
    except Exception as e:
        raise _handle(e)


@router.get(
    "/{tenant_id}/stock/models/{producto_nombre_id}/detail/{descripcion_id}",
    response_model=StockModelDetailResponse,
)
async def get_stock_model_detail(
    tenant_id: str, producto_nombre_id: int, descripcion_id: int, request: Request,
    local_id: int | None = None,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> StockModelDetailResponse:
    """CAPA 3+4: colores, talles y demanda por local para una Descripción."""
    try:
        return await service.get_stock_model_detail(
            session, tenant_id, _get_registry(request),
            producto_nombre_id=producto_nombre_id,
            descripcion_id=descripcion_id,
            local_id=local_id,
        )
    except Exception as e:
        raise _handle(e)


@router.get("/{tenant_id}/stock/proveedor/{producto_nombre_id}/{descripcion_id}", response_model=ProveedorProductoResponse)
async def get_proveedor_producto(
    tenant_id: str, producto_nombre_id: int, descripcion_id: int, request: Request,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> ProveedorProductoResponse:
    """Last supplier and average purchase price for a ProductoDescripcion."""
    try:
        return await service.get_proveedor_producto(
            session, tenant_id, _get_registry(request),
            producto_nombre_id=producto_nombre_id,
            descripcion_id=descripcion_id,
        )
    except Exception as e:
        raise _handle(e)


@router.get("/{tenant_id}/stock/liquidation/{producto_nombre_id}", response_model=StockLiquidationResponse)
async def get_stock_liquidation(
    tenant_id: str, producto_nombre_id: int, request: Request,
    local_id: int | None = None,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> StockLiquidationResponse:
    """Modelos candidatos a liquidar: stock muerto sin rotación."""
    try:
        return await service.get_stock_liquidation(
            session, tenant_id, _get_registry(request),
            producto_nombre_id=producto_nombre_id,
            local_id=local_id,
        )
    except Exception as e:
        raise _handle(e)


# ── Predicciones ─────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/predicciones", response_model=PrediccionesResponse)
async def get_predicciones(
    tenant_id: str,
    request: Request,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    local_id: int | None = None,
    modelo: str | None = None,
    periodo_dias: int | None = None,
    sobre_stock_pct: float | None = None,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> PrediccionesResponse:
    """Predicción de demanda y recomendación de stock."""
    registry = _get_registry(request)
    try:
        return await service.get_predicciones(
            session,
            tenant_id,
            registry,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            local_id=local_id,
            modelo=modelo or 'basico',
            periodo_dias=periodo_dias or 30,
            sobre_stock_pct=sobre_stock_pct or 0.0,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error querying tenant database: {e}",
        )


@router.post("/{tenant_id}/predicciones/ai-context", response_model=AiAnalysisResponse)
async def get_predicciones_ai_context(
    tenant_id: str,
    body: dict = Body(...),
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> AiAnalysisResponse:
    """Call Claude AI to analyze predictions and return insights + adjustment factors."""
    grupos = body.get("grupos", [])
    periodo_dias = int(body.get("periodo_dias", 30))
    fecha_actual = body.get("fecha_actual", "")
    try:
        return await service.get_predicciones_ai(grupos, periodo_dias, fecha_actual)
    except Exception as e:
        raise _handle(e)


# ── Compras ───────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/compras", response_model=ComprasResponse)
async def get_compras(
    tenant_id: str, request: Request,
    fecha_desde: date | None = None, fecha_hasta: date | None = None,
    local_id: int | None = None, proveedor_id: int | None = None,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> ComprasResponse:
    try:
        return await service.get_compras(
            session, tenant_id, _get_registry(request),
            fecha_desde=fecha_desde, fecha_hasta=fecha_hasta,
            local_id=local_id, proveedor_id=proveedor_id,
        )
    except Exception as e:
        raise _handle(e)


# ── Filtros ───────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/filtros", response_model=FiltrosDisponibles)
async def get_filtros(
    tenant_id: str, request: Request,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> FiltrosDisponibles:
    try:
        return await service.get_filtros(session, tenant_id, _get_registry(request))
    except Exception as e:
        raise _handle(e)

# ── Multilocal ─────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/stock/multilocal", response_model=StockMultilocalResponse)
async def get_stock_multilocal(
    tenant_id: str, request: Request,
    local_id: int | None = None,
    _admin: User = Depends(require_admin), session: AsyncSession = Depends(_get_db),
) -> StockMultilocalResponse:
    """
    Multi-location stock heatmap and transfer recommendations.

    Returns coverage heatmap (rows=products, cols=locales) and a ranked list
    of recommended stock transfers to balance inventory across stores.
    """
    try:
        return await service.get_stock_multilocal(
            session, tenant_id, _get_registry(request), local_id=local_id,
        )
    except Exception as e:
        raise _handle(e)
