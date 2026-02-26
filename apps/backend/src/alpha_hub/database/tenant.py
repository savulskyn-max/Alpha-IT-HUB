"""
TenantConnectionRegistry: manages one AsyncEngine per tenant for Azure SQL.
Engines are created lazily on first request and reused across requests.
This avoids re-decrypting credentials on every API call.
"""
from __future__ import annotations

import asyncio

import structlog
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from .vault import VaultClient

logger = structlog.get_logger()


class TenantConnectionRegistry:
    def __init__(self) -> None:
        self._engines: dict[str, AsyncEngine] = {}
        self._lock = asyncio.Lock()
        self._vault = VaultClient()

    async def get_engine(self, tenant_id: str, vault_secret_id: str) -> AsyncEngine:
        """
        Returns an AsyncEngine for the given tenant.
        Creates one from vault credentials if not already cached.
        """
        if tenant_id in self._engines:
            return self._engines[tenant_id]

        async with self._lock:
            # Double-checked locking pattern
            if tenant_id in self._engines:
                return self._engines[tenant_id]

            conn_str = await self._vault.get_secret(vault_secret_id)
            engine = create_async_engine(
                conn_str,
                pool_size=3,
                max_overflow=2,
                pool_pre_ping=True,
                pool_recycle=300,  # 5 min — safe for Azure SQL idle timeout
                echo=False,
            )
            self._engines[tenant_id] = engine
            logger.info("Created Azure SQL engine for tenant", tenant_id=tenant_id)
            return engine

    async def remove_engine(self, tenant_id: str) -> None:
        """Disposes and removes a tenant's engine (e.g. when DB config changes)."""
        async with self._lock:
            if engine := self._engines.pop(tenant_id, None):
                await engine.dispose()
                logger.info("Disposed Azure SQL engine for tenant", tenant_id=tenant_id)

    async def close_all(self) -> None:
        """Dispose all tenant engines on shutdown."""
        async with self._lock:
            for tenant_id, engine in self._engines.items():
                await engine.dispose()
                logger.info("Disposed engine", tenant_id=tenant_id)
            self._engines.clear()
