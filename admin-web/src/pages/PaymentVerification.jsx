import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';

const TABS = [
  { key: 'pending', label: 'รอตรวจสอบ' },
  { key: 'verified', label: 'ยืนยันแล้ว' },
  { key: 'rejected', label: 'ปฏิเสธ' },
];

export default function PaymentVerification() {
  const { staff } = useAuth();
  const canVerify = can(staff?.role, 'VERIFY_PAYMENT');

  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [actingId, setActingId] = useState(null);
  const [msg, setMsg] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const paymentsRes = await supabase
        .from('payments')
        .select('id, bill_id, tenant_id, amount, payment_method, slip_url, status, created_at')
        .eq('status', tab)
        .order('created_at', { ascending: false });
      if (paymentsRes.error) throw paymentsRes.error;
      const payments = paymentsRes.data || [];

      const billIds = [...new Set(payments.map((p) => p.bill_id).filter(Boolean))];
      const tenantIds = [...new Set(payments.map((p) => p.tenant_id).filter(Boolean))];

      const [billsRes, tenantsRes] = await Promise.all([
        billIds.length
          ? supabase.from('bills').select('id, bill_number, billing_month, total_amount, room_id').in('id', billIds)
          : Promise.resolve({ data: [] }),
        tenantIds.length
          ? supabase.from('tenants').select('id, first_name, last_name').in('id', tenantIds)
          : Promise.resolve({ data: [] }),
      ]);
      if (billsRes.error) throw billsRes.error;
      if (tenantsRes.error) throw tenantsRes.error;

      const roomIds = [...new Set((billsRes.data || []).map((b) => b.room_id).filter(Boolean))];
      const roomsRes = roomIds.length
        ? await supabase.from('rooms').select('id, room_number').in('id', roomIds)
        : { data: [] };
      if (roomsRes.error) throw roomsRes.error;

      const billsById = new Map((billsRes.data || []).map((b) => [b.id, b]));
      const tenantsById = new Map((tenantsRes.data || []).map((t) => [t.id, t]));
      const roomsById = new Map((roomsRes.data || []).map((r) => [r.id, r]));

      const merged = payments.map((p) => {
        const bill = billsById.get(p.bill_id) || null;
        const tenant = tenantsById.get(p.tenant_id) || null;
        const room = bill ? roomsById.get(bill.room_id) : null;
        return {
          ...p,
          bill,
          room,
          tenantName: tenant ? `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() : '-',
        };
      });

      setRows(merged);
    } catch (err) {
      setError(err.message || 'โหลดข้อมูลการชำระเงินไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function act(payment, nextStatus) {
    setActingId(payment.id);
    setMsg(null);
    setError(null);
    try {
      const { error: updErr } = await supabase
        .from('payments')
        .update({
          status: nextStatus,
          verified_by: staff?.id || null,
          verified_at: new Date().toISOString(),
        })
        .eq('id', payment.id);
      if (updErr) throw updErr;
      setMsg(nextStatus === 'verified' ? 'ยืนยันการชำระเงินแล้ว' : 'ปฏิเสธการชำระเงินแล้ว');
      load();
    } catch (err) {
      setError(err.message || 'บันทึกผลไม่สำเร็จ');
    } finally {
      setActingId(null);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">ตรวจสอบการชำระเงิน</h1>

      <div className="mt-4 flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold ${
              tab === t.key
                ? 'border-b-2 border-slate-800 text-slate-900'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!canVerify && (
        <p className="mt-3 text-xs text-slate-400">
          บัญชีของคุณ ({staff?.role || '-'}) ดูรายการได้เท่านั้น การยืนยัน/ปฏิเสธการชำระเงินทำได้เฉพาะเจ้าของ
        </p>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {msg && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {msg}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <p className="text-sm text-slate-400">กำลังโหลด…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400">ไม่มีรายการในหมวดนี้</p>
        ) : (
          rows.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-800">{p.tenantName}</p>
                <span className="text-xs text-slate-400">{p.room ? `ห้อง ${p.room.room_number}` : '-'}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {p.bill ? `บิล ${p.bill.bill_number} (${p.bill.billing_month})` : 'ไม่พบบิลที่เกี่ยวข้อง'}
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-900">
                {Number(p.amount || 0).toLocaleString('th-TH')} บาท
              </p>
              <p className="text-xs text-slate-500">
                ยอดบิล {p.bill ? Number(p.bill.total_amount || 0).toLocaleString('th-TH') : '-'} บาท · ช่องทาง{' '}
                {p.payment_method || '-'}
              </p>
              {p.slip_url && (
                <a
                  href={p.slip_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs font-semibold text-sky-600 underline"
                >
                  ดูสลิปโอนเงิน
                </a>
              )}
              <p className="mt-2 text-xs text-slate-400">
                ส่งเมื่อ {p.created_at ? new Date(p.created_at).toLocaleString('th-TH') : '-'}
              </p>

              {tab === 'pending' && canVerify && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => act(p, 'verified')}
                    disabled={actingId === p.id}
                    className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    ยืนยัน
                  </button>
                  <button
                    type="button"
                    onClick={() => act(p, 'rejected')}
                    disabled={actingId === p.id}
                    className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    ปฏิเสธ
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
