import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// ----------------------------------------------------------------------------
// One modal for two jobs, opened from the Rooms page:
//   mode 'edit'   — room has an active lease: edit tenant name/phone and (owner
//                   only) the lease's rent / deposit / electric+water rate / start.
//   mode 'create' — room is vacant: create a tenant + active lease and mark the
//                   room occupied.
// Column names mirror what the LINE bot and the 2026-10-02 new-units insert
// already write (tenants: first_name, last_name, phone, status;
// leases: room_id, tenant_id, monthly_rent, deposit, electric_rate,
// water_rate, start_date, move_in_date, status).
// Leaving electric/water rate blank keeps them NULL, which Generate Bill
// treats as "not ready to bill" — that safety lock is intentional.
// ----------------------------------------------------------------------------

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function toInput(v) {
  return v === null || v === undefined ? '' : String(v);
}

export default function LeaseEditor({ room, canEditPricing, canEditTenant, onClose, onSaved }) {
  const mode = room.lease ? 'edit' : 'create';
  const lease = room.lease || {};
  const tenant = room.tenant || {};

  const [form, setForm] = useState({
    firstName: tenant.first_name || '',
    lastName: tenant.last_name || '',
    phone: tenant.phone || '',
    monthlyRent: toInput(mode === 'edit' ? lease.monthly_rent : room.defaultRent),
    deposit: toInput(lease.deposit),
    electricRate: toInput(lease.electric_rate),
    waterRate: toInput(lease.water_rate),
    startDate: lease.start_date || todayStr(),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  function friendly(err) {
    const m = err?.message || 'บันทึกไม่สำเร็จ';
    return /row-level security|permission/i.test(m) ? `ฐานข้อมูลยังไม่อนุญาตให้บัญชีนี้แก้ไขข้อมูลนี้ (RLS) — ${m}` : m;
  }

  async function save(e) {
    e.preventDefault();
    setError(null);

    if (!form.firstName.trim()) {
      setError('กรุณากรอกชื่อผู้เช่า');
      return;
    }

    const pricing = {
      monthly_rent: numOrNull(form.monthlyRent),
      deposit: numOrNull(form.deposit),
      electric_rate: numOrNull(form.electricRate),
      water_rate: numOrNull(form.waterRate),
    };
    if (canEditPricing) {
      for (const [k, v] of Object.entries(pricing)) {
        if (Number.isNaN(v) || (v !== null && v < 0)) {
          setError('ตัวเลขค่าเช่า/เงินประกัน/เรทค่าน้ำไฟ ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
          return;
        }
        if (k === 'monthly_rent' && v === null) {
          setError('กรุณากรอกค่าเช่ารายเดือน (ใส่ 0 ได้ถ้ายังไม่กำหนด)');
          return;
        }
      }
    }

    setSaving(true);
    try {
      const tenantFields = {
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        phone: form.phone.trim() || null,
      };

      if (mode === 'edit') {
        if (canEditTenant && tenant.id) {
          const { error: tErr } = await supabase.from('tenants').update(tenantFields).eq('id', tenant.id);
          if (tErr) throw tErr;
        }
        if (canEditPricing && lease.id) {
          const { error: lErr } = await supabase
            .from('leases')
            .update({ ...pricing, start_date: form.startDate || null })
            .eq('id', lease.id);
          if (lErr) throw lErr;
        }
        onSaved(`บันทึกข้อมูลห้อง ${room.room_number} แล้ว`);
      } else {
        // 1) tenant
        const { data: newTenant, error: tErr } = await supabase
          .from('tenants')
          .insert([{ ...tenantFields, status: 'active' }])
          .select('id')
          .single();
        if (tErr) throw tErr;

        // 2) lease — pricing only if this user may set it; otherwise rent falls
        //    back to the room type's default and rates stay NULL (owner sets
        //    them later; billing is blocked until then).
        const leaseRow = {
          room_id: room.id,
          tenant_id: newTenant.id,
          status: 'active',
          start_date: form.startDate || todayStr(),
          move_in_date: form.startDate || todayStr(),
          monthly_rent: canEditPricing ? pricing.monthly_rent : room.defaultRent ?? 0,
          deposit: canEditPricing ? pricing.deposit ?? 0 : 0,
          electric_rate: canEditPricing ? pricing.electric_rate : null,
          water_rate: canEditPricing ? pricing.water_rate : null,
        };
        const { error: lErr } = await supabase.from('leases').insert([leaseRow]);
        if (lErr) {
          // Don't leave an orphan tenant behind if the lease couldn't be made.
          await supabase.from('tenants').delete().eq('id', newTenant.id);
          throw lErr;
        }

        // 3) room
        const { error: rErr } = await supabase.from('rooms').update({ status: 'occupied' }).eq('id', room.id);
        if (rErr) throw rErr;

        onSaved(`เพิ่มผู้เช่าเข้าห้อง ${room.room_number} แล้ว`);
      }
    } catch (err) {
      setError(friendly(err));
    } finally {
      setSaving(false);
    }
  }

  const input = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500';
  const label = 'block text-sm font-medium text-slate-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => !saving && onClose()}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-slate-900">
          {mode === 'edit' ? `แก้ไขข้อมูล ห้อง ${room.room_number}` : `เพิ่มผู้เช่า ห้อง ${room.room_number}`}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">{room.roomTypeName}</p>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">ผู้เช่า</p>
        <div className="mt-1 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>ชื่อ *</label>
            <input value={form.firstName} onChange={set('firstName')} disabled={!canEditTenant} className={input} />
          </div>
          <div>
            <label className={label}>นามสกุล</label>
            <input value={form.lastName} onChange={set('lastName')} disabled={!canEditTenant} className={input} />
          </div>
        </div>
        <label className={`${label} mt-3`}>เบอร์โทร</label>
        <input
          value={form.phone}
          onChange={set('phone')}
          disabled={!canEditTenant}
          inputMode="tel"
          placeholder="08xxxxxxxx"
          className={input}
        />

        {canEditPricing ? (
          <>
            <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">สัญญาเช่า</p>
            <div className="mt-1 grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label}>ค่าเช่า/เดือน (บาท) *</label>
                <input value={form.monthlyRent} onChange={set('monthlyRent')} inputMode="decimal" className={input} />
              </div>
              <div>
                <label className={label}>เงินประกัน (บาท)</label>
                <input value={form.deposit} onChange={set('deposit')} inputMode="decimal" className={input} />
              </div>
              <div>
                <label className={label}>ค่าไฟ (บาท/หน่วย)</label>
                <input value={form.electricRate} onChange={set('electricRate')} inputMode="decimal" placeholder="เช่น 8" className={input} />
              </div>
              <div>
                <label className={label}>ค่าน้ำ (บาท/หน่วย)</label>
                <input value={form.waterRate} onChange={set('waterRate')} inputMode="decimal" placeholder="เช่น 18" className={input} />
              </div>
            </div>
            <label className={`${label} mt-3`}>วันเริ่มสัญญา</label>
            <input type="date" value={form.startDate} onChange={set('startDate')} className={input} />
            <p className="mt-2 text-xs text-slate-500">
              เว้นค่าไฟ/ค่าน้ำว่างไว้ = ระบบจะยังไม่ออกบิลให้ห้องนี้ (กันออกบิลผิด) · ไม่คิดค่าน้ำหรือไฟ ให้ใส่ 0
            </p>
          </>
        ) : (
          mode === 'create' && (
            <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ค่าเช่าจะใช้ราคาตั้งต้นของประเภทห้องไปก่อน และยังไม่ตั้งเรทค่าน้ำ/ไฟ — ให้เจ้าของเข้ามาตั้งค่าก่อนออกบิล
            </p>
          )
        )}

        {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? 'กำลังบันทึก…' : mode === 'edit' ? 'บันทึก' : 'เพิ่มผู้เช่า'}
          </button>
        </div>
      </form>
    </div>
  );
}
