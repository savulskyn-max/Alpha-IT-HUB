"""
User service: CRUD for the platform users table + Supabase Auth integration.
"""
import uuid
from datetime import UTC, datetime

import structlog
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.platform import get_platform_session
from ..models.platform import User
from ..services.supabase_admin import (
    admin_create_user,
    admin_delete_user,
    admin_update_user,
)
from .schemas import UserCreate, UserUpdate

logger = structlog.get_logger()


async def list_users(
    session: AsyncSession,
    *,
    tenant_id: str | None = None,
    role: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[User], int]:
    """Returns (users, total_count)."""
    query = select(User)
    count_query = select(func.count()).select_from(User)

    if tenant_id:
        query = query.where(User.tenant_id == tenant_id)
        count_query = count_query.where(User.tenant_id == tenant_id)
    if role:
        query = query.where(User.role == role)
        count_query = count_query.where(User.role == role)

    total_result = await session.execute(count_query)
    total = total_result.scalar_one()

    result = await session.execute(query.order_by(User.created_at.desc()).limit(limit).offset(offset))
    users = list(result.scalars().all())

    return users, total


async def get_user_by_id(session: AsyncSession, user_id: str) -> User | None:
    result = await session.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def create_user(data: UserCreate) -> User:
    """
    Creates the Supabase auth user, then upserts the platform profile.
    If the DB insert fails, cleans up the auth user to avoid orphans.
    """
    # Build user_metadata with tenant_id and role so the JWT hook can
    # inject them into the access token immediately.
    metadata: dict = {"full_name": data.full_name}
    if data.tenant_id:
        metadata["tenant_id"] = data.tenant_id
    if data.role:
        metadata["role"] = data.role

    # 1. Create auth user via Supabase Admin API
    auth_user = await admin_create_user(
        email=data.email,
        password=data.password,
        email_confirm=True,
        user_metadata=metadata,
    )
    user_id = auth_user["id"]

    # 2. Upsert into platform users table
    now = datetime.now(UTC)
    try:
        async with get_platform_session() as session:
            stmt = (
                pg_insert(User)
                .values(
                    id=user_id,
                    email=data.email,
                    full_name=data.full_name,
                    phone=data.phone,
                    role=data.role,
                    tenant_id=data.tenant_id,
                    created_at=now,
                    updated_at=now,
                )
                .on_conflict_do_update(
                    index_elements=["id"],
                    set_=dict(
                        full_name=data.full_name,
                        phone=data.phone,
                        role=data.role,
                        tenant_id=data.tenant_id,
                        updated_at=now,
                    ),
                )
            )
            await session.execute(stmt)
            await session.commit()

            result = await session.execute(select(User).where(User.id == user_id))
            return result.scalar_one()
    except Exception as db_err:
        # Clean up the auth user so we don't leave orphans
        logger.error("DB insert failed, cleaning up auth user", user_id=user_id, error=str(db_err))
        try:
            await admin_delete_user(user_id)
        except Exception:
            logger.error("Failed to clean up auth user after DB error", user_id=user_id)
        raise


async def update_user(
    session: AsyncSession,
    user: User,
    data: UserUpdate,
    *,
    is_admin: bool = False,
) -> User:
    """Updates user profile. Role/tenant changes require admin=True."""
    if data.full_name is not None:
        user.full_name = data.full_name
    if data.phone is not None:
        user.phone = data.phone
    if data.avatar_url is not None:
        user.avatar_url = data.avatar_url
    if is_admin:
        if data.role is not None:
            user.role = data.role
        if data.tenant_id is not None:
            user.tenant_id = uuid.UUID(data.tenant_id) if data.tenant_id else None  # type: ignore[assignment]
    user.updated_at = datetime.now(UTC)
    await session.flush()
    return user


async def delete_user(session: AsyncSession, user: User) -> None:
    """Deletes the platform profile and Supabase auth user."""
    user_id = str(user.id)
    await session.delete(user)
    await session.flush()
    # Delete auth user — do after DB flush so we don't orphan auth entries
    await admin_delete_user(user_id)
