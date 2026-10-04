import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { defaultReadingsMonth, usageMonthOf, thaiMonthName } from '../lib/billingMonth';
import { useAuth } from '../auth/AuthContext';
import { sortRooms } from '../lib/sortRooms';
import { cleanRaw, rawOr, padLike, isMissingRawColumn } from '../lib/meterText';

// Rooms with a known broken/faulty water meter (see
// claude/meter-reading-form-upsert-fix.md, STEP 2 round 2, 2026-09-17 decision).
// For these rooms the owner enters the water UNITS directly rather than trusting
// the raw meter reading — set "เลขก่อนหน้า" = "เลขปัจจุบัน" (any equal pair passes
// the DB's previous<=current check) and then type the real units by hand.
const BROKEN_METER_ROOMS = new Set(['2', '24']);

// Only a visual warning (never blocks saving): a typical room uses far less
// than this in a month, so a bigger number usually means decimal digits on the
// meter were typed in as whole units.
const HIGH_WATER_UNITS = 100;
const HIGH_ELECTRIC_UNITS = 1500;

// End-of-month billing: from the 25th the default moves to the next round
// (see lib/billingMonth.js).
function currentBillingMonth() {
  return defaultReadingsMonth();
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
  const [rawUnsupported, setRawUnsupported] = useState(false);

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
            .select('*')
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

          // Show readings as typed (keeps leading zeros, e.g. "0194"); fall back
          // to the numeric value for rows saved before the *_raw columns existed.
          const electricPrevious = thisMonth
            ? rawOr(thisMonth.electric_previous_raw, thisMonth.electric_previous)
            : priorMonth
              ? rawOr(priorMonth.electric_current_raw, priorMonth.electric_current)
              : '';
          const waterPrevious = thisMonth
            ? rawOr(thisMonth.water_previous_raw, thisMonth.water_previous)
            : priorMonth
              ? rawOr(priorMonth.water_current_raw, priorMonth.water_current)
              : '';
          const electricCurrent = thisMonth ? rawOr(thisMonth.electric_current_raw, thisMonth.electric_current) : '';
          const waterCurrent = thisMonth ? rawOr(thisMonth.water_current_raw, thisMonth.water_current) : '';

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
        // Units are generated in the DB as current - previous, so a manually
        // typed unit count (broken meters, rooms 2/24) is kept by moving
        // "previous" to current - units.
        if ('electricUnits' in patch) {
          const c = toNum(next.electricCurrent);
          const u = toNum(patch.electricUnits);
          if (c !== null && u !== null) next.electricPrevious = padLike(String(c - u), next.electricCurrent);
        } else {
          const p = toNum(next.electricPrevious);
          const c = toNum(next.electricCurrent);
          next.electricUnits = p !== null && c !== null ? c - p : next.electricUnits;
        }
        if ('waterUnits' in patch) {
          const c = toNum(next.waterCurrent);
          const u = toNum(patch.waterUnits);
          if (c !== null && u !== null) next.waterPrevious = padLike(String(c - u), next.waterCurrent);
        } else {
          const p = toNum(next.waterPrevious);
          const c = toNum(next.waterCurrent);
          next.waterUnits = p !== null && c !== null ? c - p : next.waterUnits;
        }
        return next;
      })
    );
  }

  // Things that look wrong but are the admin's call: shown in a confirm box,
  // and saved exactly as entered once the admin confirms.
  function rowWarnings(row) {
    const w = [];
    const eCur = toNum(row.electricCurrent);
    const wCur = toNum(row.waterCurrent);
    const eUnits = eCur !== null ? (toNum(row.electricPrevious) === null ? eCur : toNum(row.electricUnits)) : null;
    const wUnits = wCur !== null ? (toNum(row.waterPrevious) === null ? wCur : toNum(row.waterUnits)) : null;
    if (eCur !== null && toNum(row.electricPrevious) === null)
      w.push(`ไม่มีเลขไฟก่อนหน้า → จะคิดหน่วยไฟ = ${eCur} หน่วย (เลขปัจจุบันทั้งหมด)`);
    if (wCur !== null && toNum(row.waterPrevious) === null)
      w.push(`ไม่มีเลขน้ำก่อนหน้า → จะคิดหน่วยน้ำ = ${wCur} หน่วย (เลขปัจจุบันทั้งหมด)`);
    if (eUnits !== null && eUnits < 0) w.push(`หน่วยไฟติดลบ ${eUnits} → จะคิดเป็น ${Math.abs(eUnits)} หน่วย`);
    if (wUnits !== null && wUnits < 0) w.push(`หน่วยน้ำติดลบ ${wUnits} → จะคิดเป็น ${Math.abs(wUnits)} หน่วย`);
    if (eUnits !== null && Math.abs(eUnits) > HIGH_ELECTRIC_UNITS) w.push(`หน่วยไฟ ${Math.abs(eUnits)} หน่วย สูงผิดปกติ`);
    if (wUnits !== null && Math.abs(wUnits) > HIGH_WATER_UNITS) w.push(`หน่วยน้ำ ${Math.abs(wUnits)} หน่วย สูงผิดปกติ (มีทศนิยมไหม?)`);
    return w;
  }

  function confirmWarnings(list) {
    if (list.length === 0) return true;
    return window.confirm(
      `⚠️ ตรวจพบตัวเลขที่ควรตรวจสอบ:\n\n${list.join('\n')}\n\nกด "ตกลง" เพื่อยืนยันและบันทึกตามที่กรอก\nกด "ยกเลิก" เพื่อกลับไปแก้ไข`
    );
  }

  async function saveRow(row, { skipConfirm = false } = {}) {
    if (!skipConfirm) {
      const w = rowWarnings(row);
      if (!confirmWarnings(w.map((x) => `ห้อง ${row.roomNumber}: ${x}`))) return false;
    }
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

    const fail = (msg) => {
      setRows((prev) => prev.map((r) => (r.roomId === row.roomId ? { ...r, saveState: 'error', saveError: msg } : r)));
      return false;
    };
    // Missing "previous" is allowed once confirmed (rowWarnings): it's stored
    // as 0, so units = the whole current reading — exactly what the admin saw.
    let electricPrevious = toNum(row.electricPrevious);
    let waterPrevious = toNum(row.waterPrevious);
    // Negative units (current < previous, e.g. broken or replaced meter): the
    // DB can't store them (it requires previous <= current), so — once the
    // admin has confirmed (rowWarnings) — bill the absolute value instead:
    // keep the real current reading and set previous = current - |units|.
    if (electricCurrent !== null && electricPrevious !== null && electricCurrent < electricPrevious) {
      electricPrevious = electricCurrent - Math.abs(electricCurrent - electricPrevious);
    }
    if (waterCurrent !== null && waterPrevious !== null && waterCurrent < waterPrevious) {
      waterPrevious = waterCurrent - Math.abs(waterCurrent - waterPrevious);
    }
    // Text exactly as typed (leading zeros kept). A "previous" that had to be
    // recomputed is padded to the same width as the current reading.
    const eCurRaw = cleanRaw(row.electricCurrent);
    const wCurRaw = cleanRaw(row.waterCurrent);
    const ePrevRaw =
      electricPrevious === null
        ? ''
        : electricPrevious === toNum(row.electricPrevious)
          ? padLike(cleanRaw(row.electricPrevious), eCurRaw)
          : padLike(String(electricPrevious), eCurRaw);
    const wPrevRaw =
      waterPrevious === null
        ? ''
        : waterPrevious === toNum(row.waterPrevious)
          ? padLike(cleanRaw(row.waterPrevious), wCurRaw)
          : padLike(String(waterPrevious), wCurRaw);
    const fixedRow = {
      electricPrevious: ePrevRaw,
      waterPrevious: wPrevRaw,
      electricUnits: electricCurrent !== null && electricPrevious !== null ? electricCurrent - electricPrevious : row.electricUnits,
      waterUnits: waterCurrent !== null && waterPrevious !== null ? waterCurrent - waterPrevious : row.waterUnits,
    };

    setRows((prev) => prev.map((r) => (r.roomId === row.roomId ? { ...r, saveState: 'saving', saveError: null } : r)));

    // If only one of electric/water was filled, the other used to save
    // current = 0 (fails the DB's previous<=current check, or bills a wrong
    // amount). Keep the unfilled side at "no usage": current = previous, 0 units.
    // electric_units / water_units are GENERATED columns in the DB
    // (current - previous) — they can't be written, only derived. A manually
    // typed unit count is therefore stored by adjusting "previous" (see
    // updateRow), so current - previous == the units the owner chose.
    const payload = {
      room_id: row.roomId,
      billing_month: billingMonth,
      electric_previous: electricPrevious ?? 0,
      electric_current: electricCurrent ?? electricPrevious ?? 0,
      water_previous: waterPrevious ?? 0,
      water_current: waterCurrent ?? waterPrevious ?? 0,
      recorded_by: staff?.id || null,
      recorded_at: new Date().toISOString(),
    };
    const rawFields = {
      electric_previous_raw: ePrevRaw || null,
      electric_current_raw: (electricCurrent !== null ? eCurRaw : ePrevRaw) || null,
      water_previous_raw: wPrevRaw || null,
      water_current_raw: (waterCurrent !== null ? wCurRaw : wPrevRaw) || null,
    };

    const upsert = (body) =>
      supabase.from('meter_readings').upsert(body, { onConflict: 'room_id,billing_month' }).select('id').single();
    let { data, error: upsertError } = await upsert(rawUnsupported ? payload : { ...payload, ...rawFields });
    // Raw-text columns not added yet (SQL 003 not run): save the numbers anyway.
    if (upsertError && isMissingRawColumn(upsertError)) {
      setRawUnsupported(true);
      ({ data, error: upsertError } = await upsert(payload));
    }

    if (upsertError) {
      const m = upsertError.message || '';
      const msg = /type integer|invalid input syntax/i.test(m)
        ? 'ระบบรับเฉพาะจำนวนเต็ม — กรุณาปัดเศษหน่วย/เลขมิเตอร์ให้เป็นจำนวนเต็มก่อนบันทึก'
        : /check constraint/i.test(m)
          ? 'เลขก่อนหน้ามากกว่าเลขปัจจุบัน — พิมพ์จำนวนหน่วยที่ต้องการคิดในช่องหน่วยแทน'
          : m;
      setRows((prev) =>
        prev.map((r) => (r.roomId === row.roomId ? { ...r, saveState: 'error', saveError: msg } : r))
      );
      return false;
    }

    setRows((prev) =>
      prev.map((r) =>
        r.roomId === row.roomId ? { ...r, ...fixedRow, existingId: data?.id || r.existingId, saveState: 'saved' } : r
      )
    );
    return true;
  }

  async function saveAll() {
    const candidates = rows.filter((r) => toNum(r.electricCurrent) !== null || toNum(r.waterCurrent) !== null);
    // One confirm box listing every room's warnings, instead of one per room.
    const allWarnings = candidates.flatMap((r) => rowWarnings(r).map((x) => `ห้อง ${r.roomNumber}: ${x}`));
    if (!confirmWarnings(allWarnings)) return;

    setSavingAll(true);
    setBannerMsg(null);
    let okCount = 0;
    for (const row of candidates) {
      const ok = await saveRow(row, { skipConfirm: true });
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
            <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
              = บิลประจำเดือน{thaiMonthName(usageMonthOf(billingMonth))}
            </span>
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
        <b>บิลคิดตามตัวเลขในช่อง "หน่วย" เสมอ</b> — ทุกห้องแก้จำนวนหน่วยเองได้ (เพิ่ม/ลด/ปัดทศนิยม) โดยใส่
        "เลขปัจจุบัน" ก่อน แล้วพิมพ์จำนวนหน่วยที่ต้องการคิดในช่องหน่วย ระบบจะปรับ "เลขก่อนหน้า" ให้เอง
        (ก่อนหน้า = ปัจจุบัน − หน่วย) · ช่องหน่วยสีเหลือง = หน่วยสูงผิดปกติ ตรวจก่อนบันทึก
      </div>

      {rawUnsupported && (
        <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          บันทึกตัวเลขได้ตามปกติ แต่ยังเก็บเลข 0 นำหน้าไม่ได้ — ให้เจ้าของรันไฟล์ SQL{' '}
          <code>003_meter_raw_text.sql</code> ใน Supabase ก่อน (ครั้งเดียว)
        </div>
      )}
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
                        type="text"
                        inputMode="decimal"
                        value={row.electricPrevious}
                        onChange={(e) => updateRow(row.roomId, { electricPrevious: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.electricCurrent}
                        onChange={(e) => updateRow(row.roomId, { electricCurrent: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        step="any"
                        value={row.electricUnits}
                        onChange={(e) => updateRow(row.roomId, { electricUnits: e.target.value })}
                        className={`w-24 rounded-md border px-2 py-1 font-semibold ${
                          toNum(row.electricUnits) > HIGH_ELECTRIC_UNITS ? 'border-amber-400 bg-amber-50' : 'border-slate-300'
                        }`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.waterPrevious}
                        onChange={(e) => updateRow(row.roomId, { waterPrevious: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.waterCurrent}
                        onChange={(e) => updateRow(row.roomId, { waterCurrent: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        step="any"
                        value={row.waterUnits}
                        onChange={(e) => updateRow(row.roomId, { waterUnits: e.target.value })}
                        className={`w-24 rounded-md border px-2 py-1 font-semibold ${
                          toNum(row.waterUnits) > HIGH_WATER_UNITS ? 'border-amber-400 bg-amber-50' : 'border-slate-300'
                        }`}
                      />
                      {toNum(row.waterUnits) > HIGH_WATER_UNITS && (
                        <p className="mt-0.5 max-w-[110px] text-[10px] leading-tight text-amber-700">สูงผิดปกติ — มีทศนิยมไหม?</p>
                      )}
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
