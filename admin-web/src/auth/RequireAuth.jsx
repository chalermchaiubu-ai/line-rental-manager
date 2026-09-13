import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { can } from './permissions';

export function RequireAuth({ children }) {
  const { session, staff, loading, staffError } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">
        กำลังโหลด...
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!staff) {
    return (
      <div className="flex h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-semibold text-red-700">ไม่สามารถเข้าใช้งานได้</p>
          <p className="mt-2 text-sm text-red-600">{staffError}</p>
        </div>
      </div>
    );
  }

  return children;
}

// Wrap a route element to also require a specific permission from
// src/auth/permissions.js. Renders a friendly "no access" page instead of
// just hiding the nav link, per spec section 5 ("ห้ามใช้แค่การซ่อนปุ่ม").
export function RequirePermission({ permission, children }) {
  const { staff } = useAuth();
  if (!staff || !can(staff.role, permission)) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="font-semibold text-amber-700">ไม่มีสิทธิ์เข้าถึงหน้านี้</p>
          <p className="mt-2 text-sm text-amber-600">
            บัญชีของคุณ ({staff?.role || '-'}) ไม่มีสิทธิ์ดูส่วนนี้ กรุณาติดต่อเจ้าของ/ผู้ดูแลระบบหากคิดว่าไม่ถูกต้อง
          </p>
        </div>
      </div>
    );
  }
  return children;
}
