import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { sortRooms } from '../lib/sortRooms';

const STATUS_LABEL = {
  vacant: 'ว่าง',
  occupied: 'มีผู้เช่า',
  reserved: 'จอง',
  maintenance: 'กำลังซ่อม',
  repairing: 'กำลังซ่อม',
};

const STATUS_BADGE = {
  vacant: 'bg-slate-100 text-slate-600',
  occupied: 'bg-emerald-100 text-emerald-700',
  reserved: 'bg-amber-100 text-amber-700',
  maintenance: 'bg-red-100 text-red-700',
  repairing: 'bg-red-100 text-red-700',
};

export default function Rooms() {
  const { staff } = useAuth();
  const canSeeRent = can(staff?.role, 'VIEW_RENT_PRICING');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Fetched separately (rather than one nested PostgREST embed query)
        // so the join logic is plain, readable JS we can trust without
        // having been able to test it against the live project this
        // session — see the handoff note for why.
        const [roomsRes, roomTypesRes, leasesRes] = await Promise.all([
          supabase.from('rooms').select('id, room_number, room_type_id, status, floor, note').order('room_number'),
          supabase.from('room_types').select('id, name, default_rent'),
          supabase.from('leases').select('id, room_id, tenant_id, monthly_rent').eq('status', 'active'),
        ]);
        if (roomsRes.error) throw roomsRes.error;
        if (roomTypesRes.error) throw roomTypesRes.error;
        if (leasesRes.error) throw leasesRes.error;

        const activeLeasesByRoom = new Map((leasesRes.data || []).map((l) => [l.room_id, l]));
        const tenantIds = (leasesRes.data || []).map((l) => l.tenant_id).filter(Boolean);

        let tenantsById = new Map();
        if (tenantIds.length > 0) {
          const tenantsRes = await supabase
            .from('tenants')
            .select('id, first_name, last_name')
            .in('id', tenantIds);
          if (tenantsRes.error) throw tenantsRes.error;
          tenantsById = new Map((tenantsRes.data || []).map((t) => [t.id, t]));
        }

        const roomTypesById = new Map((roomTypesRes.data || []).map((rt) => [rt.id, rt]));

        const merged = sortRooms(roomsRes.data).map((room) => {
          const lease = activeLeasesByRoom.get(room.id) || null;
          const tenant = lease ? tenantsById.get(lease.tenant_id) : null;
          const roomType = roomTypesById.get(room.room_type_id) || null;
          return {
            ...room,
            roomTypeName: roomType?.name || '-',
            rent: lease?.monthly_rent ?? roomType?.default_rent ?? null,
            tenantName: tenant ? `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() : null,
          };
        });

        if (!cancelled) setRows(merged);
      } catch (err) {
        if (!cancelled) setError(err.message || 'โหลดข้อมูลห้องพักไม่สำเร็จ');
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
        <h1 className="text-xl font-semibold text-slate-900">ห้องพัก</h1>
        <p className="text-sm text-slate-400">{loading ? 'กำลังโหลด…' : `ทั้งหมด ${rows.length} ห้อง`}</p>
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
              <th className="px-4 py-3">ห้อง</th>
              <th className="px-4 py-3">ประเภท</th>
              <th className="px-4 py-3">ผู้เช่าปัจจุบัน</th>
              {canSeeRent && <th className="px-4 py-3">ค่าเช่า/เดือน</th>}
              <th className="px-4 py-3">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={canSeeRent ? 5 : 4} className="px-4 py-6 text-center text-slate-400">
                  กำลังโหลด…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={canSeeRent ? 5 : 4} className="px-4 py-6 text-center text-slate-400">
                  ยังไม่มีข้อมูลห้องพัก
                </td>
              </tr>
            ) : (
              rows.map((room) => (
                <tr key={room.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-800">ห้อง {room.room_number}</td>
                  <td className="px-4 py-3 text-slate-600">{room.roomTypeName}</td>
                  <td className="px-4 py-3 text-slate-600">{room.tenantName || '-'}</td>
                  {canSeeRent && (
                    <td className="px-4 py-3 text-slate-600">
                      {room.rent != null ? `${Number(room.rent).toLocaleString('th-TH')} บาท` : '-'}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        STATUS_BADGE[room.status] || 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {STATUS_LABEL[room.status] || room.status || 'ไม่ระบุ'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
