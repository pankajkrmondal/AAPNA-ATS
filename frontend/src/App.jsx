/**
 * App.jsx — Root application component.
 * Sets up React Router, AntD ConfigProvider with theme, Auth context,
 * Theme context, and route definitions with protected/public guards.
 */
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ConfigProvider, App as AntApp, Spin } from 'antd';

import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import useAuth from './hooks/useAuth';
import useTheme from './hooks/useTheme';
import { lightTheme, darkTheme } from './theme/themeConfig';

/* Layouts */
import MainLayout from './layouts/MainLayout';
import AuthLayout from './layouts/AuthLayout';

/* Pages */
import Login from './pages/Login';
import AdminLogin from './pages/AdminLogin';
import Dashboard from './pages/Dashboard';
import AdminDashboard from './pages/AdminDashboard';
import Candidates from './pages/Candidates';
import CandidateDetail from './pages/CandidateDetail';
import VendorPortal from './pages/VendorPortal';
import VendorDashboard from './pages/VendorDashboard';
import MRF from './pages/MRF';
import Settings from './pages/Settings';
import HRUpload from './pages/HRUpload';
import CandidateScreening from './pages/CandidateScreening';
import Analytics from './pages/Analytics';
import EmailManagement from './pages/EmailManagement';
import NotFound from './pages/NotFound';
import MissingJdUpload from './pages/MissingJdUpload';
import MrfSubmit from './pages/MrfSubmit';
import MrfApprovalAction from './pages/MrfApprovalAction';

/* ---- Route Guards ---- */

/**
 * The home path an authenticated user should land on, derived from their role
 * (not from the URL). Vendors go to their dedicated dashboard; everyone else
 * to the standard dashboard. Admins reach the admin portal via its own button.
 */
function roleHomePath(user) {
  const role = (user?.role || '').toLowerCase();
  if (role === 'vendor') return '/vendor-dashboard';
  return '/dashboard';
}

/**
 * ProtectedRoute — Redirects to /login if not authenticated.
 * Shows a loading spinner while auth state is being verified.
 */
function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--ink)',
      }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!isAuthenticated) {
    const isAdminPath = location.pathname.startsWith('/admin');
    return <Navigate to={isAdminPath ? "/admin/login" : "/login"} replace />;
  }

  return children;
}

/**
 * PublicRoute — Redirects authenticated users away from login pages.
 * Destination is based on the user's ROLE, not the URL, so a non-admin can
 * never be sent to (and flash) the admin dashboard. Only a user who both has
 * admin rights AND arrived via the admin portal lands on /admin/dashboard.
 */
function PublicRoute({ children }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--ink)',
      }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isAuthenticated) {
    const role = (user?.role || '').toLowerCase();
    const isAdmin = role === 'admin' || role === 'superadmin';
    const onAdminPath = location.pathname.startsWith('/admin');
    const target = onAdminPath && isAdmin ? '/admin/dashboard' : roleHomePath(user);
    return <Navigate to={target} replace />;
  }

  return children;
}

/**
 * AdminRoute — Redirects standard users away from admin dashboard.
 * Only allows user roles that include 'admin' or 'superadmin'.
 */
function AdminRoute({ children }) {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--ink)',
      }}>
        <Spin size="large" />
      </div>
    );
  }

  const hasAdminRole = user?.role && ['admin', 'superadmin'].includes(user.role.toLowerCase());

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  if (!hasAdminRole) {
    return <Navigate to={roleHomePath(user)} replace />;
  }

  return children;
}

/**
 * ModuleRoute — Gates a route behind a module permission key.
 * Mirrors the backend `checkModuleAccess` middleware: admins/superadmins
 * bypass; everyone else needs the module key in their permissions array.
 * Redirects to /dashboard if the module is not enabled for the user.
 */
function ModuleRoute({ moduleKey, children }) {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--ink)',
      }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const role = (user?.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';
  const hasModule = (user?.permissions || []).includes(moduleKey);

  if (!isAdmin && !hasModule) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

/**
 * Placeholder page for routes that haven't been built yet.
 */
function ComingSoon({ title }) {
  return (
    <div className="page-enter" style={{ textAlign: 'center', padding: '80px 20px' }}>
      <div
        style={{
          fontSize: 56,
          marginBottom: 16,
          animation: 'float 3s ease-in-out infinite',
        }}
      >
        🚧
      </div>
      <h2 style={{ fontWeight: 700, marginBottom: 8 }}>{title}</h2>
      <p style={{ color: 'var(--text-2)' }}>This page is under construction. Check back soon!</p>
    </div>
  );
}

/* ---- Theme-Aware App Shell ---- */

function AppShell() {
  const { isDark } = useTheme();
  const currentTheme = isDark ? darkTheme : lightTheme;

  return (
    <ConfigProvider theme={currentTheme}>
      <AntApp>
        <BrowserRouter>
          <Routes>
            {/* Public (auth) routes */}
            <Route
              element={
                <PublicRoute>
                  <AuthLayout />
                </PublicRoute>
              }
            >
              <Route path="/login" element={<Login />} />
              <Route path="/admin/login" element={<AdminLogin />} />
            </Route>

            {/* Public candidate missing data route */}
            <Route path="/missing-jd-upload" element={<MissingJdUpload />} />

            {/* Public MRF submission & approval routes */}
            <Route path="/mrf-submit" element={<MrfSubmit />} />
            <Route path="/mrf/:id/approve" element={<MrfApprovalAction />} />

            {/* Protected (app) routes */}
            <Route
              element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route 
                path="/admin/dashboard" 
                element={
                  <AdminRoute>
                    <AdminDashboard />
                  </AdminRoute>
                } 
              />
              <Route path="/candidates" element={<Candidates />} />
              <Route path="/candidates/:id" element={<CandidateDetail />} />
              <Route path="/hr-upload" element={<HRUpload />} />
              <Route path="/mrf" element={<MRF />} />
              {/* Vendor's home base — must always render for a vendor so the
                  MainLayout confinement redirect can't form a loop with a
                  ModuleRoute fallback. Data access is still enforced by the
                  backend `vendor_dashboard` module check. */}
              <Route path="/vendor-dashboard" element={<VendorDashboard />} />
              <Route
                path="/vendor"
                element={
                  <ModuleRoute moduleKey="vendor_upload">
                    <VendorPortal />
                  </ModuleRoute>
                }
              />
              <Route path="/filtering" element={<CandidateScreening />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/email" element={<EmailManagement />} />
              <Route path="/settings" element={<Settings />} />
            </Route>

            {/* Redirects & 404 */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}

/* ---- Root App (wraps everything with providers) ---- */

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ThemeProvider>
  );
}
