import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { compareRoomNumbers } from '../lib/sortRooms';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const EMPTY_FORM = () => ({ leaseId: '', date: todayStr(), reason: '' });

const STATUS_LABEL = { pending: 'รอดำเนินการ', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ' };

export default function MoveOut() {
  const { staff } = useAuth();
  const canManage = can(staff?.role, 'MANAGE_MOVE_OUT');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [rows, setRows] = useState([]);
  const [actingId, setActingId] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM());
  const [leaseOptions, setLeaseOptions] = useState(null); // null = loading
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const reqRes = await supabase
        .from('move_out_requests')
        .select('id, lease_id, tenant_id, room_id, requested_move_out_date, reason, status, created_at')
        .order('created_at', { ascending: false });
      if (reqRes.error) throw reqRes.error;
      const data = reqRes.data || [];

      const tenantIds = [...new Set(data.map((r) => r.tenant_id).filter(Boolean))];
      const roomIds = [...new Set(data.map((r) => r.room_id).filter(Boolean))];
      const [tenantsRes, roomsRes] = await Promise.all([
        tenantIds.length
          ? supabase.from('tenants').select('id, first_name, last_name').in('id', tenantIds)
          : Promise.resolve({ data: [] }),
        roomIds.length ? supabase.from('rooms').select('id, room_number').in('id', roomIds) : Promise.resolve({ data: [] }),
      ]);
      if (tenantsRes.error) throw tenantsRes.error;
      if (roomsRes.error) throw roomsRes.error;
      const tenantsById = new Map((tenantsRes.data || []).map((t) => [t.id, t]));
      const roomsById = new Map((roomsRes.data || []).map((r) => [r.id, r]));

      setRows(
        data.map((r) => ({
          ...r,
          tenantName: tenantsById.get(r.tenant_id)
            ? `${tenantsById.get(r.tenant_id).first_name || ''} ${tenantsById.get(r.tenant_id).last_name || ''}`.trim()
            : '-',
          roomNumber: roomsById.get(r.room_id)?.room_number || '-',
        }))
      );
    } catch (err) {
      setError(err.message || 'โหลดคำขอย้ายออกไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Only rooms with an active lease can move out — load those (with tenant
  // name) for the picker, sorted 1, 2, 3 ...
  async function openForm() {
    setForm(EMPTY_FORM());
    setFormError(null);
    setMsg(null);
    setLeaseOptions(null);
    setShowForm(true);
    try {
      const leasesRes = await supabase.from('leases').select('id, room_id, tenant_id').eq('status', 'active');
      if (leasesRes.error) throw leasesRes.error;
      const leases = leasesRes.data || [];
      const roomIds = [...new Set(leases.map((l) => l.room_id).filter(Boolean))];
      const tenantIds = [...new Set(leases.map((l) => l.tenant_id).filter(Boolean))];
      const [roomsRes, tenantsRes] = await Promise.all([
        roomIds.length ? supabase.from('rooms').select('id, room_number').in('id', roomIds) : Promise.resolve({ data: [] }),
        tenantIds.length
          ? supabase.from('tenants').select('id, first_name, last_name').in('id', tenantIds)
          : Promise.resolve({ data: [] }),
      ]);
      if (roomsRes.error) throw roomsRes.error;
      if (tenantsRes.error) throw tenantsRes.error;
      const roomsById = new Map((roomsRes.data || []).map((r) => [r.id, r]));
      const tenantsById = new Map((tenantsRes.data || []).map((t) => [t.id, t]));
      const pendingLeaseIds = new Set(rows.filter((r) => r.status === 'pending').map((r) => r.lease_id));

      const options = leases
        .map((l) => {
          const t = tenantsById.get(l.tenant_id);
          return {
            ...l,
            roomNumber: roomsById.get(l.room_id)?.room_number || '-',
            tenantName: t ? `${t.first_name || ''} ${t.last_name || ''}`.trim() : '',
            hasPending: pendingLeaseIds.has(l.id),
          };
        })
        .sort((a, b) => compareRoomNumbers(a.roomNumber, b.roomNumber));
      setLeaseOptions(options);
    } catch (err) {
      setLeaseOptions([]);
      setFormError(err.message || 'โหลดรายการห้องไม่สำเร็จ');
    }
  }

  async function createRequest(e) {
    e.preventDefault();
    setFormError(null);
    const lease = (leaseOptions || []).find((l) => l.id === form.leaseId);
    if (!lease) {
      setFormError('กรุณาเลือกห้อง');
      return;
    }
    if (lease.hasPending) {
      setFormError(`ห้อง ${lease.roomNumber} มีคำขอย้ายออกที่รอดำเนินการอยู่แล้ว`);
      return;
    }
    if (!form.date) {
      setFormError('กรุณาเลือกวันที่ย้ายออก');
      return;
    }
    setSaving(true);
    try {
      // Same shape the LINE bot inserts. Always 'pending' — ending the lease
      // and freeing the room still requires the separate อนุมัติ click below.
      const { error: insErr } = await supabase.from('move_out_requests').insert([
        {
          lease_id: lease.id,
          tenant_id: lease.tenant_id,
          room_id: lease.room_id,
          requested_move_out_date: form.date,
          reason: form.reason.trim() || null,
          status: 'pending',
        },
      ]);
      if (insErr) throw insErr;
      setShowForm(false);
      setMsg(`เพิ่มคำขอย้ายออกห้อง ${lease.roomNumber} แล้ว — สถานะ "รอดำเนินการ" กดอนุมัติเมื่อพร้อม`);
      await load();
    } catch (err) {
      const m = err.message || 'บันทึกไม่สำเร็จ';
      setFormError(
        /row-level security|permission/i.test(m) ? `ฐานข้อมูลยังไม่อนุญาตให้บัญชีนี้เพิ่มคำขอย้ายออก (RLS) — ${m}` : m
      );
    } finally {
      setSaving(false);
    }
  }

  async function decide(request, approve) {
    setActingId(request.id);
    setError(null);
    setMsg(null);
    try {
      if (approve) {
        const today = new Date().toISOString().slice(0, 10);
        const moveOutDate = request.requested_move_out_date || today;

        if (request.lease_id) {
          const { error: leaseErr } = await supabase
            .from('leases')
            .update({ status: 'ended', end_date: moveOutDate, move_out_date: moveOutDate })
            .eq('id', request.lease_id);
          if (leaseErr) throw leaseErr;
        }
        if (request.room_id) {
          const { error: roomErr } = await supabase.from('rooms').update({ status: 'vacant' }).eq('id', request.room_id);
          if (roomErr) throw roomErr;
        }
        const { error: reqErr } = await supabase
          .from('move_out_requests')
          .update({ status: 'approved' })
          .eq('id', request.id);
        if (reqErr) throw reqErr;
        setMsg(`อนุมัติการย้ายออกห้อง ${request.roomNumber} แล้ว — ห้องถูกตั้งเป็นว่าง`);
      } else {
        const { error: reqErr } = await supabase
          .from('move_out_requests')
          .update({ status: 'rejected' })
          .eq('id', request.id);
        if (reqErr) throw reqErr;
        setMsg('ปฏิเสธคำขอย้ายออกแล้ว — สัญญาและห้องยังคงเดิม');
      }
      load();
    } catch (err) {
      setError(err.message || 'ดำเนินการไม่สำเร็จ');
    } finally {
      setActingId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">คำขอย้ายออก</h1>
        {canManage && (
          <button
            type="button"
            onClick={openForm}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            + เพิ่มการย้ายออก
          </button>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => !saving && setShowForm(false)}>
          <form
            onSubmit={createRequest}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
          >
            <h2 className="text-lg font-semibold text-slate-900">เพิ่มการย้ายออก</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              จะสร้างเป็นคำขอ "รอดำเนินการ" ก่อน — สัญญาจะปิดและห้องจะว่างก็ต่อเมื่อกด "อนุมัติ" ในตาราง
            </p>

            <label className="mt-4 block text-sm font-medium text-slate-700">ห้อง / ผู้เช่า *</label>
            <select
              value={form.leaseId}
              onChange={(e) => setForm({ ...form, leaseId: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              disabled={leaseOptions === null}
            >
              <option value="">
                {leaseOptions === null
                  ? 'กำลังโหลดห้อง…'
                  : leaseOptions.length === 0
                    ? 'ไม่มีห้องที่มีสัญญาเช่าอยู่'
                    : '— เลือกห้อง —'}
              </option>
              {(leaseOptions || []).map((l) => (
                <option key={l.id} value={l.id} disabled={l.hasPending}>
                  ห้อง {l.roomNumber}
                  {l.tenantName ? ` — ${l.tenantName}` : ''}
                  {l.hasPending ? ' (มีคำขอรออยู่แล้ว)' : ''}
                </option>
              ))}
            </select>

            <label className="mt-3 block text-sm font-medium text-slate-700">วันที่ย้ายออก *</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />

            <label className="mt-3 block text-sm font-medium text-slate-700">เหตุผล</label>
            <textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              rows={3}
              placeholder="เช่น ย้ายที่ทำงาน / หมดสัญญา (ไม่บังคับ)"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />

            {formError && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={saving || leaseOptions === null}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? 'กำลังบันทึก…' : 'บันทึกคำขอย้ายออก'}
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        ห้องจะไม่ถูกเปลี่ยนเป็น "ว่าง" และสัญญาจะไม่ถูกปิดโดยอัตโนมัติ — ต้องให้เจ้าของหรือแอดมินกดอนุมัติที่นี่ก่อนเสมอ
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {msg && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {msg}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-4 py-3">ผู้เช่า</th>
              <th className="px-4 py-3">ห้อง</th>
              <th className="px-4 py-3">วันที่ขอย้ายออก</th>
              <th className="px-4 py-3">เหตุผล</th>
              <th className="px-4 py-3">สถานะ</th>
              {canManage && <th className="px-4 py-3">ดำเนินการ</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="px-4 py-6 text-center text-slate-400">กำลังโหลด…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="px-4 py-6 text-center text-slate-400">ยังไม่มีคำขอย้ายออก</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.tenantName}</td>
                  <td className="px-4 py-3 text-slate-600">ห้อง {r.roomNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{r.requested_move_out_date || '-'}</td>
                  <td className="px-4 py-3 max-w-xs text-slate-600">{r.reason || '-'}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      {r.status === 'pending' ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => decide(r, true)}
                            disabled={actingId === r.id}
                            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            อนุมัติ
                          </button>
                          <button
                            type="button"
                            onClick={() => decide(r, false)}
                            disabled={actingId === r.id}
                            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            ปฏิเสธ
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
