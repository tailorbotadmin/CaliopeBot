"""Firebase authentication middleware and rate limiting."""

import time
import logging
from functools import wraps
from typing import Optional
from collections import defaultdict

from fastapi import Request, HTTPException
from firebase_admin import auth as firebase_auth

logger = logging.getLogger(__name__)


class TokenBucketRateLimiter:
    """Simple in-memory token bucket rate limiter."""

    def __init__(self, requests_per_minute: int = 100):
        self.rpm = requests_per_minute
        self._buckets: dict[str, dict] = defaultdict(
            lambda: {"tokens": requests_per_minute, "last_refill": time.time()}
        )

    def is_allowed(self, user_id: str) -> bool:
        bucket = self._buckets[user_id]
        now = time.time()
        elapsed = now - bucket["last_refill"]
        bucket["tokens"] = min(
            self.rpm, bucket["tokens"] + elapsed * (self.rpm / 60.0)
        )
        bucket["last_refill"] = now

        if bucket["tokens"] >= 1:
            bucket["tokens"] -= 1
            return True
        return False

    def remaining(self, user_id: str) -> int:
        return int(self._buckets[user_id]["tokens"])


# Global rate limiter instance
rate_limiter = TokenBucketRateLimiter()


async def verify_firebase_token(request: Request) -> Optional[dict]:
    """Verify Firebase ID token from Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header.split("Bearer ")[1]
    try:
        decoded = firebase_auth.verify_id_token(token)
        return {
            "uid": decoded["uid"],
            "email": decoded.get("email"),
            "role": decoded.get("role", "Autor"),
            "organizationId": decoded.get("organizationId"),
        }
    except Exception as e:
        logger.warning(f"Token verification failed: {e}")
        return None


def require_auth(roles: list[str] | None = None):
    """Decorator to require authentication and optionally specific roles."""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, request: Request, **kwargs):
            user = await verify_firebase_token(request)
            if not user:
                raise HTTPException(status_code=401, detail="Authentication required")

            if not rate_limiter.is_allowed(user["uid"]):
                raise HTTPException(status_code=429, detail="Rate limit exceeded")

            if roles and user["role"] not in roles:
                raise HTTPException(status_code=403, detail="Insufficient permissions")

            request.state.user = user
            return await func(*args, request=request, **kwargs)

        return wrapper

    return decorator
