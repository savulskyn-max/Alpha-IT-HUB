from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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

# Middleware order matters: add_middleware() stacks in reverse.
# The LAST add_middleware call becomes the OUTERMOST layer (first to run).
# CORSMiddleware MUST be outermost so it intercepts OPTIONS preflight before
# BaseHTTPMiddleware (TenantMiddleware) can interfere with the response headers.
app.add_middleware(TenantMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all: log unhandled exceptions and return 500 with CORS-safe JSON."""
    logger.error(
        "Unhandled exception",
        path=request.url.path,
        method=request.method,
        error=str(exc),
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


app.include_router(api_v1_router, prefix=settings.API_V1_PREFIX)


@app.get("/ping", tags=["system"])
async def ping() -> dict:
    """No-auth connectivity test (useful to verify routing without JWT)."""
    return {"pong": True, "cors": "ok"}


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
