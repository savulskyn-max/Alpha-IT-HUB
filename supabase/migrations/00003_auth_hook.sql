-- ============================================================
-- Alpha IT Hub - Supabase Auth Custom JWT Claims Hook
-- Migration 00003: Inject tenant_id and user_role into JWT
-- ============================================================
-- After applying this migration, enable the hook in Supabase Dashboard:
-- Authentication > Hooks > "Custom Access Token Hook"
-- Set function: public.custom_access_token_hook
-- NOTE: Supabase hosted requires the function in public schema (not auth)
-- ============================================================

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
  -- Look up the user's tenant and role from our users table
  SELECT tenant_id, role
  INTO user_rec
  FROM public.users
  WHERE id = (event ->> 'user_id')::uuid;

  -- Start with the existing claims
  claims := event -> 'claims';

  -- Inject custom claims if the user exists in our table
  IF user_rec.tenant_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(user_rec.tenant_id::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_rec.role));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Grant execute permission to supabase_auth_admin
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- ============================================================
-- Vault helper function
-- ============================================================
-- This function allows the backend to retrieve secrets from Supabase Vault
-- via the REST API. Enable the Vault extension first in the Supabase dashboard.
-- ============================================================

CREATE OR REPLACE FUNCTION vault_get_secret(secret_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  secret_value text;
BEGIN
  SELECT decrypted_secret
  INTO secret_value
  FROM vault.decrypted_secrets
  WHERE id = secret_id::uuid
    AND name IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Secret not found: %', secret_id;
  END IF;

  RETURN secret_value;
END;
$$;

-- Only service_role can call vault_get_secret
REVOKE EXECUTE ON FUNCTION vault_get_secret FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vault_get_secret FROM authenticated;
GRANT EXECUTE ON FUNCTION vault_get_secret TO service_role;
