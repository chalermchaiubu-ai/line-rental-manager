import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { sortRooms } from '../lib/sortRooms';

// ----------------------------------------------------------------------------
// พิมพ์บิล (ฟอร์มจดหมายเวียน) — reproduces the owner's paper bill
// "หอพัก โชคดี เพลส · ใบแจ้งหนี้ / ใบเสร็จรับเงิน": half-A4 bills, two per A4
// sheet with a cut line. One bill per room (rooms 1–28 by default).
//
// Auto-filled: month, date, tenant, room no., แอร์/พัดลม tick (from room type),
// and electric/water meter after / before / units from meter_readings.
// Amounts are deliberately left BLANK for now — the owner/admin calculates and
// writes them in by hand (owner's instruction, 2026-10-04).
// ----------------------------------------------------------------------------

const DORM = {
  name: 'หอพัก โชคดี เพลส',
  address: '29/2 บ้านน้ำอ้อม ม.2 ต.น้ำอ้อม อ.กันทรลักษ์ จ.ศรีสะเกษ 33110',
  phone: '089-4286622, 087-0419568',
};

function currentBillingMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function thaiMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}
function thaiDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('th-TH', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
const showNum = (v) =>
  v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: 2, useGrouping: false });

function roomKind(typeName) {
  const t = typeName || '';
  if (t.includes('แอร์')) return 'air';
  if (t.includes('พัดลม')) return 'fan';
  return null;
}

function Box({ checked }) {
  return (
    <span className="mx-0.5 inline-flex h-[12px] w-[12px] items-center justify-center border border-slate-500 align-[-2px] text-[10px] leading-none">
      {checked ? '✓' : ''}
    </span>
  );
}

function Bill({ b, monthLabel, dateLabel }) {
  const cell = 'border border-slate-300 px-2 py-[3px]';
  const num = `${cell} text-center tabular-nums`;
  return (
    <div className="bill flex h-full flex-col rounded-lg border border-slate-300 px-4 py-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[19px] font-bold leading-tight text-sky-700">{DORM.name}</p>
          <p className="text-[10.5px] text-slate-600">{DORM.address}</p>
          <p className="text-[10.5px] text-slate-600">
            <b>โทร:</b> {DORM.phone}
          </p>
        </div>
        <div className="text-right">
          <p className="inline-block rounded-md bg-sky-600 px-3 py-1 text-[13px] font-bold text-white">
            ใบแจ้งหนี้ / ใบเสร็จรับเงิน
          </p>
          <p className="mt-1 text-[10.5px]">
            <b>ประจำเดือน:</b> <span className="inline-block min-w-[110px] border-b border-dotted border-slate-400 text-center">{monthLabel}</span>
          </p>
          <p className="text-[10.5px]">
            <b>วันที่:</b> <span className="inline-block min-w-[110px] border-b border-dotted border-slate-400 text-center">{dateLabel}</span>
          </p>
        </div>
      </div>
      <div className="mt-1.5 border-t-2 border-sky-600" />

      <div className="mt-2 flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px]">
        <span>
          <b>ชื่อผู้เช่า:</b>{' '}
          <span className="inline-block min-w-[170px] border-b border-dotted border-slate-400 px-1">{b.tenantName}</span>
        </span>
        <span>
          <b>ห้องเลขที่:</b>{' '}
          <span className="inline-block min-w-[110px] border-b border-dotted border-slate-400 px-1 text-center font-semibold">
            {b.roomNumber}
          </span>
        </span>
        <span>
          <b>ประเภท:</b> <Box checked={b.kind === 'air'} /> แอร์ <Box checked={b.kind === 'fan'} /> พัดลม
        </span>
      </div>

      <table className="mt-2 w-full border-collapse text-[10.5px]">
        <thead>
          <tr className="bg-slate-100">
            <th className={`${cell} w-[38%]`}>รายการ</th>
            <th className={cell}>มิเตอร์หลัง</th>
            <th className={cell}>มิเตอร์ก่อน</th>
            <th className={cell}>หน่วยที่ใช้</th>
            <th className={`${cell} w-[20%]`}>จำนวนเงิน (บาท)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cell}>
              1. ค่าเช่าห้องพัก (Room Rent)
              {b.kind && <span className="ml-1 text-slate-500">— {b.kind === 'air' ? 'ห้องแอร์' : 'ห้องพัดลม'}</span>}
            </td>
            <td className={num}>-</td>
            <td className={num}>-</td>
            <td className={num}>-</td>
            <td className={cell} />
          </tr>
          <tr>
            <td className={cell}>2. ค่าไฟฟ้า (Electricity)</td>
            <td className={num}>{showNum(b.eCur)}</td>
            <td className={num}>{showNum(b.ePrev)}</td>
            <td className={`${num} font-semibold`}>{showNum(b.eUnits)}</td>
            <td className={cell} />
          </tr>
          <tr>
            <td className={cell}>3. ค่าน้ำประปา (Water)</td>
            <td className={num}>{showNum(b.wCur)}</td>
            <td className={num}>{showNum(b.wPrev)}</td>
            <td className={`${num} font-semibold`}>{showNum(b.wUnits)}</td>
            <td className={cell} />
          </tr>
          <tr>
            <td className={cell}>4. ค่าปรับเกินกำหนดชำระ (Fine)</td>
            <td className={`${cell} text-center`} colSpan={3}>
              จำนวน ................... วัน (วันละ ........ บาท)
            </td>
            <td className={cell} />
          </tr>
          <tr>
            <td className={cell}>5. อื่นๆ (Other)</td>
            <td className={`${cell} text-center`} colSpan={3}>
              ...........................................................................
            </td>
            <td className={cell} />
          </tr>
          <tr>
            <td className={`${cell} text-right font-bold`} colSpan={4}>
              รวมเงินทั้งสิ้น (Total Amount)
            </td>
            <td className={`${cell} bg-emerald-50`} />
          </tr>
        </tbody>
      </table>

      <div className="mt-auto flex items-end justify-between gap-4 pt-2">
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-2 py-1 text-[9.5px] text-slate-600">
          <p className="font-semibold text-slate-700">ข้อกำหนดการชำระเงิน:</p>
          <p>• กรุณาชำระเงินภายในวันที่ 1-5 ทุกเดือน</p>
          <p>• หากชำระเกินกำหนด จะมีค่าปรับวันละ 50 บาท ตามอัตราที่หอพักกำหนด</p>
        </div>
        <div className="flex gap-6 text-center text-[10px] text-slate-600">
          <div>
            <div className="mb-1 w-[130px] border-b border-dotted border-slate-400 pt-5" />
            ผู้แจ้งหนี้ / ผู้รับเงิน
          </div>
          <div>
            <div className="mb-1 w-[130px] border-b border-dotted border-slate-400 pt-5" />
            ผู้ชำระเงิน
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PrintBills() {
  const [billingMonth, setBillingMonth] = useState(currentBillingMonth());
  const [billDate, setBillDate] = useState(todayStr());
  const [includeOtherUnits, setIncludeOtherUnits] = useState(false);
  const [showNames, setShowNames] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bills, setBills] = useState([]);
  const [placeholderName, setPlaceholderName] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [roomsRes, typesRes, leasesRes, metersRes] = await Promise.all([
          supabase.from('rooms').select('id, room_number, room_type_id'),
          supabase.from('room_types').select('id, name'),
          supabase.from('leases').select('room_id, tenant_id').eq('status', 'active'),
          supabase
            .from('meter_readings')
            .select('room_id, electric_previous, electric_current, electric_units, water_previous, water_current, water_units')
            .eq('billing_month', billingMonth),
        ]);
        for (const r of [roomsRes, typesRes, leasesRes, metersRes]) if (r.error) throw r.error;

        const leases = leasesRes.data || [];
        const tenantIds = [...new Set(leases.map((l) => l.tenant_id).filter(Boolean))];
        const tenantsRes = tenantIds.length
          ? await supabase.from('tenants').select('id, first_name, last_name').in('id', tenantIds)
          : { data: [] };
        if (tenantsRes.error) throw tenantsRes.error;

        const typeById = new Map((typesRes.data || []).map((t) => [t.id, t.name]));
        const leaseByRoom = new Map(leases.map((l) => [l.room_id, l]));
        const meterByRoom = new Map((metersRes.data || []).map((m) => [m.room_id, m]));
        const tenantById = new Map((tenantsRes.data || []).map((t) => [t.id, t]));

        // The DB still has one placeholder tenant name copied onto every room.
        // If the same full name appears on 4+ rooms, treat it as placeholder and
        // leave the name line blank rather than printing a wrong name.
        const nameCount = new Map();
        for (const l of leases) {
          const t = tenantById.get(l.tenant_id);
          const nm = t ? `${t.first_name || ''} ${t.last_name || ''}`.trim() : '';
          if (nm) nameCount.set(nm, (nameCount.get(nm) || 0) + 1);
        }
        const placeholder = [...nameCount.entries()].find(([, c]) => c >= 4)?.[0] || null;

        const built = sortRooms(roomsRes.data).map((room) => {
          const lease = leaseByRoom.get(room.id);
          const t = lease ? tenantById.get(lease.tenant_id) : null;
          const nm = t ? `${t.first_name || ''} ${t.last_name || ''}`.trim() : '';
          const m = meterByRoom.get(room.id);
          return {
            roomId: room.id,
            roomNumber: room.room_number,
            isNumbered: /^\d+$/.test(String(room.room_number).trim()),
            kind: roomKind(typeById.get(room.room_type_id)),
            tenantName: nm && nm !== placeholder ? nm : '',
            hasMeter: Boolean(m),
            eCur: m?.electric_current,
            ePrev: m?.electric_previous,
            eUnits: m ? m.electric_units ?? Number(m.electric_current) - Number(m.electric_previous) : null,
            wCur: m?.water_current,
            wPrev: m?.water_previous,
            wUnits: m ? m.water_units ?? Number(m.water_current) - Number(m.water_previous) : null,
          };
        });
        if (!cancelled) {
          setBills(built);
          setPlaceholderName(placeholder);
        }
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

  const shown = useMemo(
    () =>
      bills
        .filter((b) => includeOtherUnits || b.isNumbered)
        .map((b) => (showNames ? b : { ...b, tenantName: '' })),
    [bills, includeOtherUnits, showNames]
  );
  const missingMeter = shown.filter((b) => !b.hasMeter).map((b) => b.roomNumber);

  // pair bills two per A4 sheet
  const sheets = [];
  for (let i = 0; i < shown.length; i += 2) sheets.push(shown.slice(i, i + 2));

  const monthLabel = thaiMonth(billingMonth);
  const dateLabel = thaiDate(billDate);

  return (
    <div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
        .bill-sheet, .bill-sheet * { font-family: 'Sarabun', sans-serif; }
        .bill-sheet { width: 194mm; height: 281mm; display: flex; flex-direction: column; background: white; }
        .bill-half { height: 136mm; }
        .bill-cut { height: 9mm; display: flex; align-items: center; gap: 8px; color: #94a3b8; font-size: 9px; }
        .bill-cut::before, .bill-cut::after { content: ''; flex: 1; border-top: 1px dashed #cbd5e1; }
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          .bill-sheet { break-after: page; page-break-after: always; box-shadow: none !important; margin: 0 !important; }
          .bill-sheet:last-child { break-after: auto; page-break-after: auto; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="print:hidden">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">พิมพ์บิล (ฟอร์มจดหมายเวียน)</h1>
            <p className="mt-1 text-sm text-slate-500">
              ใส่เลขมิเตอร์ ก่อน/หลัง/หน่วย ให้อัตโนมัติ · ช่องจำนวนเงินเว้นว่างให้เจ้าของ/แอดมินคำนวณเอง · 2 บิลต่อ A4
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={loading || shown.length === 0}
            className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            🖨️ พิมพ์ {shown.length} บิล ({sheets.length} แผ่น)
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <label>
            ประจำเดือน{' '}
            <input type="month" value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)} className="ml-1 rounded-md border border-slate-300 px-2 py-1" />
          </label>
          <label>
            วันที่ออกบิล{' '}
            <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} className="ml-1 rounded-md border border-slate-300 px-2 py-1" />
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> ใส่ชื่อผู้เช่า
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={includeOtherUnits} onChange={(e) => setIncludeOtherUnits(e.target.checked)} /> รวมบ้าน/โกดังด้วย
          </label>
        </div>

        {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {!loading && placeholderName && showNames && (
          <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-800">
            ชื่อ "{placeholderName}" ซ้ำกันหลายห้อง (ชื่อตัวอย่างในระบบ) — เว้นช่องชื่อว่างไว้ให้เขียนเอง · แก้ชื่อจริงได้ที่หน้า ห้องพัก → แก้ไข
          </div>
        )}
        {!loading && missingMeter.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            ยังไม่กรอกมิเตอร์เดือนนี้ {missingMeter.length} ห้อง: {missingMeter.join(', ')} — บิลห้องเหล่านี้ช่องมิเตอร์จะว่าง
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">ตัวอย่างก่อนพิมพ์ ↓ (เวลาพิมพ์ ตั้งกระดาษ A4 แนวตั้ง, Margins: Default, เปิด "Background graphics")</p>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-slate-400">กำลังโหลด…</p>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-6 bg-slate-100 py-6 print:mt-0 print:block print:bg-white print:py-0">
          {sheets.map((pair, i) => (
            <div key={i} className="bill-sheet shadow-md">
              <div className="bill-half">
                <Bill b={pair[0]} monthLabel={monthLabel} dateLabel={dateLabel} />
              </div>
              {pair[1] && (
                <>
                  <div className="bill-cut">✂ รอยตัด (สำหรับแบ่งครึ่งกระดาษ A4) ✂</div>
                  <div className="bill-half">
                    <Bill b={pair[1]} monthLabel={monthLabel} dateLabel={dateLabel} />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
