-- CLT Tenant Hub — owner/admin LINE notifications
-- ============================================================================
-- Run once in Supabase Dashboard -> SQL Editor. Safe to run more than once.
-- Lets a staff member link their LINE account so the bot can alert them when
-- a tenant sends a payment slip, a repair request or a move-out request.
--   line_user_id               the staff member's LINE user id (set by the bot)
--   line_link_code / _expires  one-time 6-digit code made on the web admin
-- No existing data is changed or deleted.
-- ============================================================================
ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS line_user_id              text,
  ADD COLUMN IF NOT EXISTS line_link_code            text,
  ADD COLUMN IF NOT EXISTS line_link_code_expires_at timestamptz;

NOTIFY pgrst, 'reload schema';

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'staff_users'
  AND column_name IN ('line_user_id', 'line_link_code', 'line_link_code_expires_at')
ORDER BY column_name;
