from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..auth.service import AuthService
from .schemas import TenantInfo

router = APIRouter(prefix="/tenants", tags=["tenants"])
bearer_scheme = HTTPBearer()
_auth_service = AuthService()


async def _get_claims(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    try:
        return await _auth_service.verify_jwt(credentials.credentials)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e


@router.get("/me", response_model=TenantInfo)
async def get_my_tenant(claims: dict = Depends(_get_claims)) -> TenantInfo:
    """
    Returns basic tenant info for the authenticated user.
    Full tenant data requires a platform DB query — stubbed for Phase 1.
    """
    tenant_id = claims.get("tenant_id")
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenant associated with this account",
        )
    # Phase 1: return stub — Phase 2 will query the platform DB
    return TenantInfo(
        id=tenant_id,
        name="",
        slug="",
        status="active",
        plan_id=None,
        settings={},
    )
