import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function Tenants() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [tenantsRes, leasesRes] = await Promise.all([
          supabase
            .from('tenants')
            .select('id, first_name, last_name, phone, line_user_id, status')
            .order('first_name'),
          supabase.from('leases').select('id, room_id, tenant_id, status').eq('status', 'active'),
        ]);
        if (tenantsRes.error) throw tenantsRes.error;
        if (leasesRes.error) throw leasesRes.error;

        const activeLeaseByTenant = new Map((leasesRes.data || []).map((l) => [l.tenant_id, l]));
        const roomIds = (leasesRes.data || []).map((l) => l.room_id).filter(Boolean);

        let roomsById = new Map();
        if (roomIds.length > 0) {
          const roomsRes = await supabase.from('rooms').select('id, room_number').in('id', roomIds);
          if (roomsRes.error) throw roomsRes.error;
          roomsById = new Map((roomsRes.data || []).map((r) => [r.id, r]));
        }

        const merged = (tenantsRes.data || []).map((tenant) => {
          const lease = activeLeaseByTenant.get(tenant.id) || null;
          const room = lease ? roomsById.get(lease.room_id) : null;
          return {
            ...tenant,
            fullName: `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() || '-',
            roomNumber: room?.room_number || null,
            hasLine: Boolean(tenant.line_user_id),
          };
        });

        if (!cancelled) setRows(merged);
      } catch (err) {
        if (!cancelled) setError(err.message || 'โหลดข้อมูลผู้เช่าไม่สำเร็จ');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">ผู้เช่า / สัญญาเช่า</h1>
        <p className="text-sm text-slate-400">{loading ? 'กำลังโหลด…' : `ทั้งหมด ${rows.length} คน`}</p>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-4 py-3">ชื่อ-นามสกุล</th>
              <th className="px-4 py-3">ห้อง</th>
              <th className="px-4 py-3">เบอร์โทร</th>
              <th className="px-4 py-3">LINE</th>
              <th className="px-4 py-3">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  กำลังโหลด…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  ยังไม่มีข้อมูลผู้เช่า
                </td>
              </tr>
            ) : (
              rows.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-800">{t.fullName}</td>
                  <td className="px-4 py-3 text-slate-600">{t.roomNumber ? `ห้อง ${t.roomNumber}` : '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{t.phone || '-'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        t.hasLine ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {t.hasLine ? 'เชื่อมแล้ว' : 'ยังไม่เชื่อม'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{t.status || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
