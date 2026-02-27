"""
Tenant service: CRUD operations against the platform database.
"""
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.platform import Plan, Tenant, TenantDbConfig, User
from .schemas import TenantCreate, TenantDetail, TenantUpdate


async def list_tenants(
    session: AsyncSession, *, limit: int = 50, offset: int = 0
) -> tuple[list[TenantDetail], int]:
    """Returns (tenants, total_count) enriched with plan name and user count."""
    count_result = await session.execute(select(func.count()).select_from(Tenant))
    total = count_result.scalar_one()

    # Fetch tenants with plan join
    result = await session.execute(
        select(Tenant, Plan.name.label("plan_name"))
        .outerjoin(Plan, Tenant.plan_id == Plan.id)
        .order_by(Tenant.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = result.all()

    details: list[TenantDetail] = []
    for tenant, plan_name in rows:
        # User count per tenant
        user_count_result = await session.execute(
            select(func.count()).select_from(User).where(User.tenant_id == tenant.id)
        )
        user_count = user_count_result.scalar_one()

        # DB config status
        db_config_result = await session.execute(
            select(TenantDbConfig.status).where(TenantDbConfig.tenant_id == tenant.id)
        )
        db_status = db_config_result.scalar_one_or_none()

        details.append(
            TenantDetail(
                id=str(tenant.id),
                name=tenant.name,
                slug=tenant.slug,
                status=tenant.status,
                plan_id=str(tenant.plan_id) if tenant.plan_id else None,
                plan_name=plan_name,
                user_count=user_count,
                db_status=db_status,
                created_at=tenant.created_at,
            )
        )

    return details, total


async def get_tenant_by_id(
    session: AsyncSession, tenant_id: str
) -> TenantDetail | None:
    result = await session.execute(
        select(Tenant, Plan.name.label("plan_name"))
        .outerjoin(Plan, Tenant.plan_id == Plan.id)
        .where(Tenant.id == tenant_id)
    )
    row = result.first()
    if not row:
        return None
    tenant, plan_name = row

    user_count_result = await session.execute(
        select(func.count()).select_from(User).where(User.tenant_id == tenant.id)
    )
    user_count = user_count_result.scalar_one()

    db_config_result = await session.execute(
        select(TenantDbConfig.status).where(TenantDbConfig.tenant_id == tenant.id)
    )
    db_status = db_config_result.scalar_one_or_none()

    return TenantDetail(
        id=str(tenant.id),
        name=tenant.name,
        slug=tenant.slug,
        status=tenant.status,
        plan_id=str(tenant.plan_id) if tenant.plan_id else None,
        plan_name=plan_name,
        user_count=user_count,
        db_status=db_status,
        created_at=tenant.created_at,
    )


async def create_tenant(session: AsyncSession, data: TenantCreate) -> Tenant:
    tenant = Tenant(
        id=uuid.uuid4(),
        name=data.name,
        slug=data.slug,
        plan_id=uuid.UUID(data.plan_id) if data.plan_id else None,  # type: ignore[assignment]
        status=data.status,
        created_at=datetime.now(UTC),
    )
    session.add(tenant)
    await session.flush()
    return tenant


async def update_tenant(
    session: AsyncSession, tenant: Tenant, data: TenantUpdate
) -> Tenant:
    if data.name is not None:
        tenant.name = data.name
    if data.plan_id is not None:
        tenant.plan_id = uuid.UUID(data.plan_id) if data.plan_id else None  # type: ignore[assignment]
    if data.status is not None:
        tenant.status = data.status
    await session.flush()
    return tenant


async def delete_tenant(session: AsyncSession, tenant: Tenant) -> None:
    await session.delete(tenant)
    await session.flush()
