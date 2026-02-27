"""
VaultClient: retrieves, creates, and updates encrypted secrets
(Azure SQL connection strings, API keys) from Supabase Vault or Azure Key Vault.
Falls back to Supabase Vault when AKV is not configured.
"""
import httpx

from ..config import get_settings

settings = get_settings()


class VaultClient:
    # ── READ ───────────────────────────────────────────────────────────────────

    async def get_secret(self, secret_id: str) -> str:
        if settings.AZURE_KEY_VAULT_URL:
            return await self._get_from_akv(secret_id)
        return await self._get_from_supabase_vault(secret_id)

    async def _get_from_supabase_vault(self, secret_id: str) -> str:
        """Retrieves a secret from Supabase Vault via the REST API."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.SUPABASE_URL}/rest/v1/rpc/vault_get_secret",
                headers={
                    "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                },
                json={"secret_id": secret_id},
                timeout=10.0,
            )
            resp.raise_for_status()
            return str(resp.json())

    # ── CREATE ─────────────────────────────────────────────────────────────────

    async def create_secret(self, value: str, name: str, description: str = "") -> str:
        """Stores a new secret. Returns the vault secret UUID."""
        if settings.AZURE_KEY_VAULT_URL:
            return await self._create_in_akv(value, name)
        return await self._create_in_supabase_vault(value, name, description)

    async def _create_in_supabase_vault(self, value: str, name: str, description: str) -> str:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.SUPABASE_URL}/rest/v1/rpc/vault_create_secret",
                headers={
                    "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                },
                json={"p_secret": value, "p_name": name, "p_description": description},
                timeout=10.0,
            )
            resp.raise_for_status()
            result = resp.json()
            return str(result).strip('"')

    # ── UPDATE ─────────────────────────────────────────────────────────────────

    async def update_secret(self, secret_id: str, value: str) -> None:
        """Updates an existing secret's value in the vault."""
        if settings.AZURE_KEY_VAULT_URL:
            await self._update_in_akv(secret_id, value)
            return
        await self._update_in_supabase_vault(secret_id, value)

    async def _update_in_supabase_vault(self, secret_id: str, value: str) -> None:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.SUPABASE_URL}/rest/v1/rpc/vault_update_secret",
                headers={
                    "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                },
                json={"p_secret_id": secret_id, "p_secret": value},
                timeout=10.0,
            )
            resp.raise_for_status()

    # ── DELETE ─────────────────────────────────────────────────────────────────

    async def delete_secret(self, secret_id: str) -> None:
        """Removes a secret from the vault."""
        if settings.AZURE_KEY_VAULT_URL:
            await self._delete_from_akv(secret_id)
            return
        await self._delete_from_supabase_vault(secret_id)

    async def _delete_from_supabase_vault(self, secret_id: str) -> None:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.SUPABASE_URL}/rest/v1/rpc/vault_delete_secret",
                headers={
                    "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                },
                json={"p_secret_id": secret_id},
                timeout=10.0,
            )
            resp.raise_for_status()

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
