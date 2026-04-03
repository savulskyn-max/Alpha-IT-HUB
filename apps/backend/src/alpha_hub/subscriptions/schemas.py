"""
Pydantic schemas for subscription endpoints.
"""
from datetime import datetime

from pydantic import BaseModel


class SubscriptionResponse(BaseModel):
    id: str
    tenant_id: str
    tenant_name: str
    plan_id: str | None
    plan_name: str | None
    status: str
    billing_cycle: str | None
    payment_provider: str | None
    current_period_end: datetime | None
    cancel_at_period_end: bool | None
    cancelled_at: datetime | None
    created_at: datetime | None

    model_config = {"from_attributes": True}


class SubscriptionListResponse(BaseModel):
    items: list[SubscriptionResponse]
    total: int


class SubscriptionUpdate(BaseModel):
    status: str | None = None
    plan_id: str | None = None
    billing_cycle: str | None = None
    cancel_at_period_end: bool | None = None
