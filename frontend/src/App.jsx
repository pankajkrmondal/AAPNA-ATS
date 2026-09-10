/**
 * App.jsx — Root application component.
 * Sets up React Router, AntD ConfigProvider with theme, Auth context,
 * Theme context, and route definitions with protected/public guards.
 */
import { useEffect, useMemo, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ConfigProvider, App as AntApp, Spin } from 'antd';
import { useQueryClient } from '@tanstack/react-query';

import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { BrandProvider } from './context/BrandContext';
import { DesignProvider } from './context/DesignContext';
import useAuth from './hooks/useAuth';
import useTheme from './hooks/useTheme';
import useBrand from './hooks/useBrand';
import useDesign from './hooks/useDesign';
import { buildAntdTheme } from './theme/themeConfig';
import { DesignScope } from './ui';
import screeningService from './services/screeningService';
import { screeningKeys } from './hooks/useScreeningData';

/* Layouts */
import MainLayout from './layouts/MainLayout';
import AuthLayout from './layouts/AuthLayout';

/* Pages */
import Login from './pages/Login';
import AdminLogin from './pages/AdminLogin';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
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

/* The design-system gallery.
   The conditional wraps the `lazy()` call itself, not just the route. Vite replaces
   `import.meta.env.DEV` with a literal `false` at build time, so in production this
   whole expression folds to `null` and Rollup drops the dynamic import with it —
   nothing for the gallery is emitted at all. Gating only the <Route> would still
   have shipped the chunk (~27 kB JS + 21 kB CSS of prototype screens and fixtures);
   it would never be fetched, but it would sit in dist. */
const DesignLab = import.meta.env.DEV
  ? lazy(() => import('./pages/design-lab/DesignLab'))
  : null;
import MissingJdUpload from './pages/MissingJdUpload';
import MrfSubmit from './pages/MrfSubmit';
import MrfApprovalAction from './pages/MrfApprovalAction';
// Retired 2026-08-29 — see the commented route below. Import kept so the file stays
// referenced and the restore is a single uncomment.
// eslint-disable-next-line no-unused-vars
import CandidatePipelinePrototype from './pages/CandidatePipelinePrototype';
import Pipeline from './pages/Pipeline';
import ErrorBoundary from './components/common/ErrorBoundary';
import InterviewScorecard from './pages/InterviewScorecard';
import DocumentUpload from './pages/DocumentUpload';

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
      <div className="cmp-loading cmp-loading--page">
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
      <div className="cmp-loading cmp-loading--page">
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
      <div className="cmp-loading cmp-loading--page">
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
      <div className="cmp-loading cmp-loading--page">
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
      <div className="ac-emoji">
        🚧
      </div>
      <h2 className="ac-title">{title}</h2>
      <p className="cmp-ink">This page is under construction. Check back soon!</p>
    </div>
  );
}

/* ---- Theme-Aware App Shell ---- */

/**
 * OVERLAY_CONFIG — the tier-4 (overlay) glass, applied app-wide in one place.
 *
 * Modals, drawers and every popup panel portal into `document.body`, which puts
 * them structurally OUTSIDE the `.ats-v2` wrapper MainLayout applies. No route
 * gate can reach them and no stylesheet scoped to `.ats-v2` can style them, so
 * the ~40 dialogs in the app opened as flat white boxes on a glass page.
 *
 * Rather than edit 40 call sites (and re-edit every new one), ConfigProvider
 * stamps the class onto every instance wherever it portals to. The matching
 * rules live UNSCOPED in aurora-glass.css — a deliberate scope exception,
 * documented there, because portals are outside the scope by construction.
 *
 * Slot names verified against the installed antd 5.29.3: `content`/`mask` on
 * rc-dialog's ModalClassNames and rc-drawer's DrawerClassNames;
 * `classNames.popup.root` on Select/DatePicker; `classNames.root` on
 * Tooltip/Popover/Popconfirm. `dropdown` is a plain ComponentStyleConfig
 * (className only, no slots) — its className lands on the popup root, which is
 * the element we want, so it works the same way.
 *
 * To revert the overlay tier entirely: delete this object, its five spreads
 * below, and the tier-4 block in aurora-glass.css.
 */
const OVERLAY_CONFIG = {
  modal: { classNames: { content: 'ats-overlay', mask: 'ats-overlay-mask' } },
  drawer: { classNames: { content: 'ats-overlay', mask: 'ats-overlay-mask' } },
  select: { classNames: { popup: { root: 'ats-overlay-popup' } } },
  datePicker: { classNames: { popup: { root: 'ats-overlay-popup' } } },
  dropdown: { className: 'ats-overlay-popup' },
  tooltip: { classNames: { root: 'ats-overlay-tip' } },
  popover: { classNames: { root: 'ats-overlay-popup' } },
  popconfirm: { classNames: { root: 'ats-overlay-popup' } },
};

/**
 * ForceLight — pins a subtree to the light theme regardless of the app theme.
 * Used for public token-link pages (candidate/approver-facing forms opened
 * from emails) that are designed light and offer no theme toggle. The
 * data-theme="light" wrapper re-scopes the CSS variables (see the
 * `:root, [data-theme='light']` selector in theme/index.css); the nested
 * ConfigProvider pins AntD tokens.
 */
/* ForceLight is now DesignScope with the mode pinned.
   It used to be a bespoke ConfigProvider + data-theme wrapper doing by hand what
   DesignScope does — and, being separate, it did NOT give these routes the preset's
   geometry, so a converted public page would have had V3 surfaces wrapped around
   legacy-sized AntD controls. One wrapper, one behaviour.

   Mode is pinned because these pages are opened from an email by someone who is not
   the operator; inheriting a dark session would render an always-light page dark. */
function ForceLight({ children }) {
  return (
    <DesignScope mode="light" style={{ minHeight: '100vh' }}>
      {children}
    </DesignScope>
  );
}

function AppShell() {
  const { isDark } = useTheme();
  const { brandId } = useBrand();
  const { presetId, fontPackId, density } = useDesign();
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  // The AntD half of the design system. AntD generates real CSS from JS values and
  // cannot read a custom property, so it is fed from the same brand/preset/font
  // sources that produce the CSS variables — see theme/themeConfig.js. Before this,
  // AntD's palette was 91 frozen hexes and a brand switch left every control on the
  // old colour.
  const currentTheme = useMemo(
    () => buildAntdTheme({
      brandId, presetId, fontPackId, mode: isDark ? 'dark' : 'light', density,
    }),
    [brandId, presetId, fontPackId, isDark, density],
  );

  // Preload the Screening (JD Filtering) roles once at app load, so the dropdown is
  // warm before the user navigates to /filtering. Gated on the same access rule as the
  // route (admins bypass; others need the candidate_screening module) to avoid wasted calls.
  useEffect(() => {
    if (!isAuthenticated) return;
    const role = (user?.role || '').toLowerCase();
    const isAdmin = role === 'admin' || role === 'superadmin';
    const hasModule = (user?.permissions || []).includes('candidate_screening');
    if (!isAdmin && !hasModule) return;
    queryClient.prefetchQuery({
      queryKey: screeningKeys.roles,
      queryFn: screeningService.getRoles,
      staleTime: Infinity,
    });
  }, [isAuthenticated, user, queryClient]);

  return (
    // `{...OVERLAY_CONFIG}` is the tier-4 overlay glass — see the constant above.
    // The ForceLight provider wrapping the public token routes is nested under
    // this one and leaves these keys undefined, so it inherits them: dialogs on
    // the public pages get the same material, resolved against light tokens.
    <ConfigProvider theme={currentTheme} {...OVERLAY_CONFIG}>
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
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
            </Route>

            {/* Public candidate missing data route (always light — external users) */}
            <Route path="/missing-jd-upload" element={<ForceLight><MissingJdUpload /></ForceLight>} />

            {/* Public MRF submission & approval routes (always light — external users) */}
            <Route path="/mrf-submit" element={<ForceLight><MrfSubmit /></ForceLight>} />
            <Route path="/mrf/:id/approve" element={<ForceLight><MrfApprovalAction /></ForceLight>} />

            {/* Public interviewer scorecard (no login — opened from an emailed link) */}
            <Route path="/scorecard/:token" element={<ForceLight><InterviewScorecard /></ForceLight>} />

            {/* Public candidate document upload (no login — opened from an emailed link) */}
            <Route path="/documents/:token" element={<ForceLight><DocumentUpload /></ForceLight>} />

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
              {/* Real Pipeline Tracker (Module 1) — persists to /api/pipeline,
                  sends real outcome emails. This is "Candidate Pipeline" in the
                  sidebar. */}
              <Route
                path="/pipeline"
                element={
                  <ModuleRoute moduleKey="recruitment_pipeline">
                    <ErrorBoundary>
                      <Pipeline />
                    </ErrorBoundary>
                  </ModuleRoute>
                }
              />
              {/* Phase 3 walkthrough demo (mock data only). Retired from the
                  sidebar but still routable for client walkthroughs and as the
                  design reference PipelineDrawer / AssessmentImportModal /
                  DecisionEmailModal cite.

                  Now behind the SAME module guard as the real page: it was a
                  bare route, so a user explicitly denied the recruitment_pipeline
                  module could still open a full pipeline UI and act on it. The
                  data was fake, but the access check was too. */}
              {/* RETIRED 2026-08-29 (Design System V3, Stage 5) — commented, not
                  deleted, per this repo's no-delete rule.

                  WHY IT IS OFF: the demo shares its `.cp-candidate-card`, `.cp-avatar`
                  and `.cp-progress-seg` classes with the REAL board (pages/Pipeline.jsx).
                  Any V3 rule written for the live board during Stage 5.6 would land on
                  this screen too, silently, on a page nobody reviews — the coupling is
                  recorded in §I.4 of the rollout plan. Taking the route out of service
                  frees 5.6 to change those classes.

                  It is also mock data behind a real module permission, and it is off the
                  sidebar, so nothing in normal use reaches it.

                  TO RESTORE: uncomment this block and the `/candidate-pipeline-prototype`
                  entry in V2_ROUTES (layouts/MainLayout.jsx). The page file is untouched
                  at pages/CandidatePipelinePrototype.jsx.
              <Route
                path="/candidate-pipeline-prototype"
                element={
                  <ModuleRoute moduleKey="recruitment_pipeline">
                    <CandidatePipelinePrototype />
                  </ModuleRoute>
                }
              />
              */}

              <Route path="/email" element={<EmailManagement />} />
              <Route path="/settings" element={<Settings />} />
            </Route>

            {/* Design-system gallery — development only, and outside every layout
                and guard on purpose: it must render with no backend and no session,
                which is also what makes it usable for verification. */}
            {import.meta.env.DEV && (
              <Route
                path="/design-lab"
                element={(
                  <Suspense fallback={<div style={{ padding: 40 }}><Spin /></div>}>
                    <DesignLab />
                  </Suspense>
                )}
              />
            )}

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
      {/* BrandProvider is the per-organization theming axis (theme/brands.js). It is
          independent of ThemeProvider's light/dark: it publishes `-light`/`-dark`
          token pairs and index.css selects between them, so the two nest in either
          order. It sits inside so a future server-driven theme can read auth. */}
      <BrandProvider>
        {/* DesignProvider owns preset / font pack / density. It sits inside
            BrandProvider because buildAntdTheme composes brand AND design, and
            outside AuthProvider for the same reason BrandProvider is — a future
            server-driven design config reads auth, so the seam stays open. */}
        <DesignProvider>
          <AuthProvider>
            <AppShell />
          </AuthProvider>
        </DesignProvider>
      </BrandProvider>
    </ThemeProvider>
  );
}
