"""
Subscription service: read/update operations against the platform database.
"""
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.platform import Plan, Subscription, Tenant
from .schemas import SubscriptionResponse, SubscriptionUpdate


def _row_to_response(sub: Subscription, tenant_name: str, plan_name: str | None) -> SubscriptionResponse:
    return SubscriptionResponse(
        id=str(sub.id),
        tenant_id=str(sub.tenant_id),
        tenant_name=tenant_name,
        plan_id=str(sub.plan_id) if sub.plan_id else None,
        plan_name=plan_name,
        status=sub.status,
        billing_cycle=sub.billing_cycle,
        payment_provider=sub.payment_provider,
        current_period_end=sub.current_period_end,
        cancel_at_period_end=sub.cancel_at_period_end,
        cancelled_at=sub.cancelled_at,
        created_at=sub.created_at,
    )


async def list_subscriptions(
    session: AsyncSession, *, limit: int = 50, offset: int = 0
) -> tuple[list[SubscriptionResponse], int]:
    count_result = await session.execute(select(func.count()).select_from(Subscription))
    total = count_result.scalar_one()

    result = await session.execute(
        select(Subscription, Tenant.name.label("tenant_name"), Plan.name.label("plan_name"))
        .join(Tenant, Subscription.tenant_id == Tenant.id)
        .outerjoin(Plan, Subscription.plan_id == Plan.id)
        .order_by(Subscription.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = result.all()

    items = [
        _row_to_response(sub, tenant_name, plan_name)
        for sub, tenant_name, plan_name in rows
    ]
    return items, total


async def get_subscription_by_tenant(
    session: AsyncSession, tenant_id: str
) -> SubscriptionResponse | None:
    result = await session.execute(
        select(Subscription, Tenant.name.label("tenant_name"), Plan.name.label("plan_name"))
        .join(Tenant, Subscription.tenant_id == Tenant.id)
        .outerjoin(Plan, Subscription.plan_id == Plan.id)
        .where(Subscription.tenant_id == tenant_id)
    )
    row = result.first()
    if not row:
        return None
    sub, tenant_name, plan_name = row
    return _row_to_response(sub, tenant_name, plan_name)


async def update_subscription(
    session: AsyncSession, sub: Subscription, data: SubscriptionUpdate
) -> Subscription:
    if data.status is not None:
        sub.status = data.status
    if data.plan_id is not None:
        try:
            sub.plan_id = uuid.UUID(data.plan_id)  # type: ignore[assignment]
        except ValueError:
            pass
    if data.billing_cycle is not None:
        sub.billing_cycle = data.billing_cycle
    if data.cancel_at_period_end is not None:
        sub.cancel_at_period_end = data.cancel_at_period_end
    await session.flush()
    return sub
