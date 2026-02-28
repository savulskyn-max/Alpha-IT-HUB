"""
AuthService: handles Supabase JWT verification.
The JWT is issued by Supabase Auth and contains custom claims
(tenant_id, user_role) injected via the custom_access_token_hook.
"""
import time

import httpx
import structlog
from jose import JWTError, jwt

from ..config import get_settings

logger = structlog.get_logger()
settings = get_settings()


class AuthService:
    _jwks_cache: dict[str, dict] | None = None
    _jwks_cached_at: float = 0.0
    _jwks_ttl_seconds: int = 300

    async def _fetch_jwks(self, force_refresh: bool = False) -> dict[str, dict]:
        now = time.time()
        if (
            not force_refresh
            and self._jwks_cache is not None
            and now - self._jwks_cached_at < self._jwks_ttl_seconds
        ):
            return self._jwks_cache

        if not settings.SUPABASE_URL:
            raise ValueError("SUPABASE_URL is required to verify asymmetric JWTs")

        jwks_url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(jwks_url)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            logger.warning("Failed to load Supabase JWKS", error=str(exc), url=jwks_url)
            raise ValueError("Unable to fetch signing keys for token verification") from exc

        keys = payload.get("keys", [])
        indexed = {key.get("kid"): key for key in keys if isinstance(key, dict) and key.get("kid")}
        if not indexed:
            raise ValueError("No signing keys found in Supabase JWKS")

        self._jwks_cache = indexed
        self._jwks_cached_at = now
        return indexed

    async def verify_jwt(self, token: str) -> dict:
        """
        Decode and verify a Supabase JWT.
        Returns the claims dict on success, raises ValueError on failure.
        """
        try:
            header = jwt.get_unverified_header(token)
            alg = str(header.get("alg", ""))

            if alg.startswith("HS"):
                if not settings.SUPABASE_JWT_SECRET:
                    raise ValueError("SUPABASE_JWT_SECRET is required for HS-signed JWTs")
                claims = jwt.decode(
                    token,
                    settings.SUPABASE_JWT_SECRET,
                    algorithms=[alg],
                    options={"verify_aud": False},
                )
                return claims

            if alg.startswith("RS") or alg.startswith("ES"):
                kid = header.get("kid")
                if not kid:
                    raise ValueError("Missing kid in JWT header")

                jwks = await self._fetch_jwks()
                key = jwks.get(kid)
                if key is None:
                    jwks = await self._fetch_jwks(force_refresh=True)
                    key = jwks.get(kid)
                if key is None:
                    raise ValueError("Signing key not found for token")

                claims = jwt.decode(
                    token,
                    key,
                    algorithms=[alg],
                    options={"verify_aud": False},
                )
                return claims

            raise ValueError(f"Unsupported JWT algorithm: {alg or 'unknown'}")
        except ValueError:
            raise
        except JWTError as exc:
            logger.warning("JWT verification failed", error=str(exc))
            raise ValueError(f"Invalid token: {exc}") from exc
