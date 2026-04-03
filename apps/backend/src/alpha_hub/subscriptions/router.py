"""
Subscriptions router: list and manage tenant subscriptions (admin only).
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.platform import get_platform_session
from ..dependencies import require_admin
from ..models.platform import Subscription, User
from . import service
from .schemas import SubscriptionListResponse, SubscriptionResponse, SubscriptionUpdate

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


async def _get_db() -> AsyncSession:  # type: ignore[return]
    async with get_platform_session() as session:
        yield session  # type: ignore[misc]


@router.get("", response_model=SubscriptionListResponse)
async def list_subscriptions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> SubscriptionListResponse:
    """List all subscriptions (admin only)."""
    items, total = await service.list_subscriptions(session, limit=limit, offset=offset)
    return SubscriptionListResponse(items=items, total=total)


@router.get("/{tenant_id}", response_model=SubscriptionResponse)
async def get_subscription(
    tenant_id: str,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> SubscriptionResponse:
    """Get the subscription for a specific tenant (admin only)."""
    sub = await service.get_subscription_by_tenant(session, tenant_id)
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No subscription found for this tenant",
        )
    return sub


@router.put("/{tenant_id}", response_model=SubscriptionResponse)
async def update_subscription(
    tenant_id: str,
    data: SubscriptionUpdate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> SubscriptionResponse:
    """Update a tenant's subscription (admin only)."""
    result = await session.execute(
        select(Subscription).where(Subscription.tenant_id == tenant_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No subscription found for this tenant",
        )
    await service.update_subscription(session, sub, data)
    updated = await service.get_subscription_by_tenant(session, tenant_id)
    return updated  # type: ignore[return-value]
