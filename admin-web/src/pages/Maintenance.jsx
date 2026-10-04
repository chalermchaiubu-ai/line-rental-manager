import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { sortRooms } from '../lib/sortRooms';

// Same category labels the LINE bot stores (server.js MAINTENANCE_CATEGORIES),
// so tickets from the bot and from this admin form group together.
const CATEGORY_OPTIONS = ['ไฟฟ้า', 'ประปา', 'เครื่องปรับอากาศ', 'เฟอร์นิเจอร์ / ของใช้ในห้อง', 'อื่น ๆ'];

// The bot always inserts priority 'medium'; keep that as the default here.
const PRIORITY_OPTIONS = [
  { key: 'low', label: 'ต่ำ' },
  { key: 'medium', label: 'ปกติ' },
  { key: 'high', label: 'สูง' },
  { key: 'urgent', label: 'ด่วนมาก' },
];
const PRIORITY_LABEL = Object.fromEntries(PRIORITY_OPTIONS.map((p) => [p.key, p.label]));

const EMPTY_FORM = { roomId: '', category: CATEGORY_OPTIONS[0], priority: 'medium', description: '' };

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
  medium: 'bg-slate-100 text-slate-600',
  normal: 'bg-slate-100 text-slate-600',
  low: 'bg-slate-100 text-slate-500',
};

export default function Maintenance() {
  const { staff } = useAuth();
  const canCreate = can(staff?.role, 'HANDLE_MAINTENANCE');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [allRooms, setAllRooms] = useState([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
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

  async function openForm() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setSuccessMsg(null);
    setShowForm(true);
    if (!roomsLoaded) {
      const { data, error: err } = await supabase.from('rooms').select('id, room_number');
      if (err) setFormError(err.message);
      else {
        setAllRooms(sortRooms(data));
        setRoomsLoaded(true);
      }
    }
  }

  async function createTicket(e) {
    e.preventDefault();
    setFormError(null);
    if (!form.roomId) {
      setFormError('กรุณาเลือกห้อง');
      return;
    }
    if (!form.description.trim()) {
      setFormError('กรุณากรอกรายละเอียดอาการ/ปัญหา');
      return;
    }
    setSaving(true);
    try {
      // Attach the room's current tenant (active lease) if there is one, the
      // same way bot-created tickets carry tenant_id. Vacant room -> null.
      const leaseRes = await supabase
        .from('leases')
        .select('tenant_id')
        .eq('room_id', form.roomId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (leaseRes.error) throw leaseRes.error;

      const { data: row, error: insErr } = await supabase
        .from('maintenance_requests')
        .insert([
          {
            room_id: form.roomId,
            tenant_id: leaseRes.data?.tenant_id ?? null,
            category: form.category,
            description: form.description.trim(),
            priority: form.priority,
            status: 'new',
          },
        ])
        .select('ticket_number')
        .maybeSingle();
      if (insErr) throw insErr;

      setShowForm(false);
      setSuccessMsg(`เพิ่มงานซ่อมแล้ว${row?.ticket_number ? ` (เลขที่ ${row.ticket_number})` : ''}`);
      await load();
    } catch (err) {
      const msg = err.message || 'บันทึกไม่สำเร็จ';
      setFormError(
        /row-level security|permission/i.test(msg)
          ? `ฐานข้อมูลยังไม่อนุญาตให้บัญชีนี้เพิ่มงานซ่อม (RLS) — ${msg}`
          : msg
      );
    } finally {
      setSaving(false);
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
            {PRIORITY_LABEL[ticket.priority] || ticket.priority || 'ปกติ'}
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">งานซ่อม</h1>
        {canCreate && (
          <button
            type="button"
            onClick={openForm}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            + เพิ่มงานซ่อม
          </button>
        )}
      </div>

      {successMsg && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMsg}</div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => !saving && setShowForm(false)}>
          <form
            onSubmit={createTicket}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
          >
            <h2 className="text-lg font-semibold text-slate-900">เพิ่มงานซ่อม</h2>
            <p className="mt-0.5 text-xs text-slate-500">เลขที่งานซ่อมจะออกให้อัตโนมัติ และงานจะเข้าคอลัมน์ "ใหม่"</p>

            <label className="mt-4 block text-sm font-medium text-slate-700">ห้อง *</label>
            <select
              value={form.roomId}
              onChange={(e) => setForm({ ...form, roomId: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              disabled={!roomsLoaded}
            >
              <option value="">{roomsLoaded ? '— เลือกห้อง —' : 'กำลังโหลดห้อง…'}</option>
              {allRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  ห้อง {r.room_number}
                </option>
              ))}
            </select>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700">ประเภท</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">ความเร่งด่วน</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="mt-3 block text-sm font-medium text-slate-700">รายละเอียด *</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={4}
              placeholder="เช่น แอร์ไม่เย็น มีน้ำหยด / ก๊อกน้ำห้องน้ำรั่ว"
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
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? 'กำลังบันทึก…' : 'บันทึกงานซ่อม'}
              </button>
            </div>
          </form>
        </div>
      )}

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
