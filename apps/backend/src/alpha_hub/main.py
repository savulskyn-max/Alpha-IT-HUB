from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database.platform import close_platform_db, init_platform_db
from .database.tenant import TenantConnectionRegistry
from .tenants.middleware import TenantMiddleware
from .api.v1.router import api_v1_router

logger = structlog.get_logger()
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Starting Alpha IT Hub API", env=settings.APP_ENV)
    await init_platform_db()
    app.state.tenant_registry = TenantConnectionRegistry()
    yield
    await close_platform_db()
    await app.state.tenant_registry.close_all()
    logger.info("API shutdown complete")


app = FastAPI(
    title="Alpha IT Hub API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TenantMiddleware)

app.include_router(api_v1_router, prefix=settings.API_V1_PREFIX)


@app.get("/health", tags=["system"])
async def health_check() -> dict:
    return {"status": "ok", "version": "0.1.0", "env": settings.APP_ENV}
