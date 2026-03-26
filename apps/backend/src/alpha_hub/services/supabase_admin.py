"""
Supabase Auth Admin client using httpx (async).
Manages auth.users via the Supabase Management API.

IMPORTANT: All admin operations require the SUPABASE_SERVICE_ROLE_KEY
(not the anon key). The service role key has full access to auth.users.
"""
import httpx
import structlog

from ..config import get_settings

logger = structlog.get_logger()


def _get_admin_base() -> str:
    settings = get_settings()
    return f"{settings.SUPABASE_URL}/auth/v1/admin"


def _get_headers() -> dict[str, str]:
    """
    Build headers on every call so that:
    1. We always read the latest settings (important for tests / reloads).
    2. We fail fast with a clear message if SERVICE_ROLE_KEY is missing.
    """
    settings = get_settings()
    key = settings.SUPABASE_SERVICE_ROLE_KEY

    if not key or key == settings.SUPABASE_ANON_KEY:
        msg = (
            "SUPABASE_SERVICE_ROLE_KEY is missing or is the same as SUPABASE_ANON_KEY. "
            "The Supabase Admin API requires the service_role key (found in Supabase Dashboard > "
            "Settings > API > service_role). This key is different from the anon key."
        )
        logger.error("supabase_admin_key_error", detail=msg)
        raise ValueError(msg)

    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


async def admin_list_users(page: int = 1, per_page: int = 50) -> list[dict]:
    """List all auth users (paginated)."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{_get_admin_base()}/users",
            headers=_get_headers(),
            params={"page": page, "per_page": per_page},
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("users", data) if isinstance(data, dict) else data


async def admin_get_user(user_id: str) -> dict:
    """Get a single auth user by ID."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{_get_admin_base()}/users/{user_id}",
            headers=_get_headers(),
            timeout=10.0,
        )
        resp.raise_for_status()
        return resp.json()


async def admin_create_user(
    email: str,
    password: str | None = None,
    *,
    email_confirm: bool = True,
    user_metadata: dict | None = None,
) -> dict:
    """
    Create a new auth user.
    If password is None, sends a magic link invitation instead.
    Returns the created user dict.
    """
    payload: dict = {
        "email": email,
        "email_confirm": email_confirm,
    }
    if password:
        payload["password"] = password
    if user_metadata:
        payload["user_metadata"] = user_metadata

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{_get_admin_base()}/users",
            headers=_get_headers(),
            json=payload,
            timeout=15.0,
        )
        if not resp.is_success:
            body = resp.text
            logger.error(
                "supabase_admin_create_failed",
                status=resp.status_code,
                body=body,
                email=email,
            )
            resp.raise_for_status()
        return resp.json()


async def admin_update_user(user_id: str, *, email: str | None = None, **kwargs: object) -> dict:
    """Update an auth user's email or metadata."""
    payload: dict = {}
    if email:
        payload["email"] = email
    payload.update(kwargs)

    async with httpx.AsyncClient() as client:
        resp = await client.put(
            f"{_get_admin_base()}/users/{user_id}",
            headers=_get_headers(),
            json=payload,
            timeout=10.0,
        )
        resp.raise_for_status()
        return resp.json()


async def admin_delete_user(user_id: str) -> None:
    """Permanently delete an auth user."""
    async with httpx.AsyncClient() as client:
        resp = await client.delete(
            f"{_get_admin_base()}/users/{user_id}",
            headers=_get_headers(),
            timeout=10.0,
        )
        resp.raise_for_status()
