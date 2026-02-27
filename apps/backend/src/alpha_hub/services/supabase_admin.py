"""
Supabase Auth Admin client using httpx (async).
Manages auth.users via the Supabase Management API.
"""
import httpx

from ..config import get_settings

settings = get_settings()

_AUTH_ADMIN_BASE = f"{settings.SUPABASE_URL}/auth/v1/admin"

_HEADERS = {
    "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
}


async def admin_list_users(page: int = 1, per_page: int = 50) -> list[dict]:
    """List all auth users (paginated)."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{_AUTH_ADMIN_BASE}/users",
            headers=_HEADERS,
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
            f"{_AUTH_ADMIN_BASE}/users/{user_id}",
            headers=_HEADERS,
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
            f"{_AUTH_ADMIN_BASE}/users",
            headers=_HEADERS,
            json=payload,
            timeout=15.0,
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
            f"{_AUTH_ADMIN_BASE}/users/{user_id}",
            headers=_HEADERS,
            json=payload,
            timeout=10.0,
        )
        resp.raise_for_status()
        return resp.json()


async def admin_delete_user(user_id: str) -> None:
    """Permanently delete an auth user."""
    async with httpx.AsyncClient() as client:
        resp = await client.delete(
            f"{_AUTH_ADMIN_BASE}/users/{user_id}",
            headers=_HEADERS,
            timeout=10.0,
        )
        resp.raise_for_status()
