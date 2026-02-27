from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str | None
    phone: str | None
    avatar_url: str | None
    role: str
    tenant_id: str | None
    created_at: datetime | None

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    role: str = "staff"
    tenant_id: str | None = None
    phone: str | None = None
    # Password is optional — if not provided, an invite email is sent
    password: str | None = None


class UserUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    avatar_url: str | None = None
    # Only admins can change role/tenant
    role: str | None = None
    tenant_id: str | None = None


class UserListResponse(BaseModel):
    items: list[UserResponse]
    total: int
