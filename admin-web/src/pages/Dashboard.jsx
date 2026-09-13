import { useAuth } from '../auth/AuthContext';

// Phase 4 will replace these with live Supabase queries (room status counts,
// this month's billing totals, maintenance/move-out counts) — see task list.
// Kept as a real, working placeholder (not a static mock) so Phase 3 is a
// runnable, deployable app end to end: login -> role-aware shell -> page.
export default function Dashboard() {
  const { staff } = useAuth();

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">
        สวัสดี, {staff?.full_name || 'ผู้ใช้งาน'} 👋
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        ภาพรวม CLT Tenant Hub — ข้อมูลสรุปจริงจะเชื่อมต่อในขั้นถัดไป (Phase 4)
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {['ห้องทั้งหมด', 'มีผู้เช่า', 'ห้องว่าง', 'ห้องจอง', 'กำลังซ่อม'].map((label) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-800">—</p>
          </div>
        ))}
      </div>
    </div>
  );
}
