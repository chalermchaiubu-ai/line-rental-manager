import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { NAV_ITEMS, can } from '../auth/permissions';

const ROLE_LABEL = { owner: 'เจ้าของ', admin: 'ผู้ดูแล', staff: 'พนักงาน' };

function NavList({ items, onNavigate }) {
  const { staff } = useAuth();
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {items
        .filter((item) => !item.permission || can(staff?.role, item.permission))
        .map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? 'bg-brand-900 text-white'
                  : 'text-slate-600 hover:bg-brand-50 hover:text-brand-900'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
    </nav>
  );
}

export default function Layout() {
  const { staff, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-slate-50 print:block print:h-auto print:bg-white">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white md:flex print:hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-900 text-sm font-bold text-white">
            CLT
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Tenant Hub</p>
            <p className="text-xs text-slate-400">Admin</p>
          </div>
        </div>
        <NavList items={NAV_ITEMS} />
        <div className="border-t border-slate-200 p-3">
          <p className="truncate text-sm font-medium text-slate-800">{staff?.full_name || '-'}</p>
          <p className="text-xs text-slate-400">{ROLE_LABEL[staff?.role] || staff?.role}</p>
          <button
            onClick={signOut}
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden print:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg border border-slate-200 p-2 text-slate-600"
            aria-label="เปิดเมนู"
          >
            ☰
          </button>
          <p className="text-sm font-semibold text-slate-900">CLT Tenant Hub</p>
          <div className="w-9" />
        </header>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="w-64 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
                <p className="text-sm font-semibold text-slate-900">เมนู</p>
                <button onClick={() => setMobileOpen(false)} className="text-slate-500" aria-label="ปิดเมนู">
                  ✕
                </button>
              </div>
              <NavList items={NAV_ITEMS} onNavigate={() => setMobileOpen(false)} />
              <div className="border-t border-slate-200 p-3">
                <p className="truncate text-sm font-medium text-slate-800">{staff?.full_name || '-'}</p>
                <p className="text-xs text-slate-400">{ROLE_LABEL[staff?.role] || staff?.role}</p>
                <button
                  onClick={signOut}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600"
                >
                  ออกจากระบบ
                </button>
              </div>
            </div>
            <div className="flex-1 bg-black/30" onClick={() => setMobileOpen(false)} />
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 md:p-6 print:overflow-visible print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
