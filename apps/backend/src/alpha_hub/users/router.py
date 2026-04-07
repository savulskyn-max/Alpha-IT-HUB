"""
Users router: CRUD endpoints for platform users.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.platform import get_platform_session
from ..dependencies import get_current_user, require_admin
from ..models.platform import User
from . import service
from .schemas import UserCreate, UserListResponse, UserResponse, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


async def _get_db() -> AsyncSession:  # type: ignore[return]
    async with get_platform_session() as session:
        yield session  # type: ignore[misc]


@router.get("", response_model=UserListResponse)
async def list_users(
    tenant_id: str | None = Query(None),
    role: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> UserListResponse:
    """List all platform users (admin only). Filterable by tenant and role."""
    users, total = await service.list_users(
        session, tenant_id=tenant_id, role=role, limit=limit, offset=offset
    )
    return UserListResponse(
        items=[UserResponse.model_validate(u) for u in users],
        total=total,
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    """Returns the authenticated user's profile."""
    return UserResponse.model_validate(current_user)


@router.put("/me", response_model=UserResponse)
async def update_me(
    data: UserUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(_get_db),
) -> UserResponse:
    """Update own profile (name, phone, avatar only — role/tenant require admin)."""
    # Strip privileged fields for self-update
    safe_data = UserUpdate(
        full_name=data.full_name,
        phone=data.phone,
        avatar_url=data.avatar_url,
    )
    updated = await service.update_user(session, current_user, safe_data, is_admin=False)
    return UserResponse.model_validate(updated)


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    data: UserCreate,
    _admin: User = Depends(require_admin),
) -> UserResponse:
    """Create a new user (admin only). Sends invite email if no password provided."""
    try:
        user = await service.create_user(data)
    except ValueError as e:
        error_msg = str(e)
        # Missing/wrong service role key → 500 (config problem)
        if "SUPABASE_SERVICE_ROLE_KEY" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=error_msg,
            ) from e
        # Supabase business-rule rejections (duplicate email, weak password…)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=error_msg,
        ) from e
    except Exception as e:
        error_msg = str(e)
        if "401" in error_msg:
            detail = (
                "Supabase Admin API returned 401 Unauthorized. "
                "Verify that SUPABASE_SERVICE_ROLE_KEY in backend .env is the "
                "service_role key (not the anon key). "
                f"Original error: {error_msg}"
            )
        else:
            detail = f"Could not create user: {error_msg}"
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        ) from e
    return UserResponse.model_validate(user)


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> UserResponse:
    """Get a specific user by ID (admin only)."""
    user = await service.get_user_by_id(session, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserResponse.model_validate(user)


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    data: UserUpdate,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> UserResponse:
    """Update any user's profile or role (admin only)."""
    user = await service.get_user_by_id(session, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    updated = await service.update_user(session, user, data, is_admin=True)
    return UserResponse.model_validate(updated)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(_get_db),
) -> None:
    """Permanently delete a user (admin only)."""
    user = await service.get_user_by_id(session, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await service.delete_user(session, user)
