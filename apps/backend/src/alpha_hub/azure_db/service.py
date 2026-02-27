"""
Azure DB service: manages per-tenant Azure SQL connection config.
Credentials (full connection string) are stored encrypted in Supabase Vault.
"""
import time
import urllib.parse
import uuid
from datetime import UTC, datetime

import structlog
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from ..database.vault import VaultClient
from ..models.platform import TenantDbConfig
from .schemas import AzureDbConfigCreate, AzureDbConfigResponse, AzureDbTestResult

logger = structlog.get_logger()
_vault = VaultClient()


def _build_connection_url(
    host: str, database_name: str, db_username: str, password: str
) -> str:
    """
    Builds an async SQLAlchemy connection URL for Azure SQL via aioodbc.
    Requires ODBC Driver 18 for SQL Server to be installed on the server.
    """
    # URL-encode credentials to handle special characters
    encoded_pwd = urllib.parse.quote_plus(password)
    encoded_user = urllib.parse.quote_plus(db_username)
    driver = urllib.parse.quote_plus("ODBC Driver 18 for SQL Server")
    return (
        f"mssql+aioodbc://{encoded_user}:{encoded_pwd}@{host}/{database_name}"
        f"?driver={driver}&encrypt=yes&TrustServerCertificate=no&Connection+Timeout=10"
    )


async def get_db_config(
    session: AsyncSession, tenant_id: str
) -> TenantDbConfig | None:
    result = await session.execute(
        select(TenantDbConfig).where(TenantDbConfig.tenant_id == tenant_id)
    )
    return result.scalar_one_or_none()


async def save_db_config(
    session: AsyncSession,
    tenant_id: str,
    data: AzureDbConfigCreate,
    *,
    tenant_registry: object | None = None,
) -> AzureDbConfigResponse:
    """
    Creates or updates the Azure DB config for a tenant.
    The password is stored as a connection string in Supabase Vault.
    """
    conn_url = _build_connection_url(
        data.host, data.database_name, data.db_username, data.password
    )
    vault_name = f"azure_db_{tenant_id}"
    now = datetime.now(UTC)

    # Check if config already exists
    existing = await get_db_config(session, tenant_id)

    if existing and existing.vault_secret_id:
        # Update existing vault secret
        await _vault.update_secret(str(existing.vault_secret_id), conn_url)
        existing.host = data.host
        existing.database_name = data.database_name
        existing.db_username = data.db_username
        existing.status = "configured"
        existing.updated_at = now
        await session.flush()
        config = existing
    else:
        # Create new vault secret
        vault_secret_id_str = await _vault.create_secret(
            conn_url, vault_name, f"Azure SQL connection for tenant {tenant_id}"
        )
        if existing:
            # Config row exists but has no vault secret yet
            existing.host = data.host
            existing.database_name = data.database_name
            existing.db_username = data.db_username
            existing.vault_secret_id = uuid.UUID(vault_secret_id_str)  # type: ignore[assignment]
            existing.status = "configured"
            existing.updated_at = now
            await session.flush()
            config = existing
        else:
            config = TenantDbConfig(
                id=uuid.uuid4(),
                tenant_id=uuid.UUID(tenant_id),  # type: ignore[assignment]
                host=data.host,
                database_name=data.database_name,
                db_username=data.db_username,
                vault_secret_id=uuid.UUID(vault_secret_id_str),  # type: ignore[assignment]
                status="pending",
                created_at=now,
                updated_at=now,
            )
            session.add(config)
            await session.flush()

    # Invalidate cached engine so next request picks up the new connection string
    if tenant_registry is not None:
        from ..database.tenant import TenantConnectionRegistry
        if isinstance(tenant_registry, TenantConnectionRegistry):
            await tenant_registry.remove_engine(tenant_id)

    return AzureDbConfigResponse(
        id=str(config.id),
        tenant_id=str(config.tenant_id),
        host=config.host,
        database_name=config.database_name,
        db_username=config.db_username,
        status=config.status,
        last_tested_at=config.last_tested_at,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )


async def test_db_connection(
    session: AsyncSession, tenant_id: str
) -> AzureDbTestResult:
    """
    Tests the Azure SQL connection for the given tenant.
    Retrieves the connection string from Supabase Vault and runs SELECT 1.
    Requires aioodbc + ODBC Driver 18 for SQL Server installed on the server.
    """
    config = await get_db_config(session, tenant_id)
    if not config or not config.vault_secret_id:
        return AzureDbTestResult(
            success=False, error="No database configuration found for this tenant."
        )

    try:
        conn_url = await _vault.get_secret(str(config.vault_secret_id))
    except Exception as e:
        logger.warning("Failed to retrieve vault secret", tenant_id=tenant_id, error=str(e))
        return AzureDbTestResult(success=False, error=f"Could not retrieve credentials: {e}")

    start = time.perf_counter()
    try:
        engine = create_async_engine(conn_url, pool_pre_ping=False, echo=False)
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        await engine.dispose()
        latency_ms = int((time.perf_counter() - start) * 1000)

        # Update status in DB
        config.status = "connected"
        config.last_tested_at = datetime.now(UTC)
        await session.flush()

        return AzureDbTestResult(success=True, latency_ms=latency_ms)

    except Exception as e:
        latency_ms = int((time.perf_counter() - start) * 1000)
        logger.warning("Azure SQL connection test failed", tenant_id=tenant_id, error=str(e))

        config.status = "error"
        config.last_tested_at = datetime.now(UTC)
        await session.flush()

        return AzureDbTestResult(success=False, latency_ms=latency_ms, error=str(e))


async def delete_db_config(session: AsyncSession, tenant_id: str) -> bool:
    """Deletes the DB config and removes the vault secret. Returns True if found."""
    config = await get_db_config(session, tenant_id)
    if not config:
        return False

    if config.vault_secret_id:
        try:
            await _vault.delete_secret(str(config.vault_secret_id))
        except Exception as e:
            logger.warning("Failed to delete vault secret", error=str(e))

    await session.delete(config)
    await session.flush()
    return True
