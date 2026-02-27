from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database.platform import close_platform_db, get_db_error, init_platform_db
from .database.tenant import TenantConnectionRegistry
from .tenants.middleware import TenantMiddleware
from .api.v1.router import api_v1_router

logger = structlog.get_logger()
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    try:
        logger.info("Starting Alpha IT Hub API", env=settings.APP_ENV)
        await init_platform_db()
        app.state.tenant_registry = TenantConnectionRegistry()
        logger.info("Startup complete — all systems ready")
    except Exception as exc:
        logger.error("STARTUP FAILED", error=str(exc), exc_info=True)
        raise
    yield
    try:
        await close_platform_db()
        await app.state.tenant_registry.close_all()
    except Exception as exc:
        logger.error("Shutdown error", error=str(exc))
    logger.info("API shutdown complete")


app = FastAPI(
    title="Alpha IT Hub API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url=None,
)

# Auth is Bearer-token based (no cookies), so allow_origins=["*"] is safe.
# allow_credentials=True cannot be combined with allow_origins=["*"] per the CORS spec.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TenantMiddleware)

app.include_router(api_v1_router, prefix=settings.API_V1_PREFIX)


@app.get("/health", tags=["system"])
async def health_check() -> dict:
    db_error = get_db_error()
    return {
        "status": "degraded" if db_error else "ok",
        "version": "0.1.0",
        "env": settings.APP_ENV,
        "db": "error" if db_error else "ok",
        "db_error": db_error,
    }
