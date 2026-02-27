"""
Shared FastAPI dependencies for authentication and authorization.
"""
import structlog
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from .auth.service import AuthService
from .database.platform import get_platform_session
from .database.tenant import TenantConnectionRegistry
from .models.platform import User

logger = structlog.get_logger()
bearer = HTTPBearer()
_auth_service = AuthService()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
) -> User:
    """
    Verifies the Bearer JWT and returns the platform User record.
    Raises 401 if the token is invalid or the user profile doesn't exist.
    """
    try:
        claims = await _auth_service.verify_jwt(credentials.credentials)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e

    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing user ID in token"
        )

    async with get_platform_session() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User profile not found. Contact your administrator.",
        )

    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Requires the user to be an internal admin (superadmin or admin role)."""
    if user.role not in ("superadmin", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return user


async def get_tenant_registry(request: Request) -> TenantConnectionRegistry:
    """Returns the app-wide tenant connection registry."""
    return request.app.state.tenant_registry  # type: ignore[return-value]
