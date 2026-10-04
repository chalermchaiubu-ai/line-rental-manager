import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

// ----------------------------------------------------------------------------
// Staff identity model
// ----------------------------------------------------------------------------
// Login is Supabase Auth (email + password). The signed-in auth user is then
// matched to a row in `staff_users` to get role / full_name / active.
//
// We don't yet know for certain which column links staff_users -> auth.users
// in this project (the bot's server.js only ever reads staff_users with the
// service_role key, so it never needed to care). Two schemas are common:
//   (a) staff_users.id IS the same uuid as auth.users.id (shared PK), or
//   (b) staff_users.auth_user_id references auth.users.id
// We try (a) first, then (b), so this keeps working either way. If neither
// matches, we surface a clear "account not linked" error instead of a blank
// screen — see sql/001_staff_auth_link.sql for how the owner links a new
// Supabase Auth user to their staff_users row.
// ----------------------------------------------------------------------------

const AuthContext = createContext(null);

async function fetchStaffProfile(authUser) {
  if (!authUser) return null;

  // Try (a): staff_users.id == auth.uid()
  const byId = await supabase.from('staff_users').select('*').eq('id', authUser.id).maybeSingle();
  if (byId.data) return byId.data;

  // Try (b): staff_users.auth_user_id == auth.uid()
  // (Wrapped so that a missing column doesn't throw — Postgres will error
  // with an "undefined column" message we can safely ignore here.)
  try {
    const byLink = await supabase
      .from('staff_users')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();
    if (byLink.data) return byLink.data;
  } catch {
    // column doesn't exist — ignore, fall through to "not linked"
  }

  return null;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [staff, setStaff] = useState(undefined); // undefined = loading, null = not linked
  const [staffError, setStaffError] = useState(null);

  // Which auth user the current `staff` value belongs to, and a counter so a
  // slow, outdated profile fetch can't overwrite a newer one.
  const loadedForUserId = useRef(undefined);
  const requestSeq = useRef(0);

  const loadStaff = useCallback(async (authUser) => {
    const userId = authUser?.id ?? null;
    // Token refreshes / duplicate auth events for the same user: keep what we
    // already have instead of flashing the loading screen again.
    if (userId === loadedForUserId.current) return;
    loadedForUserId.current = userId;
    const seq = ++requestSeq.current;

    if (!authUser) {
      setStaff(null);
      setStaffError(null);
      return;
    }

    // New user just signed in: go back to "loading" so RequireAuth shows the
    // spinner rather than the old signed-out `staff = null` (which rendered
    // "ไม่สามารถเข้าใช้งานได้" for a moment right after login).
    setStaff(undefined);
    setStaffError(null);
    try {
      const profile = await fetchStaffProfile(authUser);
      if (seq !== requestSeq.current) return;
      if (!profile) {
        setStaff(null);
        setStaffError(
          'บัญชีนี้ล็อกอินสำเร็จ แต่ยังไม่ได้เชื่อมกับพนักงานในระบบ (staff_users) กรุณาติดต่อเจ้าของ/ผู้ดูแลระบบ'
        );
      } else if (profile.active === false) {
        setStaff(null);
        setStaffError('บัญชีพนักงานนี้ถูกปิดใช้งานแล้ว กรุณาติดต่อเจ้าของ');
      } else {
        setStaff(profile);
        setStaffError(null);
      }
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setStaff(null);
      setStaffError(err.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูลพนักงาน');
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      loadStaff(data.session?.user ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      loadStaff(newSession?.user ?? null);
    });

    return () => sub.subscription.unsubscribe();
  }, [loadStaff]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = {
    session,
    staff, // { id, role: 'owner'|'admin'|'staff', full_name, phone, active, ... } | null
    staffError,
    loading: session === undefined || staff === undefined,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
