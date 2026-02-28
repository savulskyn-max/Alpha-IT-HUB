"""
VaultClient: retrieves, creates, and updates encrypted secrets
(Azure SQL connection strings, API keys) from Supabase Vault or Azure Key Vault.
Falls back to Supabase Vault when AKV is not configured.

Supabase Vault operations use a direct asyncpg connection (DATABASE_URL) instead
of the REST API to avoid PostgREST authentication edge cases.
"""
import uuid

import asyncpg

from ..config import get_settings

settings = get_settings()


def _asyncpg_dsn() -> str:
    """Convert SQLAlchemy DATABASE_URL to a plain asyncpg DSN."""
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)


class VaultClient:
    # ── READ ───────────────────────────────────────────────────────────────────

    async def get_secret(self, secret_id: str) -> str:
        if settings.AZURE_KEY_VAULT_URL:
            return await self._get_from_akv(secret_id)
        return await self._get_from_supabase_vault(secret_id)

    async def _get_from_supabase_vault(self, secret_id: str) -> str:
        """Retrieves a secret from Supabase Vault via direct DB connection."""
        conn = await asyncpg.connect(_asyncpg_dsn())
        try:
            result = await conn.fetchval(
                "SELECT public.vault_get_secret($1::uuid)",
                uuid.UUID(secret_id),
            )
            return str(result) if result is not None else ""
        finally:
            await conn.close()

    # ── CREATE ─────────────────────────────────────────────────────────────────

    async def create_secret(self, value: str, name: str, description: str = "") -> str:
        """Stores a new secret. Returns the vault secret UUID."""
        if settings.AZURE_KEY_VAULT_URL:
            return await self._create_in_akv(value, name)
        return await self._create_in_supabase_vault(value, name, description)

    async def _create_in_supabase_vault(self, value: str, name: str, description: str) -> str:
        conn = await asyncpg.connect(_asyncpg_dsn())
        try:
            result = await conn.fetchval(
                "SELECT public.vault_create_secret($1, $2, $3)",
                value, name, description,
            )
            return str(result)
        finally:
            await conn.close()

    # ── UPDATE ─────────────────────────────────────────────────────────────────

    async def update_secret(self, secret_id: str, value: str) -> None:
        """Updates an existing secret's value in the vault."""
        if settings.AZURE_KEY_VAULT_URL:
            await self._update_in_akv(secret_id, value)
            return
        await self._update_in_supabase_vault(secret_id, value)

    async def _update_in_supabase_vault(self, secret_id: str, value: str) -> None:
        conn = await asyncpg.connect(_asyncpg_dsn())
        try:
            await conn.execute(
                "SELECT public.vault_update_secret($1::uuid, $2)",
                uuid.UUID(secret_id), value,
            )
        finally:
            await conn.close()

    # ── DELETE ─────────────────────────────────────────────────────────────────

    async def delete_secret(self, secret_id: str) -> None:
        """Removes a secret from the vault."""
        if settings.AZURE_KEY_VAULT_URL:
            await self._delete_from_akv(secret_id)
            return
        await self._delete_from_supabase_vault(secret_id)

    async def _delete_from_supabase_vault(self, secret_id: str) -> None:
        conn = await asyncpg.connect(_asyncpg_dsn())
        try:
            await conn.execute(
                "SELECT public.vault_delete_secret($1::uuid)",
                uuid.UUID(secret_id),
            )
        finally:
            await conn.close()

    # ── AZURE KEY VAULT (fallback) ─────────────────────────────────────────────

    async def _get_from_akv(self, secret_name: str) -> str:
        try:
            from azure.identity.aio import ClientSecretCredential  # type: ignore[import]
            from azure.keyvault.secrets.aio import SecretClient  # type: ignore[import]
        except ImportError as e:
            raise ImportError(
                "Install azure-keyvault-secrets and azure-identity to use AKV"
            ) from e

        credential = ClientSecretCredential(
            settings.AZURE_TENANT_ID_AAD,
            settings.AZURE_CLIENT_ID,
            settings.AZURE_CLIENT_SECRET,
        )
        async with SecretClient(
            vault_url=settings.AZURE_KEY_VAULT_URL, credential=credential
        ) as client:
            secret = await client.get_secret(secret_name)
            return secret.value or ""

    async def _create_in_akv(self, value: str, name: str) -> str:
        try:
            from azure.identity.aio import ClientSecretCredential  # type: ignore[import]
            from azure.keyvault.secrets.aio import SecretClient  # type: ignore[import]
        except ImportError as e:
            raise ImportError(
                "Install azure-keyvault-secrets and azure-identity to use AKV"
            ) from e

        credential = ClientSecretCredential(
            settings.AZURE_TENANT_ID_AAD,
            settings.AZURE_CLIENT_ID,
            settings.AZURE_CLIENT_SECRET,
        )
        async with SecretClient(
            vault_url=settings.AZURE_KEY_VAULT_URL, credential=credential
        ) as client:
            result = await client.set_secret(name, value)
            return result.name

    async def _update_in_akv(self, secret_name: str, value: str) -> None:
        await self._create_in_akv(value, secret_name)

    async def _delete_from_akv(self, secret_name: str) -> None:
        try:
            from azure.identity.aio import ClientSecretCredential  # type: ignore[import]
            from azure.keyvault.secrets.aio import SecretClient  # type: ignore[import]
        except ImportError as e:
            raise ImportError(
                "Install azure-keyvault-secrets and azure-identity to use AKV"
            ) from e

        credential = ClientSecretCredential(
            settings.AZURE_TENANT_ID_AAD,
            settings.AZURE_CLIENT_ID,
            settings.AZURE_CLIENT_SECRET,
        )
        async with SecretClient(
            vault_url=settings.AZURE_KEY_VAULT_URL, credential=credential
        ) as client:
            await client.begin_delete_secret(secret_name)
