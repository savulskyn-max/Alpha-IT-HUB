"""
User service: CRUD for the platform users table + Supabase Auth integration.
"""
import uuid
from datetime import UTC, datetime

import structlog
from sqlalchemy import func, select, text
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


async def _insert_platform_user(
    user_id: str,
    data: UserCreate,
    now: datetime,
) -> User:
    """
    Insert user into platform DB using raw SQL to avoid issues with
    columns that may not exist yet (phone, azure_local_id).
    Falls back to minimal columns if extended columns fail.
    """
    async with get_platform_session() as session:
        # First try with all columns (assumes migration 00004 was run)
        try:
            result = await session.execute(
                text("""
                    INSERT INTO users (id, email, full_name, phone, role, tenant_id, azure_local_id, created_at, updated_at)
                    VALUES (:id, :email, :full_name, :phone, :role, :tenant_id, :azure_local_id, :created_at, :updated_at)
                    ON CONFLICT (id) DO UPDATE SET
                        full_name = EXCLUDED.full_name,
                        phone = EXCLUDED.phone,
                        role = EXCLUDED.role,
                        tenant_id = EXCLUDED.tenant_id,
                        azure_local_id = EXCLUDED.azure_local_id,
                        updated_at = EXCLUDED.updated_at
                    RETURNING id
                """),
                {
                    "id": user_id,
                    "email": data.email,
                    "full_name": data.full_name,
                    "phone": data.phone,
                    "role": data.role,
                    "tenant_id": data.tenant_id,
                    "azure_local_id": data.azure_local_id,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
        except Exception as e1:
            await session.rollback()
            logger.warning(
                "Full insert failed, trying minimal columns",
                error=str(e1),
            )
            # Fallback: only use columns from the original migration
            try:
                result = await session.execute(
                    text("""
                        INSERT INTO users (id, email, full_name, role, tenant_id, created_at, updated_at)
                        VALUES (:id, :email, :full_name, :role, :tenant_id, :created_at, :updated_at)
                        ON CONFLICT (id) DO UPDATE SET
                            full_name = EXCLUDED.full_name,
                            role = EXCLUDED.role,
                            tenant_id = EXCLUDED.tenant_id,
                            updated_at = EXCLUDED.updated_at
                        RETURNING id
                    """),
                    {
                        "id": user_id,
                        "email": data.email,
                        "full_name": data.full_name,
                        "role": data.role,
                        "tenant_id": data.tenant_id,
                        "created_at": now,
                        "updated_at": now,
                    },
                )
                await session.commit()
            except Exception as e2:
                await session.rollback()
                raise RuntimeError(
                    f"DB insert failed. Full attempt: {e1} | Minimal attempt: {e2}"
                ) from e2

        # Read back the user via ORM
        orm_result = await session.execute(select(User).where(User.id == user_id))
        user = orm_result.scalar_one_or_none()
        if not user:
            raise RuntimeError(f"User {user_id} inserted but not found on read-back")
        return user


async def create_user(data: UserCreate) -> User:
    """
    Creates the Supabase auth user, then upserts the platform profile.
    If the DB insert fails, cleans up the auth user to avoid orphans.
    Returns the created User ORM object.
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

    # 2. Insert into platform users table
    now = datetime.now(UTC)
    try:
        return await _insert_platform_user(user_id, data, now)
    except Exception as db_err:
        # Clean up the auth user we just created so we don't leave orphans
        logger.error("DB insert failed, cleaning up auth user", user_id=user_id, error=str(db_err))
        try:
            await admin_delete_user(user_id)
        except Exception:
            logger.error("Failed to clean up auth user after DB error", user_id=user_id)
        raise ValueError(f"User created in Auth but DB insert failed: {db_err}") from db_err


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
        if data.azure_local_id is not None:
            user.azure_local_id = data.azure_local_id
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
