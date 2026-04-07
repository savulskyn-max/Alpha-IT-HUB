-- ============================================================
-- ALPHA IT HUB — Setup Completo
-- Pegar todo esto en Supabase → SQL Editor → Run
-- ============================================================

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABLAS

CREATE TABLE IF NOT EXISTS plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  price_monthly NUMERIC(10,2) NOT NULL,
  price_yearly  NUMERIC(10,2),
  max_agents    INT NOT NULL DEFAULT 1,
  max_users     INT NOT NULL DEFAULT 5,
  features      JSONB NOT NULL DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  logo_url        TEXT,
  primary_color   TEXT DEFAULT '#32576F',
  status          TEXT NOT NULL DEFAULT 'trial'
                    CHECK (status IN ('active', 'suspended', 'trial', 'cancelled')),
  plan_id         UUID REFERENCES plans(id) ON DELETE RESTRICT,
  vault_secret_id TEXT,
  settings        JSONB NOT NULL DEFAULT '{}',
  trial_ends_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT,
  avatar_url    TEXT,
  role          TEXT NOT NULL DEFAULT 'staff'
                  CHECK (role IN ('superadmin', 'owner', 'admin', 'manager', 'staff', 'viewer')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id                  UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status                   TEXT NOT NULL DEFAULT 'trialing'
                             CHECK (status IN ('active', 'past_due', 'cancelled', 'trialing', 'paused')),
  billing_cycle            TEXT NOT NULL DEFAULT 'monthly'
                             CHECK (billing_cycle IN ('monthly', 'yearly')),
  payment_provider         TEXT CHECK (payment_provider IN ('stripe', 'mercadopago')),
  external_subscription_id TEXT,
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN DEFAULT FALSE,
  metadata                 JSONB NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS agents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  type           TEXT NOT NULL DEFAULT 'assistant'
                   CHECK (type IN ('assistant', 'analyst', 'recommender', 'notifier', 'custom')),
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'active', 'paused', 'error')),
  graph_config   JSONB NOT NULL DEFAULT '{}',
  llm_config     JSONB NOT NULL DEFAULT '{}',
  trigger_config JSONB NOT NULL DEFAULT '{}',
  last_run_at    TIMESTAMPTZ,
  run_count      INT NOT NULL DEFAULT 0,
  error_log      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_tenant_id ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

CREATE TABLE IF NOT EXISTS agent_runs (
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

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_id ON agent_runs(tenant_id);

CREATE TABLE IF NOT EXISTS notifications (
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

CREATE TABLE IF NOT EXISTS tenant_db_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  host            TEXT NOT NULL,
  database_name   TEXT NOT NULL,
  db_username     TEXT NOT NULL,
  vault_secret_id TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'connected', 'error')),
  last_tested_at  TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. TRIGGERS updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_plans_updated_at') THEN
    CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_tenants_updated_at') THEN
    CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at') THEN
    CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_agents_updated_at') THEN
    CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_tenant_db_configs_updated_at') THEN
    CREATE TRIGGER update_tenant_db_configs_updated_at BEFORE UPDATE ON tenant_db_configs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- 4. ROW LEVEL SECURITY
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_db_configs ENABLE ROW LEVEL SECURITY;

-- Policies (DROP IF EXISTS para poder re-ejecutar)
DO $$ BEGIN
  DROP POLICY IF EXISTS "plans_read" ON plans;
  DROP POLICY IF EXISTS "service_role_plans" ON plans;
  DROP POLICY IF EXISTS "tenant_isolation_tenants" ON tenants;
  DROP POLICY IF EXISTS "service_role_tenants" ON tenants;
  DROP POLICY IF EXISTS "tenant_isolation_users" ON users;
  DROP POLICY IF EXISTS "service_role_users" ON users;
  DROP POLICY IF EXISTS "tenant_isolation_agents" ON agents;
  DROP POLICY IF EXISTS "service_role_agents" ON agents;
  DROP POLICY IF EXISTS "service_role_subscriptions" ON subscriptions;
  DROP POLICY IF EXISTS "service_role_agent_runs" ON agent_runs;
  DROP POLICY IF EXISTS "service_role_notifications" ON notifications;
  DROP POLICY IF EXISTS "service_role_tenant_db_configs" ON tenant_db_configs;
END $$;

CREATE POLICY "plans_read" ON plans FOR SELECT TO authenticated USING (is_active = TRUE);
CREATE POLICY "service_role_plans" ON plans FOR ALL TO service_role USING (TRUE);
CREATE POLICY "tenant_isolation_tenants" ON tenants FOR SELECT TO authenticated USING (id = (auth.jwt() ->> 'tenant_id')::uuid);
CREATE POLICY "service_role_tenants" ON tenants FOR ALL TO service_role USING (TRUE);
CREATE POLICY "tenant_isolation_users" ON users FOR ALL TO authenticated USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
CREATE POLICY "service_role_users" ON users FOR ALL TO service_role USING (TRUE);
CREATE POLICY "tenant_isolation_agents" ON agents FOR ALL TO authenticated USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
CREATE POLICY "service_role_agents" ON agents FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_role_subscriptions" ON subscriptions FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_role_agent_runs" ON agent_runs FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_role_notifications" ON notifications FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_role_tenant_db_configs" ON tenant_db_configs FOR ALL TO service_role USING (TRUE);

-- 5. AUTH HOOK FUNCTION (en schema public — requerido por Supabase hosted)
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims   jsonb;
  user_rec record;
BEGIN
  SELECT tenant_id, role INTO user_rec FROM public.users WHERE id = (event ->> 'user_id')::uuid;
  claims := event -> 'claims';
  -- Always inject user_role if the user exists.
  -- Admin/superadmin users have tenant_id = NULL, so we must NOT gate
  -- the user_role injection on tenant_id being non-null.
  IF FOUND THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_rec.role));
    IF user_rec.tenant_id IS NOT NULL THEN
      claims := jsonb_set(claims, '{tenant_id}', to_jsonb(user_rec.tenant_id::text));
    END IF;
  END IF;
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Permisos necesarios para que el servicio de auth pueda llamar la función
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- 6. SEED: Planes iniciales
INSERT INTO plans (name, display_name, price_monthly, price_yearly, max_agents, max_users, features) VALUES
  ('starter',      'Starter',      49.00,   490.00,  1,  3,  '{"analytics":true,"chat":true,"notifications":true,"export_pdf":false}'),
  ('professional', 'Professional', 149.00, 1490.00,  5,  10, '{"analytics":true,"chat":true,"notifications":true,"export_pdf":true,"agent_config":true}'),
  ('enterprise',   'Enterprise',   399.00, 3990.00, 20,  -1, '{"analytics":true,"chat":true,"notifications":true,"export_pdf":true,"agent_config":true,"custom_agents":true}')
ON CONFLICT (name) DO NOTHING;

-- 7. TENANT DE PRUEBA (Admin / dueño del sistema)
-- Este tenant representa tu cuenta de administrador
INSERT INTO tenants (id, name, slug, status, settings)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Alpha IT Hub Admin',
  'alpha-admin',
  'active',
  '{"is_system_admin": true}'
)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- DESPUÉS DE EJECUTAR ESTE SQL:
--
-- 1. Ir a Authentication → Users → copiar el UUID del usuario que creaste
-- 2. Reemplazar 'TU-UUID-AQUI' y 'tu@email.com' en la query de abajo y ejecutarla:
--
-- INSERT INTO public.users (id, tenant_id, email, full_name, role)
-- VALUES (
--   'TU-UUID-AQUI',
--   NULL,
--   'tu@email.com',
--   'Tu Nombre',
--   'superadmin'   -- ← IMPORTANTE: usar 'superadmin', NO 'owner'
-- );
--
-- NOTA: Si ya ejecutaste este SQL antes con role='owner', ejecuta esto para corregirlo:
-- UPDATE public.users SET role = 'superadmin', tenant_id = NULL WHERE email = 'tu@email.com';
--
-- 3. Ir a Authentication → Hooks → activar "Custom Access Token Hook"
--    → seleccionar: public.custom_access_token_hook
-- ============================================================

-- Si ya tenés la tabla users con el constraint viejo, ejecutá esto para agregar 'superadmin':
-- ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
-- ALTER TABLE public.users ADD CONSTRAINT users_role_check
--   CHECK (role IN ('superadmin', 'owner', 'admin', 'manager', 'staff', 'viewer'));

-- Verificación final
SELECT 'plans' as tabla, count(*) FROM plans
UNION ALL
SELECT 'tenants', count(*) FROM tenants;
