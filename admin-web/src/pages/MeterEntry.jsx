import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthContext';
import { sortRooms } from '../lib/sortRooms';

// Rooms with a known broken/faulty water meter (see
// claude/meter-reading-form-upsert-fix.md, STEP 2 round 2, 2026-09-17 decision).
// For these rooms the owner enters the water UNITS directly rather than trusting
// the raw meter reading — set "เลขก่อนหน้า" = "เลขปัจจุบัน" (any equal pair passes
// the DB's previous<=current check) and then type the real units by hand.
const BROKEN_METER_ROOMS = new Set(['2', '24']);

function currentBillingMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function toNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function MeterEntry() {
  const { staff } = useAuth();
  const [billingMonth, setBillingMonth] = useState(currentBillingMonth());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]); // [{ roomId, roomNumber, electricPrevious, electricCurrent, electricUnits, waterPrevious, waterCurrent, waterUnits, existingId, saveState }]
  const [savingAll, setSavingAll] = useState(false);
  const [bannerMsg, setBannerMsg] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setBannerMsg(null);
      try {
        const [roomsRes, readingsRes] = await Promise.all([
          supabase.from('rooms').select('id, room_number').order('room_number'),
          // Pull every reading so we can find, per room, both this month's row
          // (if any) and the most recent PRIOR month's row to use as the
          // automatic "previous reading" baseline.
          supabase
            .from('meter_readings')
            .select('id, room_id, billing_month, electric_previous, electric_current, water_previous, water_current')
            .order('billing_month', { ascending: true }),
        ]);
        if (roomsRes.error) throw roomsRes.error;
        if (readingsRes.error) throw readingsRes.error;

        const allReadings = readingsRes.data || [];

        const built = sortRooms(roomsRes.data).map((room) => {
          const roomReadings = allReadings.filter((r) => r.room_id === room.id);
          const thisMonth = roomReadings.find((r) => r.billing_month === billingMonth) || null;
          const priorRows = roomReadings.filter((r) => r.billing_month < billingMonth);
          const priorMonth = priorRows.length > 0 ? priorRows[priorRows.length - 1] : null;

          const electricPrevious = thisMonth?.electric_previous ?? priorMonth?.electric_current ?? '';
          const waterPrevious = thisMonth?.water_previous ?? priorMonth?.water_current ?? '';
          const electricCurrent = thisMonth?.electric_current ?? '';
          const waterCurrent = thisMonth?.water_current ?? '';

          return {
            roomId: room.id,
            roomNumber: room.room_number,
            electricPrevious,
            electricCurrent,
            electricUnits: toNum(electricCurrent) !== null && toNum(electricPrevious) !== null
              ? toNum(electricCurrent) - toNum(electricPrevious)
              : '',
            waterPrevious,
            waterCurrent,
            waterUnits: toNum(waterCurrent) !== null && toNum(waterPrevious) !== null
              ? toNum(waterCurrent) - toNum(waterPrevious)
              : '',
            existingId: thisMonth?.id || null,
            hasAutoBaseline: Boolean(priorMonth),
            saveState: 'idle', // idle | saving | saved | error
            saveError: null,
          };
        });

        if (!cancelled) setRows(built);
      } catch (err) {
        if (!cancelled) setError(err.message || 'โหลดข้อมูลมิเตอร์ไม่สำเร็จ');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [billingMonth]);

  function updateRow(roomId, patch) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.roomId !== roomId) return r;
        const next = { ...r, ...patch, saveState: 'idle', saveError: null };
        // Auto-recompute units whenever previous/current change, unless the
        // caller is explicitly setting the units field itself (manual override —
        // used for broken-meter rooms per BROKEN_METER_ROOMS).
        if (!('electricUnits' in patch)) {
          const p = toNum(next.electricPrevious);
          const c = toNum(next.electricCurrent);
          next.electricUnits = p !== null && c !== null ? c - p : next.electricUnits;
        }
        if (!('waterUnits' in patch)) {
          const p = toNum(next.waterPrevious);
          const c = toNum(next.waterCurrent);
          next.waterUnits = p !== null && c !== null ? c - p : next.waterUnits;
        }
        return next;
      })
    );
  }

  async function saveRow(row) {
    const electricCurrent = toNum(row.electricCurrent);
    const waterCurrent = toNum(row.waterCurrent);
    if (electricCurrent === null && waterCurrent === null) {
      setRows((prev) =>
        prev.map((r) =>
          r.roomId === row.roomId
            ? { ...r, saveState: 'error', saveError: 'กรอกเลขมิเตอร์อย่างน้อยไฟฟ้าหรือน้ำ' }
            : r
        )
      );
      return false;
    }

    setRows((prev) => prev.map((r) => (r.roomId === row.roomId ? { ...r, saveState: 'saving', saveError: null } : r)));

    const payload = {
      room_id: row.roomId,
      billing_month: billingMonth,
      electric_previous: toNum(row.electricPrevious) ?? 0,
      electric_current: electricCurrent ?? 0,
      electric_units: toNum(row.electricUnits) ?? 0,
      water_previous: toNum(row.waterPrevious) ?? 0,
      water_current: waterCurrent ?? 0,
      water_units: toNum(row.waterUnits) ?? 0,
      recorded_by: staff?.id || null,
      recorded_at: new Date().toISOString(),
    };

    const { data, error: upsertError } = await supabase
      .from('meter_readings')
      .upsert(payload, { onConflict: 'room_id,billing_month' })
      .select('id')
      .single();

    if (upsertError) {
      setRows((prev) =>
        prev.map((r) =>
          r.roomId === row.roomId ? { ...r, saveState: 'error', saveError: upsertError.message } : r
        )
      );
      return false;
    }

    setRows((prev) =>
      prev.map((r) =>
        r.roomId === row.roomId ? { ...r, existingId: data?.id || r.existingId, saveState: 'saved' } : r
      )
    );
    return true;
  }

  async function saveAll() {
    setSavingAll(true);
    setBannerMsg(null);
    const candidates = rows.filter((r) => toNum(r.electricCurrent) !== null || toNum(r.waterCurrent) !== null);
    let okCount = 0;
    for (const row of candidates) {
      const ok = await saveRow(row);
      if (ok) okCount += 1;
    }
    setSavingAll(false);
    setBannerMsg(`บันทึกสำเร็จ ${okCount} จาก ${candidates.length} ห้องที่กรอกข้อมูล`);
  }

  const filledCount = useMemo(
    () => rows.filter((r) => toNum(r.electricCurrent) !== null || toNum(r.waterCurrent) !== null).length,
    [rows]
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">กรอกเลขมิเตอร์น้ำ-ไฟ</h1>
          <p className="mt-1 text-sm text-slate-500">
            เดือนที่บันทึก:{' '}
            <input
              type="month"
              value={billingMonth}
              onChange={(e) => setBillingMonth(e.target.value)}
              className="ml-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </p>
        </div>
        <button
          type="button"
          onClick={saveAll}
          disabled={savingAll || filledCount === 0}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {savingAll ? 'กำลังบันทึก…' : `บันทึกทั้งหมด (${filledCount})`}
        </button>
      </div>

      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        ห้อง/หน่วยที่มิเตอร์น้ำชำรุด (เช่น ห้อง 2, 24): ให้ใส่ "เลขก่อนหน้า" เท่ากับ "เลขปัจจุบัน" แล้วพิมพ์
        จำนวน "หน่วยน้ำ" ที่ต้องการคิดบิลด้วยตนเองในช่องขวาสุด ระบบจะใช้ตัวเลขที่พิมพ์ในช่องหน่วยเป็นหลัก
        ไม่คำนวณทับจากเลขมิเตอร์
      </div>

      {bannerMsg && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {bannerMsg}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
            <tr>
              <th rowSpan={2} className="px-4 py-3 align-bottom">ห้อง</th>
              <th colSpan={3} className="px-4 py-2 text-center">ไฟฟ้า</th>
              <th colSpan={3} className="px-4 py-2 text-center">น้ำ</th>
              <th rowSpan={2} className="px-4 py-3 align-bottom">บันทึก</th>
            </tr>
            <tr>
              <th className="px-4 py-2">เลขก่อนหน้า</th>
              <th className="px-4 py-2">เลขปัจจุบัน</th>
              <th className="px-4 py-2">หน่วย</th>
              <th className="px-4 py-2">เลขก่อนหน้า</th>
              <th className="px-4 py-2">เลขปัจจุบัน</th>
              <th className="px-4 py-2">หน่วย</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">กำลังโหลด…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">ยังไม่มีห้องในระบบ</td>
              </tr>
            ) : (
              rows.map((row) => {
                const isBroken = BROKEN_METER_ROOMS.has(String(row.roomNumber));
                return (
                  <tr
                    key={row.roomId}
                    className={`border-t border-slate-100 ${isBroken ? 'bg-amber-50/60' : ''}`}
                  >
                    <td className="px-4 py-2 font-medium text-slate-800">
                      ห้อง {row.roomNumber}
                      {isBroken && <span className="ml-1 text-xs text-amber-600">(มิเตอร์ชำรุด)</span>}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        value={row.electricPrevious}
                        onChange={(e) => updateRow(row.roomId, { electricPrevious: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        value={row.electricCurrent}
                        onChange={(e) => updateRow(row.roomId, { electricCurrent: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        value={row.electricUnits}
                        onChange={(e) => updateRow(row.roomId, { electricUnits: e.target.value })}
                        className="w-20 rounded-md border border-slate-300 px-2 py-1 font-semibold"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        value={row.waterPrevious}
                        onChange={(e) => updateRow(row.roomId, { waterPrevious: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        value={row.waterCurrent}
                        onChange={(e) => updateRow(row.roomId, { waterCurrent: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        value={row.waterUnits}
                        onChange={(e) => updateRow(row.roomId, { waterUnits: e.target.value })}
                        className="w-20 rounded-md border border-slate-300 px-2 py-1 font-semibold"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => saveRow(row)}
                        disabled={row.saveState === 'saving'}
                        className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {row.saveState === 'saving' ? '...' : row.existingId ? 'อัปเดต' : 'บันทึก'}
                      </button>
                      {row.saveState === 'saved' && <p className="mt-1 text-xs text-emerald-600">บันทึกแล้ว</p>}
                      {row.saveState === 'error' && (
                        <p className="mt-1 max-w-[160px] text-xs text-red-600">{row.saveError}</p>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
