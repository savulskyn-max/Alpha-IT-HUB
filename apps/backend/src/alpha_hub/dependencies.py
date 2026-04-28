"""
Shared FastAPI dependencies for authentication and authorization.
"""
import structlog
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from .auth.service import AuthService
from .core.security import TokenRevocationList
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
    token = credentials.credentials

    try:
        claims = await _auth_service.verify_jwt(token)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e

    if TokenRevocationList.is_revoked(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "session_expired", "message": "La sesión fue cerrada por inactividad."},
        )

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


def require_analytics_access(tenant_id_param: str = "tenant_id"):
    """
    Factory that returns a dependency allowing:
    - admin/superadmin: access any tenant's analytics
    - owner/manager/staff: access only their own tenant's analytics
    """
    async def _check(
        request: Request,
        user: User = Depends(get_current_user),
    ) -> User:
        # Admins can access any tenant
        if user.role in ("superadmin", "admin"):
            return user

        # Tenant users can only access their own tenant
        path_tenant_id = request.path_params.get(tenant_id_param)
        if not path_tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing tenant_id.",
            )

        if not user.tenant_id or str(user.tenant_id) != path_tenant_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this tenant's data.",
            )

        return user

    return _check


async def get_tenant_registry(request: Request) -> TenantConnectionRegistry:
    """Returns the app-wide tenant connection registry."""
    return request.app.state.tenant_registry  # type: ignore[return-value]
