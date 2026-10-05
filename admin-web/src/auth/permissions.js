// ----------------------------------------------------------------------------
// Frontend permission matrix — mirrors section 5 of the spec. This ONLY
// controls what the UI shows/allows; it is not the security boundary.
// The real boundary is Supabase Row Level Security (RLS) on each table,
// gated by the DB's existing is_staff()/is_owner_or_admin() functions —
// every page here must still work correctly if someone bypasses the UI
// and calls Supabase directly, because RLS will reject unauthorized rows.
// ----------------------------------------------------------------------------

export const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  STAFF: 'staff',
};

// Capabilities keyed by permission name -> roles allowed.
export const CAN = {
  VIEW_FINANCIALS: [ROLES.OWNER],
  VIEW_RENT_PRICING: [ROLES.OWNER],
  VIEW_DEPOSIT: [ROLES.OWNER],
  VERIFY_PAYMENT: [ROLES.OWNER],
  CANCEL_BILL: [ROLES.OWNER],
  MANAGE_USERS: [ROLES.OWNER],
  VIEW_AUDIT_LOG: [ROLES.OWNER],

  MANAGE_ROOMS: [ROLES.OWNER, ROLES.ADMIN],
  MANAGE_TENANTS: [ROLES.OWNER, ROLES.ADMIN],
  MANAGE_LEASES: [ROLES.OWNER, ROLES.ADMIN],
  GENERATE_BILL: [ROLES.OWNER, ROLES.ADMIN],
  MANAGE_SETTINGS: [ROLES.OWNER, ROLES.ADMIN],
  MANAGE_MOVE_OUT: [ROLES.OWNER, ROLES.ADMIN],

  VIEW_ROOMS: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],
  ENTER_METER: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],
  HANDLE_MAINTENANCE: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],
};

export function can(role, permission) {
  const allowed = CAN[permission];
  if (!allowed) return false;
  return allowed.includes(role);
}

// Nav items — each entry's `permission` (if any) gates visibility in the sidebar.
export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'home' },
  { to: '/rooms', label: 'ห้องพัก', icon: 'building', permission: 'VIEW_ROOMS' },
  { to: '/tenants', label: 'ผู้เช่า / เชื่อม LINE', icon: 'users', permission: 'VIEW_ROOMS' },
  { to: '/meters', label: 'มิเตอร์', icon: 'gauge', permission: 'ENTER_METER' },
  { to: '/meter-summary', label: 'สรุป/พิมพ์ค่าน้ำไฟ', icon: 'receipt', permission: 'GENERATE_BILL' },
  { to: '/print-bills', label: 'พิมพ์บิล (ฟอร์ม)', icon: 'receipt', permission: 'GENERATE_BILL' },
  { to: '/bills', label: 'บิล', icon: 'receipt', permission: 'VIEW_ROOMS' },
  { to: '/payments', label: 'การชำระเงิน', icon: 'wallet', permission: 'VIEW_ROOMS' },
  { to: '/maintenance', label: 'งานซ่อม', icon: 'wrench', permission: 'HANDLE_MAINTENANCE' },
  { to: '/move-out', label: 'ย้ายออก', icon: 'logout', permission: 'VIEW_ROOMS' },
  { to: '/reports', label: 'รายงาน', icon: 'chart', permission: 'MANAGE_ROOMS' },
  { to: '/settings', label: 'ตั้งค่า', icon: 'settings', permission: 'MANAGE_SETTINGS' },
];
