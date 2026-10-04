-- CLT Tenant Hub — keep meter readings exactly as typed (leading zeros)
-- ============================================================================
-- Run once in Supabase Dashboard -> SQL Editor.
-- Adds 4 optional TEXT columns next to the existing numeric readings.
-- * Numeric columns (and the generated electric_units / water_units) are
--   untouched, so billing maths and the n8n workflows keep working as before.
-- * No existing data is changed or deleted. Safe to run more than once.
-- ============================================================================
ALTER TABLE public.meter_readings
  ADD COLUMN IF NOT EXISTS electric_previous_raw text,
  ADD COLUMN IF NOT EXISTS electric_current_raw  text,
  ADD COLUMN IF NOT EXISTS water_previous_raw    text,
  ADD COLUMN IF NOT EXISTS water_current_raw     text;

-- Make the API see the new columns immediately.
NOTIFY pgrst, 'reload schema';

-- Check: should list the 4 new columns.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'meter_readings' AND column_name LIKE '%\_raw'
ORDER BY column_name;
