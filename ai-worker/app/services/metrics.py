"""Prometheus metrics for observability."""

import time
import logging
from functools import wraps
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)

# HTTP metrics
HTTP_REQUESTS = Counter(
    "http_requests_total", "Total HTTP requests", ["method", "endpoint", "status"]
)
HTTP_LATENCY = Histogram(
    "http_request_duration_seconds", "HTTP request latency", ["method", "endpoint"]
)

# LLM metrics
LLM_CALLS = Counter("llm_calls_total", "Total LLM API calls", ["agent", "model"])
LLM_ERRORS = Counter("llm_errors_total", "Total LLM API errors", ["agent", "model"])
LLM_LATENCY = Histogram(
    "llm_call_duration_seconds", "LLM call latency", ["agent", "model"]
)
LLM_TOKENS = Counter(
    "llm_tokens_total", "Total LLM tokens used", ["agent", "direction"]
)
LLM_COST = Counter("llm_cost_usd_total", "Estimated LLM cost in USD", ["agent"])

# Correction metrics
CORRECTIONS_PROCESSED = Counter("corrections_processed_total", "Total corrections processed")
SUGGESTIONS_ACCEPTED = Counter("suggestions_accepted_total", "Suggestions accepted by editors")
SUGGESTIONS_REJECTED = Counter("suggestions_rejected_total", "Suggestions rejected by editors")

# Vector store metrics
VECTOR_QUERIES = Counter("vector_queries_total", "Vector store queries", ["collection_type"])

# Active processing
ACTIVE_JOBS = Gauge("active_background_jobs", "Currently processing background jobs")


def track_llm_call(agent_name: str, model: str = "gemini-2.5-flash"):
    """Decorator to track LLM call metrics."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            LLM_CALLS.labels(agent=agent_name, model=model).inc()
            start = time.time()
            try:
                result = func(*args, **kwargs)
                duration = time.time() - start
                LLM_LATENCY.labels(agent=agent_name, model=model).observe(duration)
                return result
            except Exception as e:
                LLM_ERRORS.labels(agent=agent_name, model=model).inc()
                raise
        return wrapper
    return decorator


async def metrics_endpoint(request: Request) -> Response:
    """Endpoint to expose Prometheus metrics."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
