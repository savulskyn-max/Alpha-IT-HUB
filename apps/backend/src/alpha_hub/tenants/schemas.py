from datetime import datetime

from pydantic import BaseModel


class TenantInfo(BaseModel):
    id: str
    name: str
    slug: str
    status: str
    plan_id: str | None
    settings: dict


class TenantCreate(BaseModel):
    name: str
    slug: str
    plan_id: str | None = None
    status: str = "trial"


class TenantUpdate(BaseModel):
    name: str | None = None
    plan_id: str | None = None
    status: str | None = None


class TenantDetail(BaseModel):
    id: str
    name: str
    slug: str
    status: str
    plan_id: str | None
    plan_name: str | None
    user_count: int
    db_status: str | None
    created_at: datetime | None

    model_config = {"from_attributes": True}


class TenantListResponse(BaseModel):
    items: list[TenantDetail]
    total: int
