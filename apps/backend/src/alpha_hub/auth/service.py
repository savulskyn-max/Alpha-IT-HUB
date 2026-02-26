"""
AuthService: handles Supabase JWT verification.
The JWT is issued by Supabase Auth and contains custom claims
(tenant_id, user_role) injected via the custom_access_token_hook.
"""
import structlog
from jose import JWTError, jwt

from ..config import get_settings

logger = structlog.get_logger()
settings = get_settings()


class AuthService:
    async def verify_jwt(self, token: str) -> dict:
        """
        Decode and verify a Supabase JWT.
        Returns the claims dict on success, raises ValueError on failure.
        """
        try:
            claims = jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False},  # Supabase tokens don't always set aud
            )
            return claims
        except JWTError as e:
            logger.warning("JWT verification failed", error=str(e))
            raise ValueError(f"Invalid token: {e}") from e
