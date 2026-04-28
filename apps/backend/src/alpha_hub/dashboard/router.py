"""
Dashboard router: single aggregated endpoint for the main client dashboard.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.platform import get_platform_session
from ..database.tenant import TenantConnectionRegistry
from ..dependencies import require_analytics_access
from . import service
from .schemas import DashboardKpis

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

_analytics_access = require_analytics_access("tenant_id")


async def _get_db():
    async with get_platform_session() as session:
        yield session


def _get_registry(request: Request) -> TenantConnectionRegistry:
    registry = getattr(request.app.state, "tenant_registry", None)
    if registry is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Tenant registry not available",
        )
    return registry


def _handle(exc: Exception) -> HTTPException:
    if isinstance(exc, ValueError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Error querying tenant database: {exc}",
    )


@router.get("/{tenant_id}/kpis", response_model=DashboardKpis)
async def get_dashboard_kpis(
    tenant_id: str,
    request: Request,
    local_id: int | None = None,
    _user=Depends(_analytics_access),
    session: AsyncSession = Depends(_get_db),
) -> DashboardKpis:
    """
    Aggregated KPIs for the main dashboard:
      - Ventas de hoy (cantidad + monto desde VentaCabecera)
      - Ticket promedio (hoy, o últimos 7 días como fallback)
      - Stock crítico (conteo de vw_ProductosBajoStock)
      - Ítems en baja rotación (sin ventas en 60 días, stock > 0)
      - Tendencia de ventas últimos 7 días
    """
    try:
        return await service.get_dashboard_kpis(
            session,
            tenant_id,
            _get_registry(request),
            local_id=local_id,
        )
    except Exception as exc:
        raise _handle(exc)
