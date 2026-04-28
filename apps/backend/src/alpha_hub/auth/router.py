import time

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from ..core.security import TokenRevocationList
from ..database.platform import get_platform_session
from ..dependencies import get_current_user
from ..models.platform import Tenant, User
from .schemas import AuthMeResponse, LogoutResponse, TokenVerifyRequest, TokenVerifyResponse
from .service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])
_auth_service = AuthService()
_bearer = HTTPBearer()


@router.post("/verify", response_model=TokenVerifyResponse)
async def verify_token(payload: TokenVerifyRequest) -> TokenVerifyResponse:
    """
    Verify a Supabase JWT and return decoded claims including tenant_id and role.
    Called by mobile/web on app startup to validate a stored session token.
    """
    try:
        claims = await _auth_service.verify_jwt(payload.token)
        return TokenVerifyResponse(
            valid=True,
            user_id=claims["sub"],
            tenant_id=claims.get("tenant_id"),
            role=claims.get("user_role", "staff"),
            expires_at=int(claims.get("exp", 0)),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        ) from e


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> LogoutResponse:
    """
    Revoke the current access token server-side.
    Called on inactivity auto-logout so backend requests with the same
    token are rejected immediately, even before its natural expiry.
    """
    token = credentials.credentials
    try:
        claims = await _auth_service.verify_jwt(token)
        exp = float(claims.get("exp", time.time() + 3600))
    except ValueError:
        # Token already invalid — treat as successful logout
        return LogoutResponse(ok=True)

    TokenRevocationList.revoke(token, exp)
    return LogoutResponse(ok=True)


@router.get("/me", response_model=AuthMeResponse)
async def get_me(current_user: User = Depends(get_current_user)) -> AuthMeResponse:
    """Returns the full profile of the authenticated user, including tenant info."""
    tenant_name = ""
    tenant_slug = ""

    if current_user.tenant_id:
        async with get_platform_session() as session:
            result = await session.execute(
                select(Tenant).where(Tenant.id == current_user.tenant_id)
            )
            tenant = result.scalar_one_or_none()
            if tenant:
                tenant_name = tenant.name
                tenant_slug = tenant.slug

    return AuthMeResponse(
        id=str(current_user.id),
        email=current_user.email,
        full_name=current_user.full_name,
        avatar_url=current_user.avatar_url,
        role=current_user.role,
        tenant_id=str(current_user.tenant_id) if current_user.tenant_id else "",
        tenant_name=tenant_name,
        tenant_slug=tenant_slug,
    )
