-- ─────────────────────────────────────────────────────────────────────────────
-- 00004_vault_helpers.sql
-- Public wrapper functions so the backend can call Supabase Vault via REST API
-- ─────────────────────────────────────────────────────────────────────────────

-- Requires the Vault extension (enabled by default in Supabase):
-- CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- Retrieves the decrypted value of a secret by its UUID.
CREATE OR REPLACE FUNCTION public.vault_get_secret(
    secret_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    v_secret TEXT;
BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE id = secret_id;
    RETURN v_secret;
END;
$$;

-- Creates a new secret in the Vault. Returns the secret UUID.
CREATE OR REPLACE FUNCTION public.vault_create_secret(
    p_secret      TEXT,
    p_name        TEXT        DEFAULT NULL,
    p_description TEXT        DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    v_id UUID;
BEGIN
    SELECT vault.create_secret(p_secret, p_name, p_description) INTO v_id;
    RETURN v_id;
END;
$$;

-- Updates the value of an existing secret.
CREATE OR REPLACE FUNCTION public.vault_update_secret(
    p_secret_id UUID,
    p_secret    TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
    UPDATE vault.secrets
       SET secret      = vault.encrypt(p_secret::bytea, key_id, 'aes-gcm'),
           updated_at  = now()
     WHERE id = p_secret_id;
END;
$$;

-- Deletes a secret by UUID.
CREATE OR REPLACE FUNCTION public.vault_delete_secret(
    p_secret_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
    DELETE FROM vault.secrets WHERE id = p_secret_id;
END;
$$;

-- Grant execute to service_role (used by the backend)
GRANT EXECUTE ON FUNCTION public.vault_get_secret TO service_role;
GRANT EXECUTE ON FUNCTION public.vault_create_secret TO service_role;
GRANT EXECUTE ON FUNCTION public.vault_update_secret TO service_role;
GRANT EXECUTE ON FUNCTION public.vault_delete_secret TO service_role;
