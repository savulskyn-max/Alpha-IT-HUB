-- ============================================================
-- Migration 00004: Add superadmin role, phone column, azure_local_id
-- ============================================================

-- 1. Expand the role CHECK constraint to include 'superadmin'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin', 'owner', 'admin', 'manager', 'staff', 'viewer'));

-- 2. Add phone column (exists in ORM but was missing from initial migration)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- 3. Add azure_local_id — references the LocalID in the tenant's Azure SQL database
ALTER TABLE users ADD COLUMN IF NOT EXISTS azure_local_id INTEGER;
