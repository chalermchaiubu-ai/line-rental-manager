import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';

const STATUS_LABEL = { pending: 'รอดำเนินการ', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ' };

export default function MoveOut() {
  const { staff } = useAuth();
  const canManage = can(staff?.role, 'MANAGE_MOVE_OUT');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [rows, setRows] = useState([]);
  const [actingId, setActingId] = useState(null);

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
      <h1 className="text-xl font-semibold text-slate-900">คำขอย้ายออก</h1>
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
