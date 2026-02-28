"""
Tenants router: CRUD endpoints for platform tenants.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.platform import get_platform_session
from ..dependencies import get_current_user, require_admin
from ..models.platform import Tenant, User
from . import service
from .schemas import TenantCreate, TenantDetail, TenantInfo, TenantListResponse, TenantUpdate

router = APIRouter(prefix="/tenants", tags=["tenants"])


async def _get_db() -> AsyncSession:  # type: ignore[return]
    async with get_platform_session() as session:
        yield session  # type: ignore[misc]


@router.get("", response_model=TenantListResponse)
async def list_tenants(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> TenantListResponse:
    """List all tenants (admin only)."""
    tenants, total = await service.list_tenants(session, limit=limit, offset=offset)
    return TenantListResponse(items=tenants, total=total)


@router.get("/me", response_model=TenantInfo)
async def get_my_tenant(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(_get_db),
) -> TenantInfo:
    """Returns tenant info for the authenticated user."""
    if not current_user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenant associated with this account",
        )
    tenant_id = str(current_user.tenant_id)
    detail = await service.get_tenant_by_id(session, tenant_id)
    if not detail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return TenantInfo(
        id=detail.id,
        name=detail.name,
        slug=detail.slug,
        status=detail.status,
        plan_id=detail.plan_id,
        settings={},
    )


@router.post("", response_model=TenantDetail, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    data: TenantCreate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> TenantDetail:
    """Create a new tenant (admin only)."""
    # Verify slug is unique
    result = await session.execute(select(Tenant).where(Tenant.slug == data.slug))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Slug '{data.slug}' already exists",
        )
    try:
        tenant = await service.create_tenant(session, data)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    detail = await service.get_tenant_by_id(session, str(tenant.id))
    return detail  # type: ignore[return-value]


@router.get("/{tenant_id}", response_model=TenantDetail)
async def get_tenant(
    tenant_id: str,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> TenantDetail:
    """Get a specific tenant (admin only)."""
    detail = await service.get_tenant_by_id(session, tenant_id)
    if not detail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return detail


@router.put("/{tenant_id}", response_model=TenantDetail)
async def update_tenant(
    tenant_id: str,
    data: TenantUpdate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> TenantDetail:
    """Update a tenant (admin only)."""
    result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    try:
        await service.update_tenant(session, tenant, data)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    detail = await service.get_tenant_by_id(session, tenant_id)
    return detail  # type: ignore[return-value]


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tenant(
    tenant_id: str,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> None:
    """Delete a tenant (admin only)."""
    result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    await service.delete_tenant(session, tenant)
