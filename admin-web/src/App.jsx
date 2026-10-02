import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RequirePermission } from './auth/RequireAuth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Rooms from './pages/Rooms';
import Tenants from './pages/Tenants';
import MeterEntry from './pages/MeterEntry';
import BillGeneration from './pages/BillGeneration';
import PaymentVerification from './pages/PaymentVerification';
import ComingSoon from './pages/ComingSoon';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route
              path="rooms"
              element={
                <RequirePermission permission="VIEW_ROOMS">
                  <Rooms />
                </RequirePermission>
              }
            />
            <Route
              path="tenants"
              element={
                <RequirePermission permission="VIEW_ROOMS">
                  <Tenants />
                </RequirePermission>
              }
            />
            <Route
              path="meters"
              element={
                <RequirePermission permission="ENTER_METER">
                  <MeterEntry />
                </RequirePermission>
              }
            />
            <Route
              path="bills"
              element={
                <RequirePermission permission="VIEW_ROOMS">
                  <BillGeneration />
                </RequirePermission>
              }
            />
            <Route
              path="payments"
              element={
                <RequirePermission permission="VIEW_ROOMS">
                  <PaymentVerification />
                </RequirePermission>
              }
            />
            <Route
              path="maintenance"
              element={
                <RequirePermission permission="HANDLE_MAINTENANCE">
                  <ComingSoon title="งานซ่อม" />
                </RequirePermission>
              }
            />
            <Route
              path="move-out"
              element={
                <RequirePermission permission="VIEW_ROOMS">
                  <ComingSoon title="ย้ายออก" />
                </RequirePermission>
              }
            />
            <Route
              path="reports"
              element={
                <RequirePermission permission="MANAGE_ROOMS">
                  <ComingSoon title="รายงาน" />
                </RequirePermission>
              }
            />
            <Route
              path="settings"
              element={
                <RequirePermission permission="MANAGE_SETTINGS">
                  <ComingSoon title="ตั้งค่า" />
                </RequirePermission>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
