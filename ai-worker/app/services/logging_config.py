"""Structured JSON logging for Cloud Run / Cloud Logging."""

import logging
import sys
import time
import uuid
from contextvars import ContextVar
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

# Context variables for request-scoped logging
request_id_var: ContextVar[str] = ContextVar("request_id", default="")
user_id_var: ContextVar[str] = ContextVar("user_id", default="")
org_id_var: ContextVar[str] = ContextVar("org_id", default="")


class JSONFormatter(logging.Formatter):
    """JSON log formatter compatible with Google Cloud Logging."""

    def format(self, record: logging.LogRecord) -> str:
        import json

        log_entry = {
            "severity": record.levelname,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "timestamp": self.formatTime(record),
        }
        # Add context vars if available
        rid = request_id_var.get("")
        if rid:
            log_entry["request_id"] = rid
        uid = user_id_var.get("")
        if uid:
            log_entry["user_id"] = uid
        oid = org_id_var.get("")
        if oid:
            log_entry["org_id"] = oid

        if record.exc_info and record.exc_info[1]:
            log_entry["error"] = str(record.exc_info[1])

        return json.dumps(log_entry, ensure_ascii=False)


def setup_logging(level: str = "INFO", json_format: bool = True):
    """Configure application logging."""
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    handler = logging.StreamHandler(sys.stdout)
    if json_format:
        handler.setFormatter(JSONFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
        )

    root.handlers = [handler]


class RequestTimingMiddleware(BaseHTTPMiddleware):
    """Middleware that logs request timing and sets context vars."""

    async def dispatch(self, request: Request, call_next):
        rid = str(uuid.uuid4())[:8]
        request_id_var.set(rid)

        start = time.time()
        response = await call_next(request)
        duration_ms = (time.time() - start) * 1000

        logger = logging.getLogger("http")
        logger.info(
            f"{request.method} {request.url.path} → {response.status_code} ({duration_ms:.0f}ms)"
        )
        response.headers["X-Request-ID"] = rid
        return response
