from pydantic import BaseModel


class TokenVerifyRequest(BaseModel):
    token: str


class TokenVerifyResponse(BaseModel):
    valid: bool
    user_id: str
    tenant_id: str | None
    role: str
    expires_at: int


class AuthMeResponse(BaseModel):
    id: str
    email: str
    full_name: str | None
    avatar_url: str | None
    role: str
    tenant_id: str
    tenant_name: str
    tenant_slug: str


class LogoutResponse(BaseModel):
    ok: bool
