import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabaseClient';

// Friendly Thai labels for the room status values we've seen in the live
// schema so far (DEPLOYMENT-STATUS.md confirms `status` is a free-text
// varchar with no CHECK constraint observed, e.g. "occupied"). Any status
// value that isn't in this map still renders — just with its raw value as
// the label — so a status we haven't seen yet never disappears silently.
const ROOM_STATUS_LABEL = {
  vacant: 'ห้องว่าง',
  occupied: 'มีผู้เช่า',
  reserved: 'จอง',
  maintenance: 'กำลังซ่อม',
  repairing: 'กำลังซ่อม',
};

function currentBillingMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function Dashboard() {
  const { staff } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [roomCounts, setRoomCounts] = useState([]);
  const [billSummary, setBillSummary] = useState(null);
  const [openMaintenance, setOpenMaintenance] = useState(null);
  const [pendingMoveOuts, setPendingMoveOuts] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const month = currentBillingMonth();

        const [roomsRes, billsRes, maintRes, moveOutRes] = await Promise.all([
          supabase.from('rooms').select('status'),
          supabase.from('bills').select('status, total_amount').eq('billing_month', month),
          supabase
            .from('maintenance_requests')
            .select('id', { count: 'exact', head: true })
            .not('status', 'in', '("completed","cancelled")'),
          supabase
            .from('move_out_requests')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending'),
        ]);

        if (roomsRes.error) throw roomsRes.error;
        if (billsRes.error) throw billsRes.error;
        if (maintRes.error) throw maintRes.error;
        if (moveOutRes.error) throw moveOutRes.error;

        if (cancelled) return;

        // Tally room counts by status client-side (dataset is ~28 rooms —
        // no need for a server-side group-by).
        const counts = {};
        for (const row of roomsRes.data || []) {
          const key = row.status || 'ไม่ระบุ';
          counts[key] = (counts[key] || 0) + 1;
        }
        const total = (roomsRes.data || []).length;
        setRoomCounts([
          { key: 'total', label: 'ห้องทั้งหมด', value: total },
          ...Object.entries(counts).map(([key, value]) => ({
            key,
            label: ROOM_STATUS_LABEL[key] || key,
            value,
          })),
        ]);

        const bills = billsRes.data || [];
        setBillSummary({
          month,
          count: bills.length,
          totalAmount: bills.reduce((sum, b) => sum + Number(b.total_amount || 0), 0),
          unpaidCount: bills.filter((b) => b.status !== 'paid').length,
        });

        setOpenMaintenance(maintRes.count ?? 0);
        setPendingMoveOuts(moveOutRes.count ?? 0);
      } catch (err) {
        if (!cancelled) setError(err.message || 'โหลดข้อมูลแดชบอร์ดไม่สำเร็จ');
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
      <h1 className="text-xl font-semibold text-slate-900">
        สวัสดี, {staff?.full_name || 'ผู้ใช้งาน'} 👋
      </h1>
      <p className="mt-1 text-sm text-slate-500">ภาพรวม CLT Tenant Hub</p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(loading ? Array.from({ length: 5 }, (_, i) => ({ key: i, label: '…', value: null })) : roomCounts).map(
          (item) => (
            <div key={item.key} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-400">{item.label}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-800">
                {item.value === null ? '—' : item.value}
              </p>
            </div>
          )
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-400">
            บิลเดือนนี้ {billSummary ? `(${billSummary.month})` : ''}
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-800">
            {loading || !billSummary ? '—' : billSummary.count}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {loading || !billSummary
              ? ''
              : `ยอดรวม ${billSummary.totalAmount.toLocaleString('th-TH')} บาท • ค้างชำระ ${billSummary.unpaidCount} รายการ`}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-400">งานซ่อมที่ยังไม่ปิด</p>
          <p className="mt-1 text-2xl font-semibold text-slate-800">
            {loading || openMaintenance === null ? '—' : openMaintenance}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-400">คำขอย้ายออกรอดำเนินการ</p>
          <p className="mt-1 text-2xl font-semibold text-slate-800">
            {loading || pendingMoveOuts === null ? '—' : pendingMoveOuts}
          </p>
        </div>
      </div>
    </div>
  );
}
