// Meter readings are stored twice in meter_readings:
//   electric_current (numeric)      -> used for maths (units = current - previous)
//   electric_current_raw (text)     -> exactly what was typed, e.g. "054321"
// A number can't keep leading zeros (054321 == 54321), so screens and printed
// bills show the *_raw text when it exists and fall back to the number.
// (raw columns added by admin-web/sql/003_meter_raw_text.sql)

export function cleanRaw(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[,\s]/g, '');
}

// Text to show for a reading: the typed text if we have it, else the number.
export function rawOr(raw, num) {
  const r = cleanRaw(raw);
  if (r !== '') return r;
  if (num === null || num === undefined || num === '') return '';
  return String(num);
}

// Give a computed whole number the same width as a reference reading, so
// "191" next to "0194" becomes "0191". Leaves decimals/negatives untouched.
export function padLike(value, like) {
  const v = cleanRaw(value);
  const l = cleanRaw(like);
  if (!/^\d+$/.test(v) || !/^\d+$/.test(l)) return v;
  return v.length < l.length ? v.padStart(l.length, '0') : v;
}

// Error from Supabase meaning the *_raw columns don't exist yet (SQL not run).
export function isMissingRawColumn(err) {
  const m = err?.message || '';
  return /_raw/.test(m) && /(column|schema cache)/i.test(m);
}
