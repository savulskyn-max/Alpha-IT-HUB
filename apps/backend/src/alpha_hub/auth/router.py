from fastapi import APIRouter, HTTPException, status

from .schemas import TokenVerifyRequest, TokenVerifyResponse
from .service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])
_auth_service = AuthService()


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
