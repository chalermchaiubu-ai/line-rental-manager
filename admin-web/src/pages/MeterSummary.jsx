import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { sortRooms } from '../lib/sortRooms';

// ----------------------------------------------------------------------------
// สรุปค่าน้ำ-ค่าไฟ: one row per room with an active lease, for a billing month.
// Uses EXACTLY the same formula as the Bill Generation page:
//   ค่าไฟ = หน่วยไฟ × เรทไฟ,  ค่าน้ำ = หน่วยน้ำ × เรทน้ำ,
//   รวม  = ค่าเช่า + ค่าไฟ + ค่าน้ำ   (late fee / discount are per-bill, not here)
// Units come straight from meter_readings (generated: current − previous), so
// whatever the admin set on the Meter page is what's summed here.
// Two outputs: print (browser print, A4 landscape) and .xlsx with live formulas.
// ----------------------------------------------------------------------------

function currentBillingMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function thaiMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}

const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const fmt = (v, digits = 2) =>
  v === null || v === undefined || Number.isNaN(v)
    ? '-'
    : Number(v).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtUnits = (v) =>
  v === null || v === undefined ? '-' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: 2 });

export default function MeterSummary() {
  const [billingMonth, setBillingMonth] = useState(currentBillingMonth());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [onlyWithMeter, setOnlyWithMeter] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [roomsRes, leasesRes, metersRes] = await Promise.all([
          supabase.from('rooms').select('id, room_number'),
          supabase
            .from('leases')
            .select('id, room_id, tenant_id, monthly_rent, electric_rate, water_rate')
            .eq('status', 'active'),
          supabase
            .from('meter_readings')
            .select('room_id, electric_previous, electric_current, electric_units, water_previous, water_current, water_units')
            .eq('billing_month', billingMonth),
        ]);
        if (roomsRes.error) throw roomsRes.error;
        if (leasesRes.error) throw leasesRes.error;
        if (metersRes.error) throw metersRes.error;

        const leases = leasesRes.data || [];
        const tenantIds = [...new Set(leases.map((l) => l.tenant_id).filter(Boolean))];
        const tenantsRes = tenantIds.length
          ? await supabase.from('tenants').select('id, first_name, last_name').in('id', tenantIds)
          : { data: [] };
        if (tenantsRes.error) throw tenantsRes.error;

        const leaseByRoom = new Map(leases.map((l) => [l.room_id, l]));
        const meterByRoom = new Map((metersRes.data || []).map((m) => [m.room_id, m]));
        const tenantById = new Map((tenantsRes.data || []).map((t) => [t.id, t]));

        const built = sortRooms(roomsRes.data)
          .filter((r) => leaseByRoom.has(r.id))
          .map((room) => {
            const lease = leaseByRoom.get(room.id);
            const m = meterByRoom.get(room.id) || null;
            const t = tenantById.get(lease.tenant_id);
            const eUnits = m ? n(m.electric_units) ?? n(m.electric_current) - n(m.electric_previous) : null;
            const wUnits = m ? n(m.water_units) ?? n(m.water_current) - n(m.water_previous) : null;
            const eRate = n(lease.electric_rate);
            const wRate = n(lease.water_rate);
            const rent = n(lease.monthly_rent) ?? 0;
            const eAmt = eUnits !== null && eRate !== null ? eUnits * eRate : null;
            const wAmt = wUnits !== null && wRate !== null ? wUnits * wRate : null;
            const notes = [];
            if (!m) notes.push('ยังไม่กรอกมิเตอร์');
            if (eRate === null || wRate === null) notes.push('ยังไม่ตั้งเรทน้ำ/ไฟ');
            if (!rent) notes.push('ค่าเช่า 0');
            return {
              roomId: room.id,
              roomNumber: room.room_number,
              tenantName: t ? `${t.first_name || ''} ${t.last_name || ''}`.trim() : '-',
              hasMeter: Boolean(m),
              ePrev: m ? n(m.electric_previous) : null,
              eCur: m ? n(m.electric_current) : null,
              eUnits,
              eRate,
              eAmt,
              wPrev: m ? n(m.water_previous) : null,
              wCur: m ? n(m.water_current) : null,
              wUnits,
              wRate,
              wAmt,
              rent,
              total: rent + (eAmt ?? 0) + (wAmt ?? 0),
              complete: Boolean(m) && eRate !== null && wRate !== null,
              notes: notes.join(', '),
            };
          });
        if (!cancelled) setRows(built);
      } catch (err) {
        if (!cancelled) setError(err.message || 'โหลดข้อมูลไม่สำเร็จ');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [billingMonth]);

  const shown = useMemo(() => (onlyWithMeter ? rows.filter((r) => r.hasMeter) : rows), [rows, onlyWithMeter]);
  const totals = useMemo(
    () =>
      shown.reduce(
        (acc, r) => ({
          eAmt: acc.eAmt + (r.eAmt ?? 0),
          wAmt: acc.wAmt + (r.wAmt ?? 0),
          rent: acc.rent + (r.rent ?? 0),
          total: acc.total + (r.total ?? 0),
        }),
        { eAmt: 0, wAmt: 0, rent: 0, total: 0 }
      ),
    [shown]
  );
  const incompleteCount = shown.filter((r) => !r.complete).length;

  async function exportExcel() {
    setExporting(true);
    try {
      // Loaded on demand from SheetJS's official CDN so the app bundle stays small.
      const XLSX = await import(/* @vite-ignore */ 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');

      const title = `สรุปค่าน้ำ-ค่าไฟ เดือน${thaiMonth(billingMonth)}`;
      const header = [
        'ห้อง', 'ผู้เช่า',
        'ไฟ-เลขก่อน', 'ไฟ-เลขหลัง', 'หน่วยไฟ', 'เรทไฟ (บาท/หน่วย)', 'ค่าไฟ (บาท)',
        'น้ำ-เลขก่อน', 'น้ำ-เลขหลัง', 'หน่วยน้ำ', 'เรทน้ำ (บาท/หน่วย)', 'ค่าน้ำ (บาท)',
        'ค่าเช่า (บาท)', 'รวมทั้งสิ้น (บาท)', 'หมายเหตุ',
      ];
      const firstDataRow = 3; // row 1 title, row 2 header (1-based Excel rows)
      const aoa = [[title], header];
      const num = (v) => (v === null || v === undefined ? '' : v);
      shown.forEach((r, i) => {
        const x = firstDataRow + i;
        aoa.push([
          `ห้อง ${r.roomNumber}`,
          r.tenantName,
          num(r.ePrev),
          num(r.eCur),
          r.hasMeter ? { t: 'n', f: `D${x}-C${x}`, v: r.eUnits ?? 0 } : '',
          num(r.eRate),
          { t: 'n', f: `IFERROR(E${x}*F${x},0)`, v: r.eAmt ?? 0 },
          num(r.wPrev),
          num(r.wCur),
          r.hasMeter ? { t: 'n', f: `I${x}-H${x}`, v: r.wUnits ?? 0 } : '',
          num(r.wRate),
          { t: 'n', f: `IFERROR(J${x}*K${x},0)`, v: r.wAmt ?? 0 },
          num(r.rent),
          { t: 'n', f: `G${x}+L${x}+M${x}`, v: r.total },
          r.notes,
        ]);
      });
      const last = firstDataRow + shown.length - 1;
      const sum = (col, v) => ({ t: 'n', f: shown.length ? `SUM(${col}${firstDataRow}:${col}${last})` : '0', v });
      aoa.push([
        'รวม', `${shown.length} ห้อง`, '', '', '', '', sum('G', totals.eAmt), '', '', '', '', sum('L', totals.wAmt),
        sum('M', totals.rent), sum('N', totals.total), '',
      ]);

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 14 } }];
      ws['!cols'] = [10, 18, 11, 11, 9, 10, 12, 11, 11, 9, 10, 12, 12, 14, 22].map((wch) => ({ wch }));
      // 2-decimal money format on amount columns
      const moneyCols = ['G', 'L', 'M', 'N'];
      for (let row = firstDataRow; row <= last + 1; row += 1) {
        for (const c of moneyCols) {
          const cell = ws[`${c}${row}`];
          if (cell) cell.z = '#,##0.00';
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, billingMonth);
      XLSX.writeFile(wb, `สรุปค่าน้ำไฟ_${billingMonth}.xlsx`);
    } catch (err) {
      setError(`ส่งออก Excel ไม่สำเร็จ: ${err.message || err}`);
    } finally {
      setExporting(false);
    }
  }

  const th = 'px-2 py-2 text-right font-semibold';
  const td = 'px-2 py-1.5 text-right tabular-nums';

  return (
    <div>
      <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } }`}</style>

      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">สรุปค่าน้ำ-ค่าไฟ / พิมพ์</h1>
          <p className="mt-1 text-sm text-slate-500">
            เดือน:{' '}
            <input
              type="month"
              value={billingMonth}
              onChange={(e) => setBillingMonth(e.target.value)}
              className="ml-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <label className="ml-4 inline-flex items-center gap-1.5">
              <input type="checkbox" checked={onlyWithMeter} onChange={(e) => setOnlyWithMeter(e.target.checked)} />
              เฉพาะห้องที่กรอกมิเตอร์แล้ว
            </label>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            disabled={loading || shown.length === 0}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            🖨️ พิมพ์
          </button>
          <button
            type="button"
            onClick={exportExcel}
            disabled={loading || exporting || shown.length === 0}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {exporting ? 'กำลังสร้างไฟล์…' : '⬇️ ส่งออก Excel (มีสูตร)'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">{error}</div>
      )}
      {!loading && incompleteCount > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">
          มี {incompleteCount} ห้องที่ข้อมูลยังไม่ครบ (ดูช่องหมายเหตุ) — ค่าน้ำ/ไฟของห้องเหล่านี้จะยังเป็น 0 จนกว่าจะกรอกมิเตอร์/ตั้งเรท
        </div>
      )}

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 print:mt-0 print:border-0 print:p-0">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-slate-900">สรุปค่าน้ำ-ค่าไฟ เดือน{thaiMonth(billingMonth)}</h2>
          <p className="text-xs text-slate-500">
            {shown.length} ห้อง · พิมพ์เมื่อ {new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>

        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[1100px] border-collapse text-xs print:min-w-0 print:text-[9px]">
            <thead className="bg-slate-50 text-slate-600 print:bg-white">
              <tr className="border-b border-slate-300">
                <th rowSpan={2} className="px-2 py-2 text-left font-semibold">ห้อง</th>
                <th rowSpan={2} className="px-2 py-2 text-left font-semibold">ผู้เช่า</th>
                <th colSpan={5} className="border-l border-slate-200 px-2 py-1 text-center font-semibold">ไฟฟ้า</th>
                <th colSpan={5} className="border-l border-slate-200 px-2 py-1 text-center font-semibold">น้ำประปา</th>
                <th rowSpan={2} className={`${th} border-l border-slate-200`}>ค่าเช่า</th>
                <th rowSpan={2} className={th}>รวม</th>
                <th rowSpan={2} className="px-2 py-2 text-left font-semibold">หมายเหตุ</th>
              </tr>
              <tr className="border-b border-slate-300">
                <th className={`${th} border-l border-slate-200`}>ก่อน</th>
                <th className={th}>หลัง</th>
                <th className={th}>หน่วย</th>
                <th className={th}>เรท</th>
                <th className={th}>บาท</th>
                <th className={`${th} border-l border-slate-200`}>ก่อน</th>
                <th className={th}>หลัง</th>
                <th className={th}>หน่วย</th>
                <th className={th}>เรท</th>
                <th className={th}>บาท</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={15} className="px-4 py-6 text-center text-slate-400">กำลังโหลด…</td>
                </tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-6 text-center text-slate-400">ยังไม่มีห้องที่กรอกมิเตอร์เดือนนี้</td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.roomId} className={`border-b border-slate-100 ${r.complete ? '' : 'bg-amber-50/60 print:bg-white'}`}>
                    <td className="px-2 py-1.5 font-medium text-slate-800">{r.roomNumber}</td>
                    <td className="px-2 py-1.5 text-slate-600">{r.tenantName}</td>
                    <td className={`${td} border-l border-slate-100`}>{fmtUnits(r.ePrev)}</td>
                    <td className={td}>{fmtUnits(r.eCur)}</td>
                    <td className={`${td} font-semibold`}>{fmtUnits(r.eUnits)}</td>
                    <td className={td}>{r.eRate === null ? '-' : fmtUnits(r.eRate)}</td>
                    <td className={td}>{fmt(r.eAmt)}</td>
                    <td className={`${td} border-l border-slate-100`}>{fmtUnits(r.wPrev)}</td>
                    <td className={td}>{fmtUnits(r.wCur)}</td>
                    <td className={`${td} font-semibold`}>{fmtUnits(r.wUnits)}</td>
                    <td className={td}>{r.wRate === null ? '-' : fmtUnits(r.wRate)}</td>
                    <td className={td}>{fmt(r.wAmt)}</td>
                    <td className={`${td} border-l border-slate-100`}>{fmt(r.rent)}</td>
                    <td className={`${td} font-semibold text-slate-900`}>{fmt(r.total)}</td>
                    <td className="px-2 py-1.5 text-amber-700">{r.notes}</td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && shown.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-400 font-semibold text-slate-900">
                  <td className="px-2 py-2" colSpan={6}>รวม {shown.length} ห้อง</td>
                  <td className={td}>{fmt(totals.eAmt)}</td>
                  <td colSpan={4} />
                  <td className={td}>{fmt(totals.wAmt)}</td>
                  <td className={`${td} border-l border-slate-100`}>{fmt(totals.rent)}</td>
                  <td className={td}>{fmt(totals.total)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="mt-2 text-[10px] text-slate-400">
          สูตร: ค่าไฟ = หน่วยไฟ × เรทไฟ · ค่าน้ำ = หน่วยน้ำ × เรทน้ำ · รวม = ค่าเช่า + ค่าไฟ + ค่าน้ำ (ยังไม่รวมค่าปรับ/ส่วนลด)
        </p>
      </div>
    </div>
  );
}
