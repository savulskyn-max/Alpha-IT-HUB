from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr


class UserResponse(BaseModel):
    id: UUID
    email: str
    full_name: str | None
    phone: str | None
    avatar_url: str | None
    role: str
    tenant_id: UUID | None
    created_at: datetime | None

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    role: str = "staff"
    tenant_id: str | None = None
    phone: str | None = None
    password: str | None = None


class UserUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    avatar_url: str | None = None
    role: str | None = None
    tenant_id: str | None = None


class UserListResponse(BaseModel):
    items: list[UserResponse]
    total: int
