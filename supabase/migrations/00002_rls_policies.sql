-- ============================================================
-- Alpha IT Hub - Row Level Security Policies
-- Migration 00002: Tenant isolation via RLS
-- ============================================================

-- Enable RLS on all tenant-scoped tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_db_configs ENABLE ROW LEVEL SECURITY;

-- Plans are public read-only for authenticated users
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans_read_for_authenticated"
  ON plans FOR SELECT
  TO authenticated
  USING (is_active = TRUE);

-- Tenants: users can only see their own tenant
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_tenants"
  ON tenants FOR SELECT
  TO authenticated
  USING (id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Admins (service_role) can access all tenants
CREATE POLICY "service_role_full_access_tenants"
  ON tenants FOR ALL
  TO service_role
  USING (TRUE);

-- Users: see only members of their tenant
CREATE POLICY "tenant_isolation_users"
  ON users FOR ALL
  TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "service_role_full_access_users"
  ON users FOR ALL
  TO service_role
  USING (TRUE);

-- Agents: see only agents of their tenant
CREATE POLICY "tenant_isolation_agents"
  ON agents FOR ALL
  TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "service_role_full_access_agents"
  ON agents FOR ALL
  TO service_role
  USING (TRUE);

-- Agent runs: see only runs of their tenant
CREATE POLICY "tenant_isolation_agent_runs"
  ON agent_runs FOR ALL
  TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY "service_role_full_access_agent_runs"
  ON agent_runs FOR ALL
  TO service_role
  USING (TRUE);

-- Subscriptions: see only their tenant's subscription
CREATE POLICY "tenant_isolation_subscriptions"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Only service_role can modify subscriptions (webhooks handle this)
CREATE POLICY "service_role_full_access_subscriptions"
  ON subscriptions FOR ALL
  TO service_role
  USING (TRUE);

-- Notifications: see only their own notifications
CREATE POLICY "tenant_isolation_notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND (user_id = auth.uid() OR user_id IS NULL)
  );

CREATE POLICY "notifications_mark_read"
  ON notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "service_role_full_access_notifications"
  ON notifications FOR ALL
  TO service_role
  USING (TRUE);

-- Tenant DB configs: owners and admins only
CREATE POLICY "tenant_db_config_owner_admin"
  ON tenant_db_configs FOR SELECT
  TO authenticated
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND (auth.jwt() ->> 'user_role') IN ('owner', 'admin')
  );

CREATE POLICY "service_role_full_access_tenant_db_configs"
  ON tenant_db_configs FOR ALL
  TO service_role
  USING (TRUE);
