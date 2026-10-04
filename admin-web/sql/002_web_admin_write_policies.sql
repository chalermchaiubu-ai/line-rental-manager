-- CLT Tenant Hub — Web Admin: row-level-security policies for logged-in staff
-- ============================================================================
-- Run once in Supabase Dashboard -> SQL Editor (after 001_staff_auth_link.sql).
--
-- SAFE TO RUN / RE-RUN:
--   * Only ADDS permissive policies (each named web_admin_*). Postgres ORs
--     permissive policies together, so this can only grant the web admin what
--     it needs — it never removes or narrows any existing policy, and the LINE
--     bot / n8n (service_role key) bypass RLS entirely and are unaffected.
--   * No data is read, changed or deleted. No DELETE is granted on any table
--     except bill_items (owner/admin), which Bill Generation needs to rebuild a
--     bill's line items from scratch.
--
-- WHO CAN DO WHAT (mirrors admin-web/src/auth/permissions.js):
--   any active staff (owner/admin/staff): read everything the web shows,
--       enter meter readings, create/update repair tickets
--   owner + admin: create/update bills & bill items, tenants, leases,
--       move-out requests, room status, settings
--   owner only: verify/reject payments, activate/deactivate staff accounts
-- ============================================================================

-- Role of the signed-in user, from staff_users (linked by id or auth_user_id).
-- SECURITY DEFINER so it can read staff_users regardless of that table's RLS.
CREATE OR REPLACE FUNCTION public.web_admin_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT su.role::text
  FROM public.staff_users su
  WHERE (su.id = auth.uid() OR su.auth_user_id = auth.uid())
    AND COALESCE(su.active, true)
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.web_admin_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.web_admin_role() TO authenticated;

DO $$
DECLARE
  t text;
  -- every table the web admin reads
  read_tables text[] := ARRAY[
    'rooms','room_types','tenants','leases','meter_readings','bills',
    'bill_items','payments','maintenance_requests','move_out_requests',
    'settings','staff_users'
  ];
BEGIN
  FOREACH t IN ARRAY read_tables LOOP
    -- Deliberately does NOT enable RLS on any table: if a table has RLS off,
    -- these policies simply sit unused and nothing changes for it.
    EXECUTE format('DROP POLICY IF EXISTS web_admin_read ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY web_admin_read ON public.%I FOR SELECT TO authenticated
         USING (public.web_admin_role() IN (''owner'',''admin'',''staff''))', t);
  END LOOP;
END $$;

-- helper to keep the statements below short
CREATE OR REPLACE FUNCTION pg_temp.web_admin_policy(tbl text, op text, roles text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  pname text := 'web_admin_' || lower(op);
  cond  text := format('public.web_admin_role() IN (%s)', roles);
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pname, tbl);
  IF op = 'INSERT' THEN
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', pname, tbl, cond);
  ELSIF op = 'UPDATE' THEN
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', pname, tbl, cond, cond);
  ELSIF op = 'DELETE' THEN
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)', pname, tbl, cond);
  END IF;
END $$;

-- any active staff
SELECT pg_temp.web_admin_policy('meter_readings',       'INSERT', '''owner'',''admin'',''staff''');
SELECT pg_temp.web_admin_policy('meter_readings',       'UPDATE', '''owner'',''admin'',''staff''');
SELECT pg_temp.web_admin_policy('maintenance_requests', 'INSERT', '''owner'',''admin'',''staff''');
SELECT pg_temp.web_admin_policy('maintenance_requests', 'UPDATE', '''owner'',''admin'',''staff''');

-- owner + admin
SELECT pg_temp.web_admin_policy('bills',             'INSERT', '''owner'',''admin''');
SELECT pg_temp.web_admin_policy('bills',             'UPDATE', '''owner'',''admin''');
SELECT pg_temp.web_admin_policy('bill_items',        'INSERT', '''owner'',''admin''');
SELECT pg_temp.web_admin_policy('bill_items',        'DELETE', '''owner'',''admin''');
SELECT pg_temp.web_admin_policy('tenants',           'INSERT', '''owner'',''admin''');
SELECT pg_temp.web_admin_policy('tenants',           'UPDATE', '''owner'',''admin''');
SELECT pg_temp.web_admin_policy('leases',            'INSERT', '''owner'',''admin''');
SELECT pg_temp.web_admin_policy('leases',            'UPDATE', '''owner'',''admin''');
SELECT pg_temp.web_admin_policy('move_out_requests', 'INSERT', '''owner'',''admin''');
SELECT pg_temp.web_admin_policy('move_out_requests', 'UPDATE', '''owner'',''admin''');
SELECT pg_temp.web_admin_policy('rooms',             'UPDATE', '''owner'',''admin''');
SELECT pg_temp.web_admin_policy('settings',          'UPDATE', '''owner'',''admin''');

-- owner only
SELECT pg_temp.web_admin_policy('payments',    'UPDATE', '''owner''');
SELECT pg_temp.web_admin_policy('staff_users', 'UPDATE', '''owner''');

-- Quick check after running: should list the new web_admin_* policies.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND policyname LIKE 'web_admin_%'
ORDER BY tablename, cmd;
