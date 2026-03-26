from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

import structlog
from fastapi import FastAPI
from fastapi.requests import Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, DataError, IntegrityError

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

        # Validate SERVICE_ROLE_KEY early so we get a clear error at startup
        srk = settings.SUPABASE_SERVICE_ROLE_KEY
        if not srk or srk in ("your-service-role-key-here", ""):
            logger.warning(
                "SUPABASE_SERVICE_ROLE_KEY is empty or placeholder — "
                "admin user operations will fail with 401"
            )
        elif srk == settings.SUPABASE_ANON_KEY:
            logger.error(
                "SUPABASE_SERVICE_ROLE_KEY has the same value as SUPABASE_ANON_KEY — "
                "this will cause 401 errors on the Admin API. "
                "Set the correct service_role key from Supabase Dashboard > Settings > API."
            )

        logger.info(
            "CORS configured (TenantMiddleware)",
            cors_origins=settings.cors_origins,
            cors_origin_regex=settings.CORS_ORIGIN_REGEX,
        )
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

# TenantMiddleware is the only middleware.
# It handles CORS (preflight short-circuit + response header injection)
# AND structured request logging. Single-middleware stack → zero nesting bugs.
app.add_middleware(TenantMiddleware)


app.include_router(api_v1_router, prefix=settings.API_V1_PREFIX)


def _db_error_payload(detail: str, status_code: int) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail},
    )


@app.exception_handler(RuntimeError)
async def handle_runtime_error(_: Request, exc: RuntimeError) -> JSONResponse:
    msg = str(exc)
    logger.error("Runtime error", error=msg)
    if "Platform DB not initialized" in msg or "init_platform_db" in msg:
        return _db_error_payload(
            "Database not available. Set DATABASE_URL in Railway environment variables.",
            503,
        )
    return _db_error_payload("Internal server error.", 500)


@app.exception_handler(IntegrityError)
async def handle_integrity_error(_: Request, exc: IntegrityError) -> JSONResponse:
    msg = str(getattr(exc, "orig", exc))
    logger.warning("Integrity error", error=msg)

    lowered = msg.lower()
    if "unique" in lowered or "duplicate key" in lowered:
        return _db_error_payload("Duplicate value violates a unique constraint.", 409)
    if "foreign key" in lowered:
        return _db_error_payload("Referenced resource does not exist.", 400)
    if "check constraint" in lowered:
        return _db_error_payload("Invalid field value for database constraints.", 400)

    return _db_error_payload("Database integrity error.", 400)


@app.exception_handler(DataError)
async def handle_data_error(_: Request, exc: DataError) -> JSONResponse:
    msg = str(getattr(exc, "orig", exc))
    logger.warning("Data error", error=msg)
    return _db_error_payload("Invalid data format or value.", 400)


@app.exception_handler(DBAPIError)
async def handle_dbapi_error(_: Request, exc: DBAPIError) -> JSONResponse:
    msg = str(getattr(exc, "orig", exc))
    logger.error("Unhandled DBAPI error", error=msg)
    return _db_error_payload("Database operation failed.", 500)


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


@app.get("/debug/test-supabase", tags=["system"])
async def debug_test_supabase() -> dict:
    """
    Temporary — makes a real call to Supabase Admin API to diagnose 401.
    DELETE THIS ENDPOINT after debugging.
    """
    import httpx

    srk = settings.SUPABASE_SERVICE_ROLE_KEY
    url = f"{settings.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1"
    headers = {
        "apikey": srk,
        "Authorization": f"Bearer {srk}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, headers=headers, timeout=10.0)
            return {
                "status_code": resp.status_code,
                "ok": resp.is_success,
                "body_preview": resp.text[:500],
                "request_url": url,
                "auth_header_preview": f"Bearer {srk[:8]}...{srk[-4:]}",
            }
    except Exception as e:
        return {"error": str(e)}


@app.get("/debug/keys", tags=["system"])
async def debug_keys() -> dict:
    """
    Temporary diagnostic endpoint — shows first/last 4 chars of each key
    so we can verify Railway has the correct values without exposing secrets.
    DELETE THIS ENDPOINT after debugging.
    """
    srk = settings.SUPABASE_SERVICE_ROLE_KEY
    anon = settings.SUPABASE_ANON_KEY
    url = settings.SUPABASE_URL

    def mask(key: str) -> str:
        if not key:
            return "(EMPTY)"
        if len(key) < 10:
            return f"(TOO SHORT, len={len(key)})"
        return f"{key[:4]}...{key[-4:]} (len={len(key)})"

    return {
        "supabase_url": url,
        "anon_key": mask(anon),
        "service_role_key": mask(srk),
        "keys_are_same": srk == anon,
        "srk_starts_with_eyJ": srk.startswith("eyJ") if srk else False,
    }
