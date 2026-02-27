FROM python:3.11-slim

# Copy uv binary from official image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Install dependencies first (layer cache)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy source code
COPY src/ ./src/

ENV PYTHONPATH=/app/src

EXPOSE 8000

CMD ["sh", "-c", "uv run uvicorn alpha_hub.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
