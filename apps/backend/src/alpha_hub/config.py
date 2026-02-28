import json
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    APP_ENV: str = "development"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    FRONTEND_URL: str = ""
    CORS_ORIGIN_REGEX: str = r"^https://.*\.vercel\.app$"
    ALLOWED_ORIGINS: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://localhost:8081",
            "exp://localhost:8081",
        ]
    )

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

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, value: object) -> bool | object:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "on", "debug", "dev", "development"}:
                return True
            if normalized in {"0", "false", "no", "off", "release", "prod", "production"}:
                return False
        return value

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_allowed_origins(cls, value: object) -> list[str] | object:
        if isinstance(value, list):
            return [str(origin).strip().rstrip("/") for origin in value if str(origin).strip()]

        if isinstance(value, str):
            raw_value = value.strip()
            if not raw_value:
                return []

            # Accept JSON list (e.g. '["https://a.com","https://b.com"]')
            if raw_value.startswith("["):
                try:
                    parsed = json.loads(raw_value)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, list):
                    return [
                        str(origin).strip().rstrip("/")
                        for origin in parsed
                        if str(origin).strip()
                    ]

            # Accept comma-separated list (e.g. 'https://a.com,https://b.com')
            return [origin.strip().rstrip("/") for origin in raw_value.split(",") if origin.strip()]

        return value

    @property
    def cors_origins(self) -> list[str]:
        origins = [origin for origin in self.ALLOWED_ORIGINS]
        if self.FRONTEND_URL.strip():
            origins.append(self.FRONTEND_URL)

        unique_origins: list[str] = []
        seen: set[str] = set()
        for origin in origins:
            normalized = origin.strip().rstrip("/")
            if normalized and normalized not in seen:
                seen.add(normalized)
                unique_origins.append(normalized)

        return unique_origins

    @property
    def CORS_ORIGINS(self) -> list[str]:
        return self.cors_origins


@lru_cache
def get_settings() -> Settings:
    return Settings()
