/**
 * App.jsx — Root application component.
 * Sets up React Router, AntD ConfigProvider with theme, Auth context,
 * Theme context, and route definitions with protected/public guards.
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import MRF from './pages/MRF';
import Settings from './pages/Settings';
import HRUpload from './pages/HRUpload';
import CandidateScreening from './pages/CandidateScreening';
import Analytics from './pages/Analytics';
import EmailManagement from './pages/EmailManagement';
import NotFound from './pages/NotFound';
import MissingJdUpload from './pages/MissingJdUpload';

/* ---- Route Guards ---- */

/**
 * ProtectedRoute — Redirects to /login if not authenticated.
 * Shows a loading spinner while auth state is being verified.
 */
function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();

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
    const isAdminPath = window.location.pathname.startsWith('/admin');
    return <Navigate to={isAdminPath ? "/admin/login" : "/login"} replace />;
  }

  return children;
}

/**
 * PublicRoute — Redirects authenticated users away from login to dashboard.
 */
function PublicRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();

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
    const isAdminPath = window.location.pathname.startsWith('/admin');
    return <Navigate to={isAdminPath ? "/admin/dashboard" : "/dashboard"} replace />;
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
              <Route path="/vendor" element={<VendorPortal />} />
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
