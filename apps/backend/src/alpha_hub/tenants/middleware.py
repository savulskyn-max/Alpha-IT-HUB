"""
TenantMiddleware: pure ASGI middleware for structured logging context per request.
Using pure ASGI instead of BaseHTTPMiddleware avoids the known Starlette bug
where BaseHTTPMiddleware breaks the ASGI interface when nested inside another
middleware (e.g. CORSMiddleware). BaseHTTPMiddleware must always be outermost;
since CORSMiddleware must be outermost for correct preflight handling, we convert
TenantMiddleware to pure ASGI so both constraints can coexist.
"""
import structlog
from starlette.types import ASGIApp, Receive, Scope, Send

logger = structlog.get_logger()

# Paths that don't need tenant context / logging
EXEMPT_PATHS = {"/health", "/ping", "/docs", "/openapi.json", "/redoc"}


class TenantMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        method: str = scope.get("method", "")

        if path not in EXEMPT_PATHS:
            raw_headers: list[tuple[bytes, bytes]] = scope.get("headers", [])
            origin = next(
                (v.decode() for k, v in raw_headers if k == b"origin"),
                "-",
            )
            structlog.contextvars.clear_contextvars()
            structlog.contextvars.bind_contextvars(path=path, method=method)
            logger.info("Incoming request", method=method, path=path, origin=origin)

        try:
            await self.app(scope, receive, send)
            if path not in EXEMPT_PATHS:
                logger.info("Request forwarded")
        except Exception as exc:
            logger.error(
                "Unhandled exception in ASGI middleware",
                error=str(exc),
                exc_info=True,
            )
            raise
        finally:
            if path not in EXEMPT_PATHS:
                structlog.contextvars.clear_contextvars()
