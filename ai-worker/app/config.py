"""Centralized configuration using Pydantic Settings."""

import os
from functools import lru_cache
from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Environment
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"

    # GCP / Vertex AI
    GCP_PROJECT_ID: str = "caliopebot-dad29"
    GCP_LOCATION: str = "us-central1"
    FIREBASE_SERVICE_ACCOUNT_PATH: str = ""

    # API
    API_RATE_LIMIT: int = 100  # requests per minute per user
    MAX_CHUNKS_PER_BATCH: int = 5  # chunks to process per background job
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "https://caliopebot-dad29.web.app",
        "https://caliopebot-dad29.firebaseapp.com",
    ]

    # Vector DB (ChromaDB)
    CHROMA_PERSIST_DIR: str = "./chroma_data"
    CHROMA_HOST: str = "localhost"
    CHROMA_PORT: int = 8001

    # LLM
    LLM_MODEL: str = "gemini-2.5-flash"
    LLM_MAX_RETRIES: int = 3
    LLM_RETRY_MIN_WAIT: float = 2.0
    LLM_RETRY_MAX_WAIT: float = 10.0

    # Cost tracking (USD per 1M tokens, approximate)
    COST_PER_1M_INPUT_TOKENS: float = 0.15
    COST_PER_1M_OUTPUT_TOKENS: float = 0.60

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT == "development"


@lru_cache()
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
