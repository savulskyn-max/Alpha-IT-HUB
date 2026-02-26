-- ============================================================
-- Alpha IT Hub - Platform Database Schema
-- Migration 00001: Core tables for multi-tenant SaaS platform
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- PLANS
-- ============================================================
CREATE TABLE plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,        -- 'starter', 'professional', 'enterprise'
  display_name  TEXT NOT NULL,
  price_monthly NUMERIC(10,2) NOT NULL,
  price_yearly  NUMERIC(10,2),
  max_agents    INT NOT NULL DEFAULT 1,
  max_users     INT NOT NULL DEFAULT 5,
  features      JSONB NOT NULL DEFAULT '{}', -- feature flags map
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TENANTS
-- ============================================================
CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,      -- URL-safe identifier
  logo_url        TEXT,
  primary_color   TEXT DEFAULT '#32576F',
  status          TEXT NOT NULL DEFAULT 'trial'
                    CHECK (status IN ('active', 'suspended', 'trial', 'cancelled')),
  plan_id         UUID REFERENCES plans(id) ON DELETE RESTRICT,
  vault_secret_id TEXT,                      -- Reference key in Supabase Vault / AKV
  settings        JSONB NOT NULL DEFAULT '{}',
  trial_ends_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_status ON tenants(status);

-- ============================================================
-- USERS (extends Supabase auth.users)
-- ============================================================
CREATE TABLE users (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT,
  avatar_url    TEXT,
  role          TEXT NOT NULL DEFAULT 'staff'
                  CHECK (role IN ('owner', 'admin', 'manager', 'staff', 'viewer')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, email)
);

CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
CREATE TABLE subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id                  UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status                   TEXT NOT NULL DEFAULT 'trialing'
                             CHECK (status IN ('active', 'past_due', 'cancelled', 'trialing', 'paused')),
  billing_cycle            TEXT NOT NULL DEFAULT 'monthly'
                             CHECK (billing_cycle IN ('monthly', 'yearly')),
  payment_provider         TEXT CHECK (payment_provider IN ('stripe', 'mercadopago')),
  external_subscription_id TEXT,            -- Stripe/MercadoPago subscription ID
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN DEFAULT FALSE,
  metadata                 JSONB NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id)
);

CREATE INDEX idx_subscriptions_tenant_id ON subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- ============================================================
-- AGENTS
-- ============================================================
CREATE TABLE agents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  type           TEXT NOT NULL DEFAULT 'assistant'
                   CHECK (type IN ('assistant', 'analyst', 'recommender', 'notifier', 'custom')),
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'active', 'paused', 'error')),
  graph_config   JSONB NOT NULL DEFAULT '{}', -- LangGraph node/edge definition
  llm_config     JSONB NOT NULL DEFAULT '{}', -- model, temperature, system_prompt, tools[]
  trigger_config JSONB NOT NULL DEFAULT '{}', -- schedule, webhook, event triggers
  last_run_at    TIMESTAMPTZ,
  run_count      INT NOT NULL DEFAULT 0,
  error_log      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agents_tenant_id ON agents(tenant_id);
CREATE INDEX idx_agents_status ON agents(status);

-- ============================================================
-- AGENT RUNS
-- ============================================================
CREATE TABLE agent_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  triggered_by  TEXT DEFAULT 'manual'
                  CHECK (triggered_by IN ('manual', 'schedule', 'webhook', 'event')),
  status        TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'success', 'failed', 'cancelled')),
  input         JSONB,
  output        JSONB,
  error         TEXT,
  duration_ms   INT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_agent_runs_agent_id ON agent_runs(agent_id);
CREATE INDEX idx_agent_runs_tenant_id ON agent_runs(tenant_id);
CREATE INDEX idx_agent_runs_started_at ON agent_runs(started_at DESC);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  agent_id   UUID REFERENCES agents(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  urgency    TEXT NOT NULL DEFAULT 'informative'
               CHECK (urgency IN ('informative', 'action_required', 'critical')),
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_tenant_id ON notifications(tenant_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(read) WHERE NOT read;

-- ============================================================
-- TENANT DB CONFIGS (Azure SQL connection info per tenant)
-- ============================================================
CREATE TABLE tenant_db_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  host            TEXT NOT NULL,
  database_name   TEXT NOT NULL,
  db_username     TEXT NOT NULL,
  vault_secret_id TEXT NOT NULL, -- Key in Supabase Vault / AKV storing the full connection string
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'connected', 'error')),
  last_tested_at  TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- UPDATED_AT triggers
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenant_db_configs_updated_at
  BEFORE UPDATE ON tenant_db_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
