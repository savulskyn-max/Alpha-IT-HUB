from datetime import datetime

from pydantic import BaseModel


class AzureDbConfigCreate(BaseModel):
    host: str
    database_name: str
    db_username: str
    password: str


class AzureDbConfigResponse(BaseModel):
    id: str
    tenant_id: str
    host: str
    database_name: str
    db_username: str
    status: str
    last_tested_at: datetime | None
    created_at: datetime | None
    updated_at: datetime | None

    model_config = {"from_attributes": True}


class AzureDbTestResult(BaseModel):
    success: bool
    latency_ms: int | None = None
    error: str | None = None
