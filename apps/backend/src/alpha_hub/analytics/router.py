"""
Analytics router: exposes business intelligence endpoints per tenant.
All endpoints query the tenant's Azure SQL database via TenantConnectionRegistry.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.platform import get_platform_session
from ..database.tenant import TenantConnectionRegistry
from ..dependencies import require_admin
from ..models.platform import User
from . import service
from .schemas import (
    ComprasResponse,
    FiltrosDisponibles,
    GastosResponse,
    KpiSummary,
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
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Tenant registry not available",
        )
    return registry


# ── KPIs ──────────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/kpis", response_model=KpiSummary)
async def get_kpis(
    tenant_id: str,
    request: Request,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> KpiSummary:
    """Key performance indicators: today's sales, month totals, margin."""
    registry = _get_registry(request)
    try:
        return await service.get_kpis(session, tenant_id, registry)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error querying tenant database: {e}",
        )


# ── Ventas ────────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/ventas", response_model=VentasResponse)
async def get_ventas(
    tenant_id: str,
    request: Request,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    local_id: int | None = None,
    metodo_pago_id: int | None = None,
    tipo_venta: str | None = None,
    producto_nombre: str | None = None,
    talle_id: int | None = None,
    color_id: int | None = None,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> VentasResponse:
    """Sales analytics with temporal series and breakdowns by local, payment method, and product."""
    registry = _get_registry(request)
    try:
        return await service.get_ventas(
            session,
            tenant_id,
            registry,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            local_id=local_id,
            metodo_pago_id=metodo_pago_id,
            tipo_venta=tipo_venta,
            producto_nombre=producto_nombre,
            talle_id=talle_id,
            color_id=color_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error querying tenant database: {e}",
        )


# ── Gastos ────────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/gastos", response_model=GastosResponse)
async def get_gastos(
    tenant_id: str,
    request: Request,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    local_id: int | None = None,
    metodo_pago_id: int | None = None,
    tipo_id: int | None = None,
    categoria_id: int | None = None,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> GastosResponse:
    """Expenses analytics with temporal series and category/payment breakdowns."""
    registry = _get_registry(request)
    try:
        return await service.get_gastos(
            session,
            tenant_id,
            registry,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            local_id=local_id,
            metodo_pago_id=metodo_pago_id,
            tipo_id=tipo_id,
            categoria_id=categoria_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error querying tenant database: {e}",
        )


# ── Stock ─────────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/stock", response_model=StockResponse)
async def get_stock(
    tenant_id: str,
    request: Request,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    local_id: int | None = None,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> StockResponse:
    """Stock analytics: levels, rotation, coverage (days), ABC classification."""
    registry = _get_registry(request)
    try:
        return await service.get_stock(
            session,
            tenant_id,
            registry,
            local_id=local_id,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error querying tenant database: {e}",
        )


# ── Compras ───────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/compras", response_model=ComprasResponse)
async def get_compras(
    tenant_id: str,
    request: Request,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    local_id: int | None = None,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> ComprasResponse:
    """Purchase analytics with temporal series and top products."""
    registry = _get_registry(request)
    try:
        return await service.get_compras(
            session,
            tenant_id,
            registry,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            local_id=local_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error querying tenant database: {e}",
        )


# ── Filtros ───────────────────────────────────────────────────────────────────

@router.get("/{tenant_id}/filtros", response_model=FiltrosDisponibles)
async def get_filtros(
    tenant_id: str,
    request: Request,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> FiltrosDisponibles:
    """Available filter values: locals, payment methods, sizes, colors, expense types."""
    registry = _get_registry(request)
    try:
        return await service.get_filtros(session, tenant_id, registry)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error querying tenant database: {e}",
        )
