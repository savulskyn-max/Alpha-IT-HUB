"""
TenantMiddleware: pure ASGI middleware that handles CORS and structured
logging context per request.

Combining CORS + logging in one pure ASGI class eliminates middleware
interaction issues entirely — this is the only middleware, so there is
no nesting problem.

CORS handling:
  - OPTIONS preflight → short-circuited immediately (never reaches routes)
  - All other requests with Origin → CORS headers injected into response
"""
import structlog
from starlette.types import ASGIApp, Receive, Scope, Send

logger = structlog.get_logger()

# Paths that don't need tenant context / logging
EXEMPT_PATHS = {"/health", "/ping", "/docs", "/openapi.json", "/redoc"}

_CORS_HEADERS: list[tuple[bytes, bytes]] = [
    (b"access-control-allow-origin", b"*"),
    (b"access-control-allow-methods", b"GET, POST, PUT, DELETE, PATCH, OPTIONS"),
    (b"access-control-allow-headers", b"*"),
    (b"access-control-max-age", b"600"),
]


class TenantMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        method: str = scope.get("method", "")
        raw_headers: list[tuple[bytes, bytes]] = scope.get("headers", [])

        # Detect cross-origin request
        origin: str | None = next(
            (v.decode() for k, v in raw_headers if k == b"origin"), None
        )

        # Short-circuit CORS preflight — never reaches route handlers
        if method == "OPTIONS" and origin is not None:
            has_acrm = any(k == b"access-control-request-method" for k, v in raw_headers)
            if has_acrm:
                await send({
                    "type": "http.response.start",
                    "status": 200,
                    "headers": _CORS_HEADERS + [(b"content-length", b"0")],
                })
                await send({"type": "http.response.body", "body": b""})
                return

        if path not in EXEMPT_PATHS:
            structlog.contextvars.clear_contextvars()
            structlog.contextvars.bind_contextvars(path=path, method=method)
            logger.info("Incoming request", method=method, path=path, origin=origin or "-")

        # Wrap send to inject CORS headers into every response when Origin is present
        async def send_with_cors(message: dict) -> None:
            if message["type"] == "http.response.start" and origin is not None:
                headers = list(message.get("headers", []))
                headers.extend(_CORS_HEADERS)
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_cors)
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
