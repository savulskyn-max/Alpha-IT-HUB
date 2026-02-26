-- ============================================================
-- Alpha IT Hub - Seed Data
-- Run after migrations to populate initial plans
-- ============================================================

INSERT INTO plans (name, display_name, price_monthly, price_yearly, max_agents, max_users, features)
VALUES
  (
    'starter',
    'Starter',
    49.00,
    490.00,
    1,
    3,
    '{"analytics": true, "chat": true, "notifications": true, "export_pdf": false, "multi_user": false}'
  ),
  (
    'professional',
    'Professional',
    149.00,
    1490.00,
    5,
    10,
    '{"analytics": true, "chat": true, "notifications": true, "export_pdf": true, "multi_user": true, "agent_config": true}'
  ),
  (
    'enterprise',
    'Enterprise',
    399.00,
    3990.00,
    20,
    -1,
    '{"analytics": true, "chat": true, "notifications": true, "export_pdf": true, "multi_user": true, "agent_config": true, "custom_agents": true, "api_access": true, "sso": true}'
  )
ON CONFLICT (name) DO NOTHING;
