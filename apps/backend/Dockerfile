FROM python:3.11-slim

# Copy uv binary from official image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install Microsoft ODBC Driver 18 for SQL Server (required by aioodbc)
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        gnupg \
    && curl https://packages.microsoft.com/keys/microsoft.asc \
        | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && curl "https://packages.microsoft.com/config/debian/$(. /etc/os-release && echo "$VERSION_ID")/prod.list" \
        -o /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends \
        msodbcsql18 \
        unixodbc-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (layer cache)
COPY apps/backend/pyproject.toml apps/backend/uv.lock ./
RUN uv sync --frozen --no-dev

# Copy source code
COPY apps/backend/src/ ./src/

ENV PYTHONPATH=/app/src
ENV VIRTUAL_ENV=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

CMD ["sh", "-c", "uvicorn alpha_hub.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
