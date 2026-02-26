from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    APP_ENV: str = "development"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:8081",
        "exp://localhost:8081",
    ]

    # Supabase (Platform DB)
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_JWT_SECRET: str = ""

    # Platform Postgres (direct connection via asyncpg for SQLAlchemy)
    DATABASE_URL: str = ""  # postgresql+asyncpg://user:pass@host:5432/postgres

    # Azure Key Vault (optional, falls back to Supabase Vault)
    AZURE_KEY_VAULT_URL: str = ""
    AZURE_CLIENT_ID: str = ""
    AZURE_CLIENT_SECRET: str = ""
    AZURE_TENANT_ID_AAD: str = ""

    # Security
    SECRET_KEY: str = "dev-secret-change-in-production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
