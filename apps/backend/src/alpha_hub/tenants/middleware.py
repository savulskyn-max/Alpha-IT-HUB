"""
TenantMiddleware: adds structured logging context per request.
Actual tenant resolution happens in FastAPI dependencies (dependencies.py)
where the JWT is decoded and tenant_id is extracted from claims.
"""
import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = structlog.get_logger()

# Paths that don't need tenant context
EXEMPT_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}


class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: object) -> Response:
        structlog.contextvars.clear_contextvars()

        if request.url.path not in EXEMPT_PATHS:
            structlog.contextvars.bind_contextvars(
                path=request.url.path,
                method=request.method,
            )
            logger.info(
                "Incoming request",
                method=request.method,
                path=request.url.path,
                origin=request.headers.get("origin", "-"),
            )

        try:
            response = await call_next(request)  # type: ignore[operator]
            if request.url.path not in EXEMPT_PATHS:
                logger.info("Request complete", status=response.status_code)
        except Exception as exc:
            logger.error("Unhandled exception in middleware", error=str(exc), exc_info=True)
            raise

        structlog.contextvars.clear_contextvars()
        return response  # type: ignore[return-value]
