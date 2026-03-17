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
    PrediccionesResponse,
    RecomendacionAvanzadaResponse,
    RecomendacionSimpleResponse,
    StockAnalysisResponse,
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
