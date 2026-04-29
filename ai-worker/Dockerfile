# ---- Build stage ----
FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential default-jre-headless && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- Production stage ----
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m -r appuser
WORKDIR /app

COPY --from=builder /install /usr/local
COPY . .

RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:' + __import__('os').getenv('PORT','8000') + '/')" || exit 1

# IMPORTANT: Use a single worker so that FastAPI BackgroundTasks (used by
# process_book_background / retry-book) always run in the same process that
# handled the HTTP request. With multiple workers, the OS can schedule the
# request and the background task to different processes, and Cloud Run may
# recycle the worker process before the pipeline completes, leaving the book
# stuck in "processing" forever. Horizontal scaling is handled by Cloud Run
# min/max-instances at the infra level.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --timeout-keep-alive 300"]
