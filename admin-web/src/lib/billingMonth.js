// Billing cycle (owner, 2026-10-04): meters are read and bills issued at the
// END of each month, dated the 30th. Readings are stored in meter_readings
// under the FOLLOWING month (readings for September usage = '2026-10'), which
// is how the first real round was entered.
//
// So the "readings month" a page should open on by default is:
//   day 1–24  -> this month     (e.g. 4 Oct  -> 2026-10 = September bills)
//   day 25+   -> next month     (e.g. 30 Oct -> 2026-11 = October bills)
// This stops an end-of-month meter round from overwriting last round's data.
export const ROUND_STARTS_ON_DAY = 25;

export function defaultReadingsMonth(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() + (now.getDate() >= ROUND_STARTS_ON_DAY ? 1 : 0), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Month the bill is FOR (printed as "ประจำเดือน") = month before the readings month.
export function usageMonthOf(readingsYm) {
  const [y, m] = readingsYm.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function thaiMonthName(ym) {
  const [y, m] = (ym || '').split('-').map(Number);
  if (!y || !m) return ym || '';
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}
