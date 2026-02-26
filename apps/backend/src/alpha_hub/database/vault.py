"""
VaultClient: retrieves encrypted secrets (Azure SQL connection strings) from
Supabase Vault or Azure Key Vault.
Falls back to Supabase Vault when AKV is not configured.
"""
import httpx

from ..config import get_settings

settings = get_settings()


class VaultClient:
    async def get_secret(self, secret_id: str) -> str:
        if settings.AZURE_KEY_VAULT_URL:
            return await self._get_from_akv(secret_id)
        return await self._get_from_supabase_vault(secret_id)

    async def _get_from_supabase_vault(self, secret_id: str) -> str:
        """
        Retrieves a secret from Supabase Vault via the REST API.
        Requires the vault_get_secret RPC function to be defined in Supabase.
        """
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

    async def _get_from_akv(self, secret_name: str) -> str:
        """
        Retrieves a secret from Azure Key Vault using service principal auth.
        Requires azure-keyvault-secrets and azure-identity packages.
        """
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
