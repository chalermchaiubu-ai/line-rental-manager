import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

function monthsBack(n) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(from, to) {
  const months = [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const cursor = new Date(fy, fm - 1, 1);
  const end = new Date(ty, tm - 1, 1);
  while (cursor <= end) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function Bar({ value, max, colorClass }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2.5 w-full rounded-full bg-slate-100">
      <div className={`h-2.5 rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function downloadCsv(filename, rows) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')]
    .concat(rows.map((r) => headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')))
    .join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [fromMonth, setFromMonth] = useState(monthsBack(5));
  const [toMonth, setToMonth] = useState(monthsBack(0));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [monthRows, setMonthRows] = useState([]);
  const [roomCounts, setRoomCounts] = useState({ occupied: 0, vacant: 0, other: 0 });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const months = monthRange(fromMonth, toMonth);
        const [billsRes, roomsRes] = await Promise.all([
          supabase
            .from('bills')
            .select('billing_month, total_amount, status')
            .gte('billing_month', fromMonth)
            .lte('billing_month', toMonth),
          supabase.from('rooms').select('status'),
        ]);
        if (billsRes.error) throw billsRes.error;
        if (roomsRes.error) throw roomsRes.error;

        const byMonth = new Map(months.map((m) => [m, { billing_month: m, count: 0, revenue: 0, paid: 0, unpaid: 0 }]));
        for (const bill of billsRes.data || []) {
          const row = byMonth.get(bill.billing_month);
          if (!row) continue; // outside the selected range's exact month keys (shouldn't happen given the query filter)
          row.count += 1;
          row.revenue += Number(bill.total_amount || 0);
          if (bill.status === 'paid') row.paid += 1;
          else row.unpaid += 1;
        }

        let occupied = 0;
        let vacant = 0;
        let other = 0;
        for (const r of roomsRes.data || []) {
          if (r.status === 'occupied') occupied += 1;
          else if (r.status === 'vacant') vacant += 1;
          else other += 1;
        }

        if (!cancelled) {
          setMonthRows(months.map((m) => byMonth.get(m)));
          setRoomCounts({ occupied, vacant, other });
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'โหลดรายงานไม่สำเร็จ');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [fromMonth, toMonth]);

  const maxRevenue = useMemo(() => Math.max(1, ...monthRows.map((r) => r.revenue)), [monthRows]);
  const totalRevenue = monthRows.reduce((s, r) => s + r.revenue, 0);
  const totalPaid = monthRows.reduce((s, r) => s + r.paid, 0);
  const totalUnpaid = monthRows.reduce((s, r) => s + r.unpaid, 0);
  const totalRoomCount = roomCounts.occupied + roomCounts.vacant + roomCounts.other;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">รายงาน</h1>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-slate-500">ตั้งแต่เดือน</label>
            <input type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500">ถึงเดือน</label>
            <input type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <button
            type="button"
            onClick={() => downloadCsv(`clt-report-${fromMonth}_to_${toMonth}.csv`, monthRows)}
            disabled={monthRows.length === 0}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            ส่งออก CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-slate-400">กำลังโหลด…</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-400">รายได้รวม ({monthRows.length} เดือน)</p>
              <p className="mt-1 text-2xl font-semibold text-slate-800">{totalRevenue.toLocaleString('th-TH')} บาท</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-400">บิลที่ชำระแล้ว / ค้างชำระ</p>
              <p className="mt-1 text-2xl font-semibold text-slate-800">
                {totalPaid} / {totalUnpaid}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-400">ห้องมีผู้เช่า / ว่าง (ทั้งหมด {totalRoomCount})</p>
              <p className="mt-1 text-2xl font-semibold text-slate-800">
                {roomCounts.occupied} / {roomCounts.vacant}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="mb-3 text-sm font-semibold text-slate-700">รายได้รายเดือน</p>
              <div className="space-y-2">
                {monthRows.map((r) => (
                  <div key={r.billing_month} className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="w-16 shrink-0">{r.billing_month}</span>
                    <Bar value={r.revenue} max={maxRevenue} colorClass="bg-emerald-500" />
                    <span className="w-24 shrink-0 text-right">{r.revenue.toLocaleString('th-TH')}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="mb-3 text-sm font-semibold text-slate-700">สถานะห้องพัก</p>
              <div className="space-y-2 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0">มีผู้เช่า</span>
                  <Bar value={roomCounts.occupied} max={totalRoomCount} colorClass="bg-sky-500" />
                  <span className="w-10 text-right">{roomCounts.occupied}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0">ว่าง</span>
                  <Bar value={roomCounts.vacant} max={totalRoomCount} colorClass="bg-slate-400" />
                  <span className="w-10 text-right">{roomCounts.vacant}</span>
                </div>
                {roomCounts.other > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0">อื่นๆ</span>
                    <Bar value={roomCounts.other} max={totalRoomCount} colorClass="bg-amber-400" />
                    <span className="w-10 text-right">{roomCounts.other}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">เดือน</th>
                  <th className="px-4 py-3">จำนวนบิล</th>
                  <th className="px-4 py-3">รายได้</th>
                  <th className="px-4 py-3">ชำระแล้ว</th>
                  <th className="px-4 py-3">ค้างชำระ</th>
                  <th className="px-4 py-3">อัตราชำระ</th>
                </tr>
              </thead>
              <tbody>
                {monthRows.map((r) => (
                  <tr key={r.billing_month} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-800">{r.billing_month}</td>
                    <td className="px-4 py-2 text-slate-600">{r.count}</td>
                    <td className="px-4 py-2 text-slate-600">{r.revenue.toLocaleString('th-TH')} บาท</td>
                    <td className="px-4 py-2 text-slate-600">{r.paid}</td>
                    <td className="px-4 py-2 text-slate-600">{r.unpaid}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {r.count > 0 ? `${Math.round((r.paid / r.count) * 100)}%` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
