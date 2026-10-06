import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { defaultReadingsMonth, usageMonthOf, thaiMonthName } from '../lib/billingMonth';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { sortRooms } from '../lib/sortRooms';

// End-of-month billing: from the 25th the default moves to the next round
// (see lib/billingMonth.js).
function currentBillingMonth() {
  return defaultReadingsMonth();
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const THB = (n) => `${Number(n || 0).toLocaleString('th-TH')} บาท`;

export default function BillGeneration() {
  const { staff } = useAuth();
  const canGenerate = can(staff?.role, 'GENERATE_BILL');

  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState('');
  const [billingMonth, setBillingMonth] = useState(currentBillingMonth());
  const [discount, setDiscount] = useState(0);

  const [loadingRooms, setLoadingRooms] = useState(true);
  const [preview, setPreview] = useState(null); // computed preview object, or null
  const [blockReason, setBlockReason] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resultMsg, setResultMsg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingRooms(true);
      const { data, error: err } = await supabase.from('rooms').select('id, room_number').order('room_number');
      if (!cancelled) {
        if (err) setError(err.message);
        else setRooms(sortRooms(data));
        setLoadingRooms(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function buildPreview() {
    setPreview(null);
    setBlockReason(null);
    setResultMsg(null);
    setError(null);
    if (!roomId) return;
    setPreviewing(true);
    try {
      const room = rooms.find((r) => r.id === roomId);

      const leaseRes = await supabase
        .from('leases')
        .select('id, tenant_id, monthly_rent, electric_rate, water_rate, status')
        .eq('room_id', roomId)
        .eq('status', 'active')
        .maybeSingle();
      if (leaseRes.error) throw leaseRes.error;
      const lease = leaseRes.data;
      if (!lease) {
        setBlockReason('ห้องนี้ยังไม่มีสัญญาเช่าที่ "active" — ไม่สามารถออกบิลได้');
        return;
      }
      if (lease.electric_rate == null || lease.water_rate == null) {
        setBlockReason('สัญญานี้ยังไม่ได้ตั้งค่าอัตราค่าไฟฟ้า/น้ำ (electric_rate / water_rate) — ไปตั้งค่าที่หน้าผู้เช่า/สัญญาก่อน');
        return;
      }

      const meterRes = await supabase
        .from('meter_readings')
        .select('electric_units, water_units')
        .eq('room_id', roomId)
        .eq('billing_month', billingMonth)
        .maybeSingle();
      if (meterRes.error) throw meterRes.error;
      const meter = meterRes.data;
      if (!meter) {
        setBlockReason(`ยังไม่มีการกรอกมิเตอร์สำหรับเดือน ${billingMonth} — ไปกรอกที่หน้า "มิเตอร์" ก่อน`);
        return;
      }

      const existingBillRes = await supabase
        .from('bills')
        .select('id, bill_number, late_fee, status')
        .eq('room_id', roomId)
        .eq('billing_month', billingMonth)
        .maybeSingle();
      if (existingBillRes.error) throw existingBillRes.error;
      const existingBill = existingBillRes.data;

      const rentAmount = Number(lease.monthly_rent || 0);
      const electricAmount = Number(meter.electric_units || 0) * Number(lease.electric_rate);
      const waterAmount = Number(meter.water_units || 0) * Number(lease.water_rate);
      const lateFee = Number(existingBill?.late_fee || 0);
      const subtotal = rentAmount + electricAmount + waterAmount;
      const totalAmount = subtotal + lateFee - Number(discount || 0);

      const issueDate = new Date().toISOString().slice(0, 10);
      const dueDate = addDays(issueDate, 5);

      setPreview({
        room,
        lease,
        meter,
        existingBill,
        items: [
          // `type` must be one of the DB's allowed bill_items.item_type values
          // (bill_items_item_type_check) — the Thai label is only for display.
          { type: 'rent', label: 'ค่าเช่า', description: 'ค่าเช่าห้อง', units: null, rate: null, amount: rentAmount },
          { type: 'electricity', label: 'ค่าไฟฟ้า', description: 'ค่าไฟฟ้า', units: meter.electric_units, rate: lease.electric_rate, amount: electricAmount },
          { type: 'water', label: 'ค่าน้ำ', description: 'ค่าน้ำประปา', units: meter.water_units, rate: lease.water_rate, amount: waterAmount },
        ],
        subtotal,
        lateFee,
        discount: Number(discount || 0),
        totalAmount,
        issueDate,
        dueDate,
      });
    } catch (err) {
      setError(err.message || 'คำนวณบิลไม่สำเร็จ');
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmBill() {
    if (!preview) return;
    setSaving(true);
    setError(null);
    setResultMsg(null);
    try {
      let billId = preview.existingBill?.id || null;
      if (preview.existingBill && ['paid', 'verifying'].includes(preview.existingBill.status)) {
        throw new Error(
          preview.existingBill.status === 'paid'
            ? 'บิลนี้ชำระแล้ว — ไม่แก้ไข'
            : 'ผู้เช่าส่งสลิปแล้ว รอตรวจ — ไม่แก้ไข (ตรวจสลิปก่อน)'
        );
      }

      if (billId) {
        const { error: updErr } = await supabase
          .from('bills')
          .update({
            subtotal: preview.subtotal,
            discount: preview.discount,
            late_fee: preview.lateFee,
            total_amount: preview.totalAmount,
          })
          .eq('id', billId);
        if (updErr) throw updErr;
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from('bills')
          .insert({
            lease_id: preview.lease.id,
            room_id: preview.room.id,
            tenant_id: preview.lease.tenant_id,
            billing_month: billingMonth,
            issue_date: preview.issueDate,
            due_date: preview.dueDate,
            subtotal: preview.subtotal,
            discount: preview.discount,
            late_fee: preview.lateFee,
            total_amount: preview.totalAmount,
            // 'unpaid' = DB default / what the LINE bot looks for (not 'pending').
            status: 'unpaid',
          })
          .select('id, bill_number')
          .single();
        if (insErr) throw insErr;
        billId = inserted.id;
      }

      // Replace bill_items: insert the new rows first, then remove the old
      // ones, so a failed insert never leaves the bill with no line items.
      const { data: oldItems, error: oldErr } = await supabase.from('bill_items').select('id').eq('bill_id', billId);
      if (oldErr) throw oldErr;

      const itemRows = preview.items
        .filter((item) => item.amount !== 0 || item.type === 'rent' || item.units != null)
        .map((item) => ({
          bill_id: billId,
          item_type: item.type,
          description: item.description,
          quantity: item.units ?? 1,
          unit_price: item.rate ?? item.amount,
          amount: item.amount,
          calculated_amount: item.amount,
          final_amount: item.amount,
          rate: item.rate ?? null,
        }));
      const { error: itemsErr } = await supabase.from('bill_items').insert(itemRows);
      if (itemsErr) throw itemsErr;

      const oldIds = (oldItems || []).map((r) => r.id);
      if (oldIds.length) {
        const { error: delErr } = await supabase.from('bill_items').delete().in('id', oldIds);
        if (delErr) throw delErr;
      }

      setResultMsg(
        preview.existingBill
          ? `อัปเดตบิล ${preview.existingBill.bill_number} เรียบร้อย — ยอดรวมใหม่ ${THB(preview.totalAmount)}`
          : `สร้างบิลใหม่สำเร็จ — ยอดรวม ${THB(preview.totalAmount)}`
      );
      // Refresh preview to reflect the saved existingBill state.
      buildPreview();
    } catch (err) {
      setError(err.message || 'บันทึกบิลไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">ออกบิล</h1>
      <p className="mt-1 text-sm text-slate-500">เลือกห้องและเดือน ระบบจะตรวจสัญญา/มิเตอร์ และคำนวณยอดให้ตรวจสอบก่อนยืนยัน</p>

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="block text-xs text-slate-500">ห้อง</label>
          <select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">-- เลือกห้อง --</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                ห้อง {r.room_number}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500">เดือนบิล</label>
          <input
            type="month"
            value={billingMonth}
            onChange={(e) => setBillingMonth(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500">ส่วนลด (ถ้ามี)</label>
          <input
            type="number"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            className="mt-1 w-28 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={buildPreview}
          disabled={!roomId || previewing || loadingRooms}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {previewing ? 'กำลังตรวจสอบ…' : 'ตรวจรายการ'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {blockReason && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {blockReason}
        </div>
      )}
      {resultMsg && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {resultMsg}
        </div>
      )}

      {preview && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">
              ห้อง {preview.room.room_number} — เดือน {billingMonth}
            </h2>
            <span className="text-xs text-slate-400">
              {preview.existingBill ? `บิลเดิม: ${preview.existingBill.bill_number} (จะอัปเดต)` : 'บิลใหม่'}
            </span>
          </div>

          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs font-semibold text-slate-500">
              <tr>
                <th className="py-1.5">รายการ</th>
                <th className="py-1.5">หน่วย</th>
                <th className="py-1.5">ราคา/หน่วย</th>
                <th className="py-1.5 text-right">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((item) => (
                <tr key={item.label} className="border-t border-slate-100">
                  <td className="py-1.5">{item.label}</td>
                  <td className="py-1.5">{item.units ?? '-'}</td>
                  <td className="py-1.5">{item.rate != null ? Number(item.rate).toLocaleString('th-TH') : '-'}</td>
                  <td className="py-1.5 text-right">{THB(item.amount)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-200">
                <td colSpan={3} className="py-1.5 text-slate-500">ยอดรวมก่อนปรับ (subtotal)</td>
                <td className="py-1.5 text-right">{THB(preview.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="py-1.5 text-slate-500">ค่าปรับล่าช้า</td>
                <td className="py-1.5 text-right">{THB(preview.lateFee)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="py-1.5 text-slate-500">ส่วนลด</td>
                <td className="py-1.5 text-right">-{THB(preview.discount)}</td>
              </tr>
              <tr className="border-t border-slate-200 font-semibold text-slate-900">
                <td colSpan={3} className="py-2">ยอดรวมสุทธิ</td>
                <td className="py-2 text-right">{THB(preview.totalAmount)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-400">
            วันที่ออกบิล {preview.issueDate} · ครบกำหนดชำระ {preview.dueDate}
          </p>

          <div className="mt-4">
            {canGenerate ? (
              <button
                type="button"
                onClick={confirmBill}
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? 'กำลังบันทึก…' : preview.existingBill ? 'ยืนยันอัปเดตบิล' : 'ยืนยันออกบิล'}
              </button>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-500">
                บัญชีของคุณ ({staff?.role || '-'}) ไม่มีสิทธิ์ยืนยันออกบิล — ดูตัวอย่างได้เท่านั้น
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
