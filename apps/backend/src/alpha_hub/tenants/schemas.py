from pydantic import BaseModel


class TenantInfo(BaseModel):
    id: str
    name: str
    slug: str
    status: str
    plan_id: str | None
    settings: dict
