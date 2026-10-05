-- CLT Tenant Hub — link LINE by national ID card (in addition to phone)
-- ============================================================================
-- Run once in Supabase Dashboard -> SQL Editor. Safe to run more than once.
--
-- The 13-digit ID number itself is NEVER stored. Only:
--   id_card_hash  = SHA-256 of the 13 digits (used by the LINE bot to match
--                   what the tenant types)
--   id_card_last4 = last 4 digits, for staff to recognise the record
-- No existing data is changed or deleted.
-- ============================================================================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS id_card_hash  text,
  ADD COLUMN IF NOT EXISTS id_card_last4 text;

CREATE INDEX IF NOT EXISTS tenants_id_card_hash_idx
  ON public.tenants (id_card_hash)
  WHERE id_card_hash IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Check: should list the 2 new columns.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name LIKE 'id_card%'
ORDER BY column_name;
