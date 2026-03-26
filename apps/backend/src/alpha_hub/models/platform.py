"""
SQLAlchemy ORM models for the platform database (Supabase/PostgreSQL).
Maps to the tables defined in supabase/migrations/00001_platform_schema.sql
"""
import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from ..database.platform import Base


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(sa.String, nullable=False)
    price_usd: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False)
    max_agents: Mapped[int | None] = mapped_column(sa.Integer)
    features: Mapped[dict | None] = mapped_column(sa.JSON)
    created_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(sa.String, nullable=False)
    slug: Mapped[str] = mapped_column(sa.String, unique=True, nullable=False)
    plan_id: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid, sa.ForeignKey("plans.id"))
    status: Mapped[str] = mapped_column(sa.String, default="trial")
    created_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))


class User(Base):
    """
    Platform user profile. id == auth.users.id (Supabase Auth).
    role: superadmin, admin (Alpha IT Hub internal) | owner, manager, staff (tenant users)
    tenant_id is NULL for Alpha IT Hub internal admins.
    """
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid, sa.ForeignKey("tenants.id"), nullable=True
    )
    role: Mapped[str] = mapped_column(sa.String, default="staff")
    full_name: Mapped[str | None] = mapped_column(sa.String)
    email: Mapped[str] = mapped_column(sa.String, nullable=False)
    phone: Mapped[str | None] = mapped_column(sa.String)
    avatar_url: Mapped[str | None] = mapped_column(sa.String)
    azure_local_id: Mapped[int | None] = mapped_column(sa.Integer)
    created_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))


class TenantDbConfig(Base):
    """Azure SQL connection config per tenant. Password is stored in Supabase Vault."""
    __tablename__ = "tenant_db_configs"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid, sa.ForeignKey("tenants.id"), unique=True, nullable=False
    )
    host: Mapped[str] = mapped_column(sa.String, nullable=False)
    database_name: Mapped[str] = mapped_column(sa.String, nullable=False)
    db_username: Mapped[str] = mapped_column(sa.String, nullable=False)
    # UUID pointing to the secret in Supabase Vault (stores the full connection string)
    vault_secret_id: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid)
    status: Mapped[str] = mapped_column(sa.String, default="unconfigured")
    last_tested_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid, sa.ForeignKey("tenants.id"), nullable=False
    )
    plan_id: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid, sa.ForeignKey("plans.id"))
    status: Mapped[str] = mapped_column(sa.String, nullable=False)
    stripe_subscription_id: Mapped[str | None] = mapped_column(sa.String)
    mp_subscription_id: Mapped[str | None] = mapped_column(sa.String)
    current_period_end: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
