-- ============================================================
-- Alpha IT Hub - Fix auth hook to always inject user_role
-- Migration 00004: user_role must be injected even for internal
-- admins who have tenant_id = NULL
-- ============================================================
-- After applying, the hook will:
-- 1. Always inject user_role if the user exists in public.users
-- 2. Only inject tenant_id if it is not null
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

  -- Always inject user_role if the user exists in our table
  IF user_rec IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_rec.role));

    -- Only inject tenant_id if it is not null
    IF user_rec.tenant_id IS NOT NULL THEN
      claims := jsonb_set(claims, '{tenant_id}', to_jsonb(user_rec.tenant_id::text));
    END IF;
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;
