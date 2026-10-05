import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { compareRoomNumbers } from '../lib/sortRooms';

// ----------------------------------------------------------------------------
// ผู้เช่า / เชื่อม LINE
// LINE does not let anyone add a person to an OA by phone number or ID card.
// The flow is therefore:
//   1. Staff records the tenant's phone and/or national ID here.
//   2. Staff sends the tenant the OA link / QR (invite message below).
//   3. Tenant adds the OA and types their phone or 13-digit ID once — the bot
//      (server.js tryLinkByPhoneOrId) matches it and links the LINE account.
// Staff can unlink here (e.g. tenant changed phone / moved out).
// The ID number is never stored: only its SHA-256 (same as the bot) + last 4.
// ----------------------------------------------------------------------------

const OA_LINK = 'https://lin.ee/zTwHTRR';
const OA_ID = '@631prhjs';
const DORM_NAME = 'หอพัก โชคดี เพลส';

const digitsOnly = (v) => (v || '').replace(/\D/g, '');

function isThaiId(d) {
  if (!/^\d{13}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(d[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(d[12]);
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function inviteText(t) {
  const how = t.phone ? `พิมพ์เบอร์โทร ${t.phone}` : 'พิมพ์เบอร์โทรหรือเลขบัตรประชาชน 13 หลักที่ให้ไว้กับหอพัก';
  return (
    `สวัสดีครับ คุณ${t.first_name || ''}${t.roomNumber ? ` (ห้อง ${t.roomNumber})` : ''}\n` +
    `${DORM_NAME} ขอเชิญเพิ่มเพื่อน LINE ของหอพัก เพื่อเช็กบิล ส่งสลิป แจ้งซ่อม และติดต่อหอพักได้สะดวกขึ้น\n\n` +
    `1) กดลิงก์นี้เพื่อเพิ่มเพื่อน: ${OA_LINK}\n` +
    `2) ${how} ในแชท แล้วระบบจะเชื่อมห้องให้อัตโนมัติ`
  );
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function EditModal({ tenant, onClose, onSaved }) {
  const [form, setForm] = useState({
    firstName: tenant.first_name || '',
    lastName: tenant.last_name || '',
    phone: tenant.phone || '',
    idCard: '',
    clearId: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const idDigits = digitsOnly(form.idCard);

  async function save(e) {
    e.preventDefault();
    setError(null);
    if (!form.firstName.trim()) return setError('กรุณากรอกชื่อ');
    const phoneDigits = digitsOnly(form.phone);
    if (phoneDigits && (phoneDigits.length < 9 || phoneDigits.length > 10)) return setError('เบอร์โทรต้องมี 9–10 หลัก');
    if (idDigits && !isThaiId(idDigits)) return setError('เลขบัตรประชาชนไม่ถูกต้อง (ตรวจสอบ 13 หลักอีกครั้ง)');

    setSaving(true);
    try {
      const update = { first_name: form.firstName.trim(), last_name: form.lastName.trim(), phone: phoneDigits || null };
      if (idDigits) {
        update.id_card_hash = await sha256Hex(idDigits);
        update.id_card_last4 = idDigits.slice(-4);
      } else if (form.clearId) {
        update.id_card_hash = null;
        update.id_card_last4 = null;
      }
      const { error: err } = await supabase.from('tenants').update(update).eq('id', tenant.id);
      if (err) {
        if (/id_card/.test(err.message || '')) throw new Error('ยังบันทึกเลขบัตรไม่ได้ — ให้เจ้าของรันไฟล์ SQL 004_tenant_id_card.sql ใน Supabase ก่อน (ครั้งเดียว)');
        throw err;
      }
      onSaved(`บันทึกข้อมูลคุณ${update.first_name} แล้ว`);
    } catch (err) {
      setError(err.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  const input = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => !saving && onClose()}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">ข้อมูลผู้เช่า{tenant.roomNumber ? ` · ห้อง ${tenant.roomNumber}` : ''}</h2>
        <p className="mt-0.5 text-xs text-slate-500">ผู้เช่าใช้เบอร์โทรหรือเลขบัตรนี้ พิมพ์ใน LINE เพื่อเชื่อมห้องของตัวเอง</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            ชื่อ *<input value={form.firstName} onChange={set('firstName')} className={input} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            นามสกุล<input value={form.lastName} onChange={set('lastName')} className={input} />
          </label>
        </div>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          เบอร์โทร<input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="0812345678" className={input} />
        </label>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          เลขบัตรประชาชน 13 หลัก
          <input
            value={form.idCard}
            onChange={set('idCard')}
            inputMode="numeric"
            autoComplete="off"
            placeholder={tenant.id_card_last4 ? `บันทึกไว้แล้ว (ลงท้าย ${tenant.id_card_last4}) — พิมพ์ใหม่เพื่อเปลี่ยน` : 'ไม่บังคับ'}
            className={input}
          />
        </label>
        {idDigits.length === 13 && (
          <p className={`mt-1 text-xs ${isThaiId(idDigits) ? 'text-emerald-600' : 'text-red-600'}`}>
            {isThaiId(idDigits) ? '✓ เลขบัตรถูกต้อง' : '✗ เลขบัตรไม่ถูกต้อง'}
          </p>
        )}
        {tenant.id_card_last4 && !idDigits && (
          <label className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={form.clearId} onChange={set('clearId')} /> ลบเลขบัตรที่บันทึกไว้
          </label>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          🔒 ระบบไม่เก็บเลขบัตรตัวเต็ม — เก็บเฉพาะรหัสที่เข้ารหัสแล้วสำหรับจับคู่ และเลข 4 ตัวท้ายไว้ดู
        </p>
        {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Tenants() {
  const { staff } = useAuth();
  const canEdit = can(staff?.role, 'MANAGE_TENANTS');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [qr, setQr] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [tenantsRes, leasesRes] = await Promise.all([
          supabase.from('tenants').select('*'),
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
        const merged = (tenantsRes.data || [])
          .map((t) => {
            const lease = activeLeaseByTenant.get(t.id) || null;
            const room = lease ? roomsById.get(lease.room_id) : null;
            return {
              ...t,
              fullName: `${t.first_name || ''} ${t.last_name || ''}`.trim() || '-',
              roomNumber: room?.room_number || null,
              hasLine: Boolean(t.line_user_id),
            };
          })
          .sort((a, b) => compareRoomNumbers(a.roomNumber ?? 'zzz', b.roomNumber ?? 'zzz'));
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
  }, [reloadKey]);

  // QR for the OA link, generated on the fly (library loaded on demand).
  useEffect(() => {
    import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm')
      .then((m) => (m.default || m).toDataURL(OA_LINK, { width: 220, margin: 1 }))
      .then(setQr)
      .catch(() => setQr(null));
  }, []);

  // A phone shared by several not-yet-linked tenants can't be used to link
  // (the bot refuses to guess) — flag those rows.
  const dupPhones = useMemo(() => {
    const count = new Map();
    for (const r of rows) {
      const d = digitsOnly(r.phone);
      if (d && !r.hasLine && r.status !== 'inactive') count.set(d, (count.get(d) || 0) + 1);
    }
    return new Set([...count.entries()].filter(([, c]) => c > 1).map(([p]) => p));
  }, [rows]);

  const linkedCount = rows.filter((r) => r.hasLine).length;
  const shown = rows.filter((r) =>
    filter === 'linked' ? r.hasLine : filter === 'unlinked' ? !r.hasLine : true
  );

  async function unlink(t) {
    if (!window.confirm(`ยกเลิกการเชื่อม LINE ของคุณ${t.first_name || ''}${t.roomNumber ? ` (ห้อง ${t.roomNumber})` : ''}?\n\nผู้เช่าจะใช้เมนูใน LINE ไม่ได้ จนกว่าจะพิมพ์เบอร์/เลขบัตรเชื่อมใหม่`)) return;
    setError(null);
    const { error: err } = await supabase.from('tenants').update({ line_user_id: null }).eq('id', t.id);
    if (err) return setError(err.message);
    setMsg(`ยกเลิกการเชื่อม LINE ของคุณ${t.first_name || ''} แล้ว`);
    setReloadKey((k) => k + 1);
  }

  async function copyInvite(t) {
    const ok = await copy(inviteText(t));
    setMsg(ok ? `คัดลอกข้อความเชิญของคุณ${t.first_name || ''} แล้ว — วางส่งทาง SMS/LINE/Messenger ได้เลย` : 'คัดลอกไม่สำเร็จ');
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">ผู้เช่า / เชื่อม LINE</h1>
        <p className="text-sm text-slate-500">
          {loading ? 'กำลังโหลด…' : `ทั้งหมด ${rows.length} คน · เชื่อม LINE แล้ว ${linkedCount} คน`}
        </p>
      </div>

      <div className="mt-4 grid gap-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 md:grid-cols-[auto,1fr]">
        <div className="flex flex-col items-center">
          {qr ? <img src={qr} alt="QR เพิ่มเพื่อน LINE หอพัก" className="h-[150px] w-[150px] rounded-md bg-white p-1" /> : <div className="h-[150px] w-[150px] rounded-md bg-white" />}
          <p className="mt-1 text-xs font-semibold text-emerald-800">{OA_ID}</p>
        </div>
        <div className="text-sm text-emerald-900">
          <p className="font-semibold">วิธีให้ผู้เช่าเข้า LINE หอพัก</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>กรอก<b>เบอร์โทร</b> และ/หรือ <b>เลขบัตรประชาชน</b> ของผู้เช่าในตารางด้านล่าง (ปุ่ม “แก้ไข”)</li>
            <li>ส่งลิงก์/QR ให้ผู้เช่า หรือกด “คัดลอกข้อความเชิญ” ที่แถวของผู้เช่าแล้ววางส่งทาง SMS/LINE</li>
            <li>ผู้เช่ากดเพิ่มเพื่อน แล้ว<b>พิมพ์เบอร์โทรหรือเลขบัตร 13 หลัก</b>ในแชท — ระบบเชื่อมห้องให้อัตโนมัติ สถานะในตารางจะเป็น “เชื่อมแล้ว”</li>
          </ol>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-white px-2 py-1 text-xs">{OA_LINK}</code>
            <button type="button" onClick={async () => setMsg((await copy(OA_LINK)) ? 'คัดลอกลิงก์แล้ว' : 'คัดลอกไม่สำเร็จ')} className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs hover:bg-emerald-50">
              คัดลอกลิงก์
            </button>
          </div>
          <p className="mt-2 text-xs text-emerald-800/80">
            หมายเหตุ: LINE ไม่อนุญาตให้ดึงคนเข้า OA จากเบอร์โทรหรือเลขบัตรโดยตรง ผู้เช่าต้องกดเพิ่มเพื่อนเองก่อน 1 ครั้ง
          </p>
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {msg && <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">{msg}</div>}
      {!loading && dupPhones.size > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠️ มีเบอร์โทรที่ซ้ำกันหลายคน (แถวสีเหลือง) — ผู้เช่าเหล่านี้ใช้เบอร์เชื่อม LINE ไม่ได้จนกว่าจะแก้เป็นเบอร์จริง หรือใส่เลขบัตรประชาชนแทน
        </div>
      )}

      <div className="mt-4 flex gap-1 text-xs">
        {[
          ['all', 'ทั้งหมด'],
          ['unlinked', 'ยังไม่เชื่อม'],
          ['linked', 'เชื่อมแล้ว'],
        ].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 ${filter === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {editing && (
        <EditModal
          tenant={editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setMsg(text);
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-4 py-3">ห้อง</th>
              <th className="px-4 py-3">ชื่อ-นามสกุล</th>
              <th className="px-4 py-3">เบอร์โทร</th>
              <th className="px-4 py-3">เลขบัตร</th>
              <th className="px-4 py-3">LINE</th>
              {canEdit && <th className="px-4 py-3 text-right">จัดการ</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">กำลังโหลด…</td>
              </tr>
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">ไม่มีรายการ</td>
              </tr>
            ) : (
              shown.map((t) => {
                const dup = dupPhones.has(digitsOnly(t.phone));
                return (
                  <tr key={t.id} className={`border-t border-slate-100 ${dup ? 'bg-amber-50/70' : ''}`}>
                    <td className="px-4 py-3 font-medium text-slate-800">{t.roomNumber ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{t.fullName}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {t.phone || <span className="text-slate-400">ยังไม่มี</span>}
                      {dup && <span className="ml-1 text-[10px] font-semibold text-amber-700">ซ้ำ</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{t.id_card_last4 ? `•••••••••${t.id_card_last4}` : <span className="text-slate-400">-</span>}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${t.hasLine ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {t.hasLine ? 'เชื่อมแล้ว' : 'ยังไม่เชื่อม'}
                      </span>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button type="button" onClick={() => { setMsg(null); setEditing(t); }} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50">
                            แก้ไข
                          </button>
                          {t.hasLine ? (
                            <button type="button" onClick={() => unlink(t)} className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50">
                              ยกเลิกการเชื่อม
                            </button>
                          ) : (
                            <button type="button" onClick={() => copyInvite(t)} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">
                              คัดลอกข้อความเชิญ
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
