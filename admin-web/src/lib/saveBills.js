import { supabase } from './supabaseClient';

// ----------------------------------------------------------------------------
// Save the bills shown on พิมพ์บิล (with the amounts the owner typed) as real
// bills, so LINE เช็กบิล / ส่งสลิป, payment verification, dashboard and
// reports all see this round.
//
// Conventions (owner decisions 2026-10-04/05):
//   billing_month = the meter-readings month (Sep usage -> '2026-10'), same as
//                   meter_readings, so it never collides with the old
//                   placeholder September bills (billing_month '2026-09').
//   issue_date    = the date printed on the bill (the 30th).
//   due_date      = the 5th of the readings month (= 5th of the month after
//                   the usage month), matching "ชำระภายในวันที่ 1-5".
//   status        = 'unpaid' (what the LINE bot looks for).
// A bill already paid or awaiting slip verification is never overwritten.
// ----------------------------------------------------------------------------

const BOT_URL = import.meta.env.VITE_BOT_URL || 'https://line-rental-manager.onrender.com';

export function parseAmount(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const round2 = (n) => Math.round(n * 100) / 100;

export function billAmounts(b) {
  const rent = parseAmount(b.amtRent) ?? 0;
  const elec = parseAmount(b.amtElec) ?? 0;
  const water = parseAmount(b.amtWater) ?? 0;
  const fine = parseAmount(b.amtFine) ?? 0;
  const other = parseAmount(b.amtOther) ?? 0;
  const typedTotal = parseAmount(b.total);
  const sum = rent + elec + water + fine + other;
  return { rent, elec, water, fine, other, total: typedTotal ?? sum, hasAny: sum > 0 || (typedTotal ?? 0) > 0 };
}

function itemRows(billId, b, a) {
  const eUnits = parseAmount(b.eUnits);
  const wUnits = parseAmount(b.wUnits);
  const row = (item_type, description, quantity, amount) => ({
    bill_id: billId,
    item_type,
    description,
    quantity,
    rate: quantity ? round2(amount / quantity) : amount,
    unit_price: quantity ? round2(amount / quantity) : amount,
    amount,
    calculated_amount: amount,
    final_amount: amount,
  });
  const rows = [row('rent', b.kind === 'air' ? 'ค่าเช่าห้อง (ห้องแอร์)' : b.kind === 'fan' ? 'ค่าเช่าห้อง (ห้องพัดลม)' : 'ค่าเช่าห้อง', 1, a.rent)];
  // Keep electricity / water rows even when they are 0 (owner types "0"), so
  // the saved bill shows 0 instead of a blank on every device and in LINE.
  const typed = (v) => parseAmount(v) !== null;
  if (typed(b.amtElec) || eUnits !== null) rows.push(row('electricity', 'ค่าไฟฟ้า', eUnits ?? 0, a.elec));
  if (typed(b.amtWater) || wUnits !== null) rows.push(row('water', 'ค่าน้ำประปา', wUnits ?? 0, a.water));
  if (a.fine) rows.push(row('late_fee', `ค่าปรับ${b.fineDays ? ` ${b.fineDays} วัน` : ''}`, 1, a.fine));
  if (a.other) rows.push(row('other', b.otherDesc || 'อื่น ๆ', 1, a.other));
  return rows;
}

// bills: the bill objects shown on the page (with edits merged).
// Returns [{ roomNumber, ok, billId, reason }].
export async function saveBills(bills, { readingsMonth, issueDate }, onProgress) {
  const dueDate = `${readingsMonth}-05`;
  const results = [];
  for (let i = 0; i < bills.length; i += 1) {
    const b = bills[i];
    onProgress?.(i + 1, bills.length, b.roomNumber);
    const a = billAmounts(b);
    try {
      if (!a.hasAny) {
        results.push({ roomNumber: b.roomNumber, ok: false, reason: 'ยังไม่ใส่จำนวนเงิน' });
        continue;
      }
      const { data: lease, error: lErr } = await supabase
        .from('leases')
        .select('id, tenant_id')
        .eq('room_id', b.roomId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (lErr) throw lErr;
      if (!lease) {
        results.push({ roomNumber: b.roomNumber, ok: false, reason: 'ไม่มีสัญญาเช่าที่ใช้งานอยู่' });
        continue;
      }
      const { data: existing, error: eErr } = await supabase
        .from('bills')
        .select('id, status')
        .eq('room_id', b.roomId)
        .eq('billing_month', readingsMonth)
        .limit(1)
        .maybeSingle();
      if (eErr) throw eErr;
      if (existing && ['paid', 'verifying'].includes(existing.status)) {
        results.push({
          roomNumber: b.roomNumber,
          ok: false,
          billId: existing.id,
          reason: existing.status === 'paid' ? 'บิลนี้ชำระแล้ว — ไม่แก้ไข' : 'ผู้เช่าส่งสลิปแล้ว รอตรวจ — ไม่แก้ไข',
        });
        continue;
      }
      const fields = {
        subtotal: round2(a.rent + a.elec + a.water + a.other),
        discount: 0,
        late_fee: round2(a.fine),
        total_amount: round2(a.total),
        issue_date: issueDate,
        due_date: dueDate,
      };
      let billId;
      if (existing) {
        const { error } = await supabase
          .from('bills')
          .update({ ...fields, ...(existing.status === 'overdue' ? {} : { status: 'unpaid' }) })
          .eq('id', existing.id);
        if (error) throw error;
        billId = existing.id;
      } else {
        const { data: ins, error } = await supabase
          .from('bills')
          .insert({
            ...fields,
            lease_id: lease.id,
            room_id: b.roomId,
            tenant_id: lease.tenant_id,
            billing_month: readingsMonth,
            status: 'unpaid',
          })
          .select('id')
          .single();
        if (error) throw error;
        billId = ins.id;
      }
      // Rebuild line items so a corrected amount never leaves stale rows.
      // Insert the new rows first, then remove the old ones, so a failed
      // insert never leaves the bill without items.
      const { data: oldItems, error: oErr } = await supabase.from('bill_items').select('id').eq('bill_id', billId);
      if (oErr) throw oErr;
      let rows = itemRows(billId, b, a);
      let { error: iErr } = await supabase.from('bill_items').insert(rows);
      if (iErr && iErr.code === '23514') {
        // bill_items_item_type_check rejected a type: keep the 3 core types
        // and record fine / other as 'other' with a clear description.
        rows = rows.map((r) => (['rent', 'electricity', 'water'].includes(r.item_type) ? r : { ...r, item_type: 'other' }));
        ({ error: iErr } = await supabase.from('bill_items').insert(rows));
      }
      if (iErr) throw iErr;
      const oldIds = (oldItems || []).map((r) => r.id);
      if (oldIds.length) {
        const { error: dErr } = await supabase.from('bill_items').delete().in('id', oldIds);
        if (dErr) throw dErr;
      }
      results.push({ roomNumber: b.roomNumber, ok: true, billId, tenantId: lease.tenant_id });
    } catch (err) {
      results.push({ roomNumber: b.roomNumber, ok: false, reason: err.message || String(err) });
    }
  }
  return results;
}

// Ask the LINE bot to push these bills to the tenants. The bot verifies the
// staff login token itself. Free Render instances may need ~1 min to wake up.
export async function sendBillsToLine(billIds) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('กรุณาล็อกอินใหม่');
  const res = await fetch(`${BOT_URL}/api/admin/send-bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bill_ids: billIds }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(body.error || `ระบบ LINE ตอบกลับผิดพลาด (${res.status})`);
  return body.results || [];
}
