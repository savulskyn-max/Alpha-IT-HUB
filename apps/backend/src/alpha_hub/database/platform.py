"""
Platform database: Supabase/PostgreSQL connection for platform-level data
(users, tenants, plans, subscriptions, agents).
"""
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from ..config import get_settings

logger = structlog.get_logger()
settings = get_settings()

# Lazy initialization — engine is None until init_platform_db() is called
_engine = None
_session_factory = None
_db_error: str | None = None


class Base(DeclarativeBase):
    pass


async def init_platform_db() -> None:
    global _engine, _session_factory, _db_error
    if not settings.DATABASE_URL:
        # Allow running without a DB in development
        return
    try:
        _engine = create_async_engine(
            settings.DATABASE_URL,
            pool_size=10,
            max_overflow=5,
            pool_pre_ping=True,
            echo=settings.DEBUG,
            # Required for PgBouncer transaction mode (Supabase pooler port 6543)
            connect_args={"statement_cache_size": 0},
        )
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
        logger.info("Platform DB initialized")
    except Exception as exc:
        _db_error = str(exc)
        logger.error("Platform DB init failed — app will start without DB", error=_db_error)


def get_db_error() -> str | None:
    return _db_error


async def close_platform_db() -> None:
    global _engine
    if _engine:
        await _engine.dispose()
        _engine = None


@asynccontextmanager
async def get_platform_session() -> AsyncGenerator[AsyncSession, None]:
    if _session_factory is None:
        raise RuntimeError("Platform DB not initialized. Call init_platform_db() first.")
    async with _session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
