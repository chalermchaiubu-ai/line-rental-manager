import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// maintenance_requests.status values confirmed in use elsewhere in this
// project: 'completed' and 'cancelled' (see Dashboard.jsx's open-ticket
// count query). The in-progress states are inferred from the wireframe's
// Kanban columns (ใหม่ / รับเรื่องแล้ว / กำลังดำเนินการ / เสร็จสิ้น) — if the
// live data uses different raw values for those three, a ticket still shows
// up (in an "อื่นๆ" column) rather than silently disappearing.
const COLUMNS = [
  { key: 'new', label: 'ใหม่' },
  { key: 'acknowledged', label: 'รับเรื่องแล้ว' },
  { key: 'in_progress', label: 'กำลังดำเนินการ' },
  { key: 'completed', label: 'เสร็จสิ้น' },
];
const KNOWN_STATUSES = new Set([...COLUMNS.map((c) => c.key), 'cancelled']);

const PRIORITY_BADGE = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-red-100 text-red-700',
  normal: 'bg-slate-100 text-slate-600',
  low: 'bg-slate-100 text-slate-500',
};

export default function Maintenance() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [updatingId, setUpdatingId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const ticketsRes = await supabase
        .from('maintenance_requests')
        .select('id, ticket_number, room_id, tenant_id, category, description, priority, status, created_at')
        .order('created_at', { ascending: false });
      if (ticketsRes.error) throw ticketsRes.error;
      const data = ticketsRes.data || [];

      const roomIds = [...new Set(data.map((t) => t.room_id).filter(Boolean))];
      const tenantIds = [...new Set(data.map((t) => t.tenant_id).filter(Boolean))];
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

      setTickets(
        data.map((t) => ({
          ...t,
          roomNumber: roomsById.get(t.room_id)?.room_number || '-',
          tenantName: tenantsById.get(t.tenant_id)
            ? `${tenantsById.get(t.tenant_id).first_name || ''} ${tenantsById.get(t.tenant_id).last_name || ''}`.trim()
            : '-',
        }))
      );
    } catch (err) {
      setError(err.message || 'โหลดรายการแจ้งซ่อมไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function setStatus(ticket, status) {
    setUpdatingId(ticket.id);
    setError(null);
    try {
      const { error: updErr } = await supabase.from('maintenance_requests').update({ status }).eq('id', ticket.id);
      if (updErr) throw updErr;
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, status } : t)));
    } catch (err) {
      setError(err.message || 'อัปเดตสถานะไม่สำเร็จ');
    } finally {
      setUpdatingId(null);
    }
  }

  const otherTickets = tickets.filter((t) => !KNOWN_STATUSES.has(t.status));
  const cancelledTickets = tickets.filter((t) => t.status === 'cancelled');

  function Card({ ticket }) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400">{ticket.ticket_number || '-'}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_BADGE[ticket.priority] || 'bg-slate-100 text-slate-500'}`}>
            {ticket.priority || 'normal'}
          </span>
        </div>
        <p className="mt-1 text-sm font-medium text-slate-800">ห้อง {ticket.roomNumber} · {ticket.category || 'ไม่ระบุหมวด'}</p>
        <p className="mt-0.5 text-xs text-slate-500">{ticket.tenantName}</p>
        {ticket.description && <p className="mt-1 line-clamp-3 text-xs text-slate-600">{ticket.description}</p>}
        <select
          value={KNOWN_STATUSES.has(ticket.status) ? ticket.status : ''}
          onChange={(e) => setStatus(ticket, e.target.value)}
          disabled={updatingId === ticket.id}
          className="mt-2 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
        >
          {!KNOWN_STATUSES.has(ticket.status) && (
            <option value="" disabled>
              ({ticket.status})
            </option>
          )}
          {COLUMNS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
          <option value="cancelled">ยกเลิก</option>
        </select>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">งานซ่อม</h1>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-slate-400">กำลังโหลด…</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {COLUMNS.map((col) => {
              const colTickets = tickets.filter((t) => t.status === col.key);
              return (
                <div key={col.key} className="rounded-xl bg-slate-100 p-3">
                  <p className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
                    {col.label} <span className="rounded-full bg-white px-2 py-0.5">{colTickets.length}</span>
                  </p>
                  <div className="space-y-2">
                    {colTickets.length === 0 ? (
                      <p className="text-xs text-slate-400">ไม่มีรายการ</p>
                    ) : (
                      colTickets.map((t) => <Card key={t.id} ticket={t} />)
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {otherTickets.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="mb-2 text-xs font-semibold text-amber-700">
                สถานะอื่นๆ ที่ระบบยังไม่รู้จัก ({otherTickets.length})
              </p>
              <div className="grid gap-2 md:grid-cols-3">
                {otherTickets.map((t) => (
                  <Card key={t.id} ticket={t} />
                ))}
              </div>
            </div>
          )}

          {cancelledTickets.length > 0 && (
            <details className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                ยกเลิกแล้ว ({cancelledTickets.length})
              </summary>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                {cancelledTickets.map((t) => (
                  <Card key={t.id} ticket={t} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
