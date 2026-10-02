import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';

const ROLE_LABEL = { owner: 'เจ้าของ', admin: 'แอดมิน', staff: 'พนักงาน' };

export default function Settings() {
  const { staff } = useAuth();
  const canManageUsers = can(staff?.role, 'MANAGE_USERS');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  const [settings, setSettings] = useState([]); // [{ key, value, description, draft, saving }]
  const [staffUsers, setStaffUsers] = useState([]);
  const [togglingId, setTogglingId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, staffRes] = await Promise.all([
        supabase.from('settings').select('key, value, description, updated_at').order('key'),
        supabase.from('staff_users').select('id, full_name, phone, role, active').order('full_name'),
      ]);
      if (settingsRes.error) throw settingsRes.error;
      if (staffRes.error) throw staffRes.error;

      setSettings((settingsRes.data || []).map((s) => ({ ...s, draft: s.value, saving: false })));
      setStaffUsers(staffRes.data || []);
    } catch (err) {
      setError(err.message || 'โหลดการตั้งค่าไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updateDraft(key, draft) {
    setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, draft } : s)));
  }

  async function saveSetting(key) {
    const row = settings.find((s) => s.key === key);
    if (!row) return;
    setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, saving: true } : s)));
    setError(null);
    setMsg(null);
    try {
      const { error: updErr } = await supabase
        .from('settings')
        .update({ value: row.draft, updated_at: new Date().toISOString() })
        .eq('key', key);
      if (updErr) throw updErr;
      setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, value: row.draft, saving: false } : s)));
      setMsg(`บันทึก "${key}" แล้ว`);
    } catch (err) {
      setError(err.message || 'บันทึกไม่สำเร็จ');
      setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, saving: false } : s)));
    }
  }

  async function toggleStaffActive(member) {
    setTogglingId(member.id);
    setError(null);
    try {
      const { error: updErr } = await supabase
        .from('staff_users')
        .update({ active: !member.active })
        .eq('id', member.id);
      if (updErr) throw updErr;
      setStaffUsers((prev) => prev.map((s) => (s.id === member.id ? { ...s, active: !s.active } : s)));
    } catch (err) {
      setError(err.message || 'อัปเดตสถานะพนักงานไม่สำเร็จ');
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">ตั้งค่าระบบ</h1>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {msg && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {msg}
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-slate-400">กำลังโหลด…</p>
      ) : (
        <>
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-800">ข้อมูลทั่วไป / นโยบายบิล</h2>
            <p className="mt-1 text-xs text-slate-400">
              แก้ไขค่าที่มีอยู่แล้วในตาราง settings (ติดต่อ/บัญชีธนาคาร/PromptPay/ค่าปรับล่าช้า ฯลฯ)
            </p>
            {settings.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">ยังไม่มีรายการตั้งค่าในฐานข้อมูล</p>
            ) : (
              <div className="mt-3 space-y-3">
                {settings.map((s) => (
                  <div key={s.key} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-xs font-semibold text-slate-500">{s.key}</label>
                      {s.description && <p className="text-xs text-slate-400">{s.description}</p>}
                      <input
                        type="text"
                        value={s.draft ?? ''}
                        onChange={(e) => updateDraft(s.key, e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => saveSetting(s.key)}
                      disabled={s.saving || s.draft === s.value}
                      className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {s.saving ? 'กำลังบันทึก…' : 'บันทึก'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-800">รายชื่อพนักงาน</h2>
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs font-semibold text-slate-500">
                <tr>
                  <th className="py-1.5">ชื่อ</th>
                  <th className="py-1.5">เบอร์โทร</th>
                  <th className="py-1.5">สิทธิ์</th>
                  <th className="py-1.5">สถานะ</th>
                  {canManageUsers && <th className="py-1.5">ดำเนินการ</th>}
                </tr>
              </thead>
              <tbody>
                {staffUsers.length === 0 ? (
                  <tr>
                    <td colSpan={canManageUsers ? 5 : 4} className="py-3 text-center text-slate-400">
                      ยังไม่มีพนักงานในระบบ
                    </td>
                  </tr>
                ) : (
                  staffUsers.map((m) => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="py-2 font-medium text-slate-800">{m.full_name || '-'}</td>
                      <td className="py-2 text-slate-600">{m.phone || '-'}</td>
                      <td className="py-2 text-slate-600">{ROLE_LABEL[m.role] || m.role}</td>
                      <td className="py-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            m.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {m.active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}
                        </span>
                      </td>
                      {canManageUsers && (
                        <td className="py-2">
                          <button
                            type="button"
                            onClick={() => toggleStaffActive(m)}
                            disabled={togglingId === m.id}
                            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                          >
                            {m.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {!canManageUsers && (
              <p className="mt-2 text-xs text-slate-400">เฉพาะเจ้าของเท่านั้นที่เปิด/ปิดใช้งานบัญชีพนักงานได้</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
