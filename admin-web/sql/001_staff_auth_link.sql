-- CLT Tenant Hub — Web Admin: link Supabase Auth users to staff_users
-- ============================================================================
-- Run this in Supabase Dashboard -> SQL Editor. It is written to be safe to
-- run even if some of it already exists (IF NOT EXISTS everywhere) — it will
-- not drop or overwrite any existing data, table, or policy.
--
-- WHY: the Web Admin logs staff in with Supabase Auth (email + password).
-- After login we need to find that person's row in staff_users to read
-- their role (owner/admin/staff). This script adds a nullable auth_user_id
-- column as a safe fallback link IF staff_users.id is not already the same
-- uuid as auth.users.id. It does NOT touch is_staff()/is_owner_or_admin()
-- or any existing RLS policy — only adds one new column + index, and one
-- new policy that lets a staff member read (only) their own row.
-- ============================================================================

-- 1) Add the link column if it doesn't already exist.
ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id);

CREATE UNIQUE INDEX IF NOT EXISTS staff_users_auth_user_id_key
  ON public.staff_users (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- 2) Let a logged-in staff member read their own staff_users row (needed so
--    the Web Admin can look up its own role after login). This does not
--    grant access to OTHER staff_users rows and does not change any
--    existing policy.
DROP POLICY IF EXISTS staff_users_self_read ON public.staff_users;
CREATE POLICY staff_users_self_read ON public.staff_users
  FOR SELECT
  USING (auth.uid() = id OR auth.uid() = auth_user_id);

-- ============================================================================
-- HOW TO CREATE A STAFF LOGIN (owner does this per staff member):
--
--   1. Supabase Dashboard -> Authentication -> Users -> "Add user"
--      Enter their email + a temporary password (or send a magic link,
--      per your preference). Copy the generated "User UID".
--
--   2. Link that UID to their existing staff_users row. Either:
--
--      a) If staff_users.id should just BE that UID (recommended for a
--         staff member who doesn't have a row yet):
--         INSERT INTO staff_users (id, full_name, role, phone, active)
--         VALUES ('<paste User UID>', 'ชื่อ-นามสกุล', 'staff', '0812345678', true);
--
--      b) If they already have a staff_users row (existing owner/admin):
--         UPDATE staff_users
--         SET auth_user_id = '<paste User UID>'
--         WHERE id = '<their existing staff_users.id>';
--
--   3. They can now log in to the Web Admin with that email/password.
-- ============================================================================
