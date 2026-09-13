import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Login() {
  const { session, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (session) {
    const from = location.state?.from?.pathname || '/';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(
        err.message === 'Invalid login credentials'
          ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
          : err.message || 'เข้าสู่ระบบไม่สำเร็จ'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 via-brand-800 to-brand-950 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-900 text-lg font-bold text-white">
            CLT
          </div>
          <h1 className="text-lg font-semibold text-slate-900">CLT Tenant Hub</h1>
          <p className="text-sm text-slate-500">ระบบสำหรับเจ้าของ / ผู้ดูแล / พนักงาน</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">อีเมล</label>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">รหัสผ่าน</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:opacity-60"
          >
            {submitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          บัญชีสร้างโดยเจ้าของ/ผู้ดูแลระบบเท่านั้น (Supabase Authentication)
        </p>
      </div>
    </div>
  );
}
