/**
 * MainLayout — Primary app shell with a left collapsible sidebar navigation.
 * The sidebar holds the brand + nav menu (icon rail when collapsed); a slim top
 * bar carries the page title, Admin Portal access, and the user menu.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation, useNavigationType, Navigate } from 'react-router-dom';
import {
  Layout,
  Menu,
  // Button now comes from src/ui — see the import below.
  Avatar,
  Dropdown,
  Input,
  Breadcrumb,
  // Typography/Text retired 2026-08-31 with .ml-page-title — see the topbar below.
  Space,
  Tooltip,
} from 'antd';
import { Button } from '../ui';
import CommandPalette from '../components/dashboard/CommandPalette';
import {
  DashboardOutlined,
  SolutionOutlined,
  FileTextOutlined,
  ShopOutlined,
  FilterOutlined,
  ApartmentOutlined,
  BarChartOutlined,
  MailOutlined,
  SearchOutlined,
  UserOutlined,
  KeyOutlined,
  LogoutOutlined,
  UploadOutlined,
  SettingOutlined,
  AuditOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';

import useAuth from '../hooks/useAuth';
import useTheme from '../hooks/useTheme';
import useBrand from '../hooks/useBrand';
import ThemeToggle from '../components/common/ThemeToggle';
import ChangePasswordModal from '../components/common/ChangePasswordModal';
import AmbientBackdrop from '../components/common/AmbientBackdrop';
import AapnaLogo from '../components/common/AapnaLogo';
import NotificationBell from '../components/common/NotificationBell';
// The admin branch below is a separate shell and its rules live with the route it
// serves. Imported here as well as in the page: the bundler dedupes it, and relying
// on the page having been loaded first would leave the shell unstyled the moment
// AdminDashboard becomes lazy.
import '../styles/pages/admin-dashboard.css';
import '../styles/shell.css';

const { Header, Content, Sider } = Layout;
/* RETIRED 2026-08-31 with the topbar page title: const { Text } = Typography; */

const SIDEBAR_COLLAPSED_KEY = 'ats.sidebarCollapsed';

/** Admin Portal glyph — a person with a small gear badge ("manage accounts").
 *  AntD has no single person+gear icon, so we compose UserOutlined + a small
 *  SettingOutlined. Inherits color/size (em-based) from the surrounding text. */
function AdminPortalIcon() {
  return (
    <span className="ml-admin-icon">
      <UserOutlined />
      <SettingOutlined className="ml-admin-icon__gear" />
    </span>
  );
}

/** Navigation menu items */
const MENU_ITEMS = [
  { key: '/dashboard',  icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/candidates', icon: <SolutionOutlined />,  label: 'Search Candidate' },
  { key: '/hr-upload',  icon: <UploadOutlined />,    label: 'HR Manual Upload' },
  { key: '/mrf',        icon: <FileTextOutlined />,  label: 'MRF' },
  { key: '/vendor',     icon: <ShopOutlined />,      label: 'Vendor Upload' },
  { key: '/filtering',  icon: <FilterOutlined />,    label: 'Candidate Screening' },
  // The REAL Pipeline Tracker (Module 1) — persists to /api/pipeline and sends
  // real outcome emails. It takes the plain "Candidate Pipeline" name because it
  // is the pipeline; the mock walkthrough page used to hold that name and sat
  // ABOVE this entry with an identical icon, so anyone looking for the pipeline
  // clicked the demo and saw invented candidates.
  //
  // The demo page is deliberately NOT listed here any more. Its route is still
  // live at /candidate-pipeline-prototype for client walkthroughs and as the
  // design reference several components cite — it is just no longer something
  // you can land on by accident.
  { key: '/pipeline', icon: <ApartmentOutlined />, label: 'Candidate Pipeline' },
  { key: '/analytics',  icon: <BarChartOutlined />,  label: 'Recruitment Analytics' },
  { key: '/email',      icon: <MailOutlined />,      label: 'Email Templates' },
  { key: '/settings',   icon: <SettingOutlined />,   label: 'Settings' },
];

/** Navigation menu shown to vendors — restricted to their own surfaces. */
const VENDOR_MENU_ITEMS = [
  { key: '/vendor-dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/vendor',           icon: <UploadOutlined />,    label: 'Upload Candidate' },
];

/** Path prefixes a vendor is allowed to visit; anything else redirects. */
const VENDOR_ALLOWED_PATHS = ['/vendor-dashboard', '/vendor'];

/** Routes converted to Design V2 ("Aurora Glass") so far. The rollout is phased
 *  route-by-route rather than flipped on in one shot — see the phase list in
 *  UI-CHANGELOG.md. A route only belongs here once its cards actually carry the
 *  class names aurora-glass.css targets; adding one whose page is still flat
 *  produces the worst of both worlds (glass chrome, opaque content).
 *
 *  Phase 0 — CSS groundwork only, no route.
 *  Phase 1 — /filtering, plus the candidate detail view.
 *  Phase 3 — /candidates. The prefix match now covers /candidates/:id too, so
 *            the separate regex that used to sit in `isV2` is gone.
 *  Phase 4 — /pipeline. Note this does NOT pull in
 *            /candidate-pipeline-prototype, which shares the `.cp-*` classes;
 *            the scoped rules stay inert there until Phase 8 decides its fate.
 *  Phase 5 — /hr-upload, /vendor, /vendor-dashboard, /mrf, SHIPPED AS ONE UNIT.
 *            Per VENDOR_ALLOWED_PATHS above, /vendor and /vendor-dashboard are
 *            the entire reachable app for the `vendor` role, so converting one
 *            alone would flip a vendor's chrome between glass and flat on every
 *            click. Do not split them.
 *  Phase 6 — /analytics. Needed a JSX change the gate could not make on its
 *            own: its tab container carried the bare `.glass` class, which
 *            aurora-glass.css never touches.
 *  Phase 7 — /settings, /email. `/email`'s three panes carried the same bare
 *            `.glass` landmine and were renamed the same way.
 *  Phase 8 — /candidate-pipeline-prototype, plus the ADMIN PORTAL, which is not
 *            in this list: it is a separate shell handled by the `isAdminPath`
 *            branch below, which now applies `.ats-v2` itself.
 *
 *  With Phase 8 in, every route the sidebar can reach is converted. */
/* RETIRED 2026-08-29 (Stage 5.8) — the rollout gate, now describing nothing: every
   route on this list is converted, and so is every route not on it. Kept per the
   no-delete rule; see the note on `isV2` below for how to stage a rollout again.
const V2_ROUTES = [
  '/dashboard', '/filtering', '/candidates', '/pipeline',
  '/hr-upload', '/vendor', '/vendor-dashboard', '/mrf',
  '/analytics', '/settings', '/email',
  // Retired 2026-08-29 with the route in App.jsx — uncomment both to restore.
  // '/candidate-pipeline-prototype',
];
*/

/** Roles that get the Vendor Dashboard nav item (to review vendor submissions). */
const VENDOR_DASHBOARD_ROLES = ['admin', 'superadmin', 'recruiter'];
const VENDOR_DASHBOARD_MENU_ITEM = { key: '/vendor-dashboard', icon: <AuditOutlined />, label: 'Vendor Dashboard' };

/** Map paths to breadcrumb labels */
const BREADCRUMB_MAP = {
  dashboard: 'Dashboard',
  'vendor-dashboard': 'Vendor Dashboard',
  candidates: 'Search Candidate',
  'hr-upload': 'HR Manual Upload',
  mrf: 'MRF',
  vendor: 'Vendor Manual Upload',
  filtering: 'Candidate Screening',
  // Kept even though the demo is off the sidebar — a direct visit still needs a
  // correct trail, and the "(Demo)" suffix is the tell that this isn't the real
  // board.
  'candidate-pipeline-prototype': 'Candidate Pipeline (Demo — mock data)',
  pipeline: 'Candidate Pipeline',
  analytics: 'Recruitment Analytics',
  email: 'Email Template Management',
  settings: 'Settings',
};

/**
 * Titles for nested routes, keyed by the FIRST segment.
 *
 * The map above is keyed on `pathSegments[0]` alone, so `/candidates/:id` inherited
 * `/candidates`' label and the topbar read "Search Candidate" while showing one
 * person's record — the chrome contradicting the page. Found 2026-08-31 during the
 * design-lab parity audit.
 *
 * A second map rather than a route-pattern matcher: there is exactly one nested route
 * in the app today, and a matcher would be more machinery than the problem has.
 */
const NESTED_TITLE_MAP = {
  candidates: 'Candidate Details',
};

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();

  /* Scroll to the top of a new route.

     Nothing did this before — no ScrollRestoration, no scrollTo anywhere — so every
     navigation kept the previous offset and dropped you into the middle of the new
     screen. Measured: leaving a route at scrollY 1200 arrived at 1015, and it only
     moved that far because the shorter page clamped the maximum.

     Three deliberate choices:

     useLayoutEffect, not useEffect — it runs before paint, so the new route is never
     shown at the old offset and then yanked.

     pathname ONLY, never location.search — filters, tabs and pagination on several
     screens are query params. Keying on the whole location would scroll the user to
     the top every time they touched a filter, which is worse than the bug.

     Skipped on POP (Back/Forward) — sending someone back to the top of a list they
     just backed out of is the wrong answer. The browser's own history.scrollRestoration
     already returns them to where they were.

     window, not .ant-layout-content: the window is the scroll owner here, measured
     (window.scrollY 1200 while every inner container read 0). */
  useLayoutEffect(() => {
    if (navigationType === 'POP') return;
    window.scrollTo(0, 0);
  }, [location.pathname, navigationType]);

  /* ⌘K command palette — LIFTED OUT OF Dashboard, 2026-08-31.

     CommandPalette was mounted by pages/Dashboard.jsx alone, so a shortcut that reads
     as global worked on exactly one route. It lives in the shell now, with its key
     listener, so every screen can reach it. */
  const [cmdOpen, setCmdOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* The palette filters its commands by module permission. Same three lines as
     Dashboard.jsx:126 and App.jsx:186/296 — a fourth copy, and a shared helper would
     be the right cleanup, but that is a separate change and is called out rather than
     smuggled in here. */
  const isModuleEnabled = (moduleKey) => {
    if ((user?.role || '').toLowerCase() === 'admin') return true;
    return (user?.permissions || []).includes(moduleKey);
  };
  const { user, logout } = useAuth();
  const { isDark } = useTheme();
  const { brand } = useBrand();

  /** Sidebar collapse state — persisted across reloads. */
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  );
  const handleCollapse = (value) => {
    setCollapsed(value);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(value));
  };

  const pathSegments = location.pathname.split('/').filter(Boolean);

  /** Self-service change-password modal (available to every role). */
  const [changePwOpen, setChangePwOpen] = useState(false);

  /** User dropdown menu (Settings lives in the sidebar). */
  const userMenuItems = [
    { key: 'change-password', icon: <KeyOutlined />, label: 'Change Password' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', danger: true },
  ];

  const handleUserMenu = async ({ key }) => {
    if (key === 'change-password') {
      setChangePwOpen(true);
    } else if (key === 'logout') {
      await logout();
      navigate('/login');
    }
  };

  /** Get the currently active menu key */
  let selectedKey = '/' + (pathSegments[0] || 'dashboard');
  if (pathSegments[0] === 'candidates' && pathSegments[1] && location.state?.from === 'analytics') {
    selectedKey = '/analytics';
  }
  const isAdminPath = location.pathname.startsWith('/admin');

  /** Design V2 ("Aurora Glass") gate — see theme/aurora-glass.css.
   *
   *  This one boolean is the entire rollout scope. `.ats-v2` on the outer <Layout>
   *  wraps the Sider, Header AND the <Outlet />, so it scopes the shell chrome and
   *  the page's cards together. That containment is required, not cosmetic:
   *  `.glass-card` / `.glass` are also used by Analytics, EmailManagement and
   *  LoadingSkeleton, which have no ambient canvas behind them — styling those
   *  classes globally would wash out screens later phases have not reached yet.
   *
   *  RETIRED 2026-08-29 (Stage 5.8). Every route is converted, so this boolean was
   *  true everywhere and the gate described nothing. `.ats-v2` is now unconditional on
   *  the outer <Layout> and the canvas mounts on every screen.
   *
   *  Kept per the no-delete rule. To stage a rollout again, uncomment this and put the
   *  conditionals back on the Layout backgrounds and <AmbientBackdrop />.
   *  const isV2 = V2_ROUTES.some(
   *    (p) => location.pathname === p || location.pathname.startsWith(p + '/')
   *  );
   */

  /** Title for the current page, shown in the top bar. Vendors get their own
   *  labels (Upload Candidate / Dashboard) for their restricted surfaces. */
  const pageTitle = (user?.role || '').toLowerCase() === 'vendor'
    ? (selectedKey === '/vendor' ? 'Upload Candidate' : 'Dashboard')
    : ((pathSegments[1] && NESTED_TITLE_MAP[pathSegments[0]])
      || BREADCRUMB_MAP[pathSegments[0]]
      || 'Dashboard');

  /* The trail that replaces the topbar title. On a flat route it is one crumb; on a
     nested one it is parent + child, which is the thing a single title could never
     say — /candidates/:id used to read just "Search Candidate". Real href so it is a
     proper link, intercepted so it stays an SPA navigation. */
  const parentCrumb = BREADCRUMB_MAP[pathSegments[0]];
  const crumbItems = (pathSegments[1] && NESTED_TITLE_MAP[pathSegments[0]] && parentCrumb)
    ? [
      {
        title: (
          <a
            href={'/' + pathSegments[0]}
            onClick={(e) => { e.preventDefault(); navigate('/' + pathSegments[0]); }}
          >
            {parentCrumb}
          </a>
        ),
      },
      { title: pageTitle },
    ]
    : [{ title: pageTitle }];

  const role = (user?.role || '').toLowerCase();
  const isVendor = role === 'vendor';
  const hasAdminAccess = ['admin', 'superadmin'].includes(role);

  // Vendors are confined to their own surfaces. Redirect any other path
  // (including direct URL navigation) to the vendor dashboard. This is the
  // single choke point for all protected routes (MainLayout wraps the Outlet).
  if (isVendor) {
    const allowed = VENDOR_ALLOWED_PATHS.some(
      (p) => location.pathname === p || location.pathname.startsWith(p + '/'),
    );
    if (!allowed) {
      return <Navigate to="/vendor-dashboard" replace />;
    }
  }

  // Tenant badge: superadmin is global; everyone else shows their company.
  const roleKey = (user?.role || '').toLowerCase();
  const isSuperadmin = roleKey === 'superadmin';
  const adminRoleLabel = isSuperadmin ? 'Super Admin' : roleKey === 'admin' ? 'Admin' : (user?.role || '');
  const userInitials = (
    `${(user?.first_name || '')[0] || ''}${(user?.last_name || '')[0] || ''}`.toUpperCase()
    || (user?.username || 'A')[0].toUpperCase()
  );

  // Vendors get a restricted menu; staff additionally get the Vendor Dashboard
  // item (inserted after the Vendor upload entry); everyone else sees the base nav.
  let menuItems;
  if (isVendor) {
    menuItems = VENDOR_MENU_ITEMS;
  } else if (VENDOR_DASHBOARD_ROLES.includes(role)) {
    menuItems = [...MENU_ITEMS];
    const idx = menuItems.findIndex((m) => m.key === '/vendor');
    menuItems.splice(idx + 1, 0, VENDOR_DASHBOARD_MENU_ITEM);
  } else {
    menuItems = MENU_ITEMS;
  }

  if (isAdminPath) {
    // The admin portal is a SEPARATE SHELL — its own topbar, no Sider, its own
    // `.admin-stat` card family and its own `--admin-bg`. Widening `isV2` does
    // nothing here, because this branch never rendered `.ats-v2` and never
    // mounted the canvas; that is why the rollout left it until last.
    //
    // Phase 8 keeps the header-only shape deliberately. Adding a Sider would be
    // a NAVIGATION redesign, which is out of scope for a visual rollout. What it
    // gains is the material: the canvas behind it, `.ats-v2` so every scoped
    // rule in aurora-glass.css reaches this tree too, and tier-1 chrome on the
    // topbar. `background: transparent` lets the canvas show through — the
    // `--admin-bg` fill would otherwise sit on top of it.
    return (
      <Layout className="ats-v2 ad-shell">
        <AmbientBackdrop />
        <Header className="admin-topbar">
          {/* Left: Logo + Sep + Title cluster */}
          <div className="ad-topbar-left">
            {/* Same two fixes as the sidebar brand: `cover` at width 85 sliced the GPTW
                badge off, and inverting a coloured badge in dark mode turned its red
                to cyan. `contain` plus a light chip instead — the chip is now a
                `[data-theme='dark']` rule rather than a spread `isDark &&` object, so
                the mode is read from the cascade instead of from a React state that a
                stylesheet cannot see. */}
            <span className="ad-logo-chip">
              <img
                src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
                alt={brand.name}
                className="ad-logo-img"
              />
            </span>
            <div className="ad-topbar-sep" />
            <div className="ad-topbar-brand">
              <div className="admin-brand-icon"><AdminPortalIcon /></div>
              <div className="ad-topbar-titles">
                <div className="ad-topbar-title-row">
                  <span className="ad-topbar-title">
                    HR Admin
                  </span>
                  <span className={`role-badge role-badge--${isSuperadmin ? 'superadmin' : 'admin'}`}>
                    {adminRoleLabel}
                  </span>
                </div>
                {/* Built from what this account can actually open, not a fixed
                    list: Companies is superadmin-only, so a plain admin was
                    already being promised a tab they do not have. */}
                <span className="ad-topbar-sub">
                  {['Users', 'Access', 'Referrals', ...(isSuperadmin ? ['Companies'] : [])].join(' · ')}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Theme toggle + Portal switch + user chip + Logout */}
          <div className="ad-topbar-right">
            <ThemeToggle />
            {/* `.admin-top-btn` retired here — 2026-08-31. It was a legacy treatment
                written entirely in `!important`: a white fill, a `--gold` label and a
                12px font, none of which the token layer owns any more. Beside a shell
                that is now on the design system it read as the one control nobody had
                converted. `soft` is the system's answer for a labelled secondary
                action, which is what these two portal switches are. */}
            <Button
              emphasis="soft"
              onClick={() => navigate('/dashboard')}
              icon={<DashboardOutlined />}
            >
              Recruitment Portal
            </Button>
            <Dropdown
              menu={{
                items: [{ key: 'change-password', icon: <KeyOutlined />, label: 'Change Password' }],
                onClick: () => setChangePwOpen(true),
              }}
              trigger={['click']}
              placement="bottomRight"
            >
              <div className="admin-user-chip ad-pointer">
                <Avatar size={26} className="ad-user-avatar">
                  {userInitials}
                </Avatar>
                <span>{user?.username || 'Admin'}</span>
              </div>
            </Dropdown>
            {/* Logout keeps its danger meaning but stays quiet at rest: the old
                `--logout` modifier only turned red on hover, and `tone="danger"` with
                `emphasis="text"` is the same statement in the system's vocabulary. */}
            <Button
              emphasis="text"
              tone="danger"
              onClick={async () => {
                await logout();
                navigate('/admin/login');
              }}
              icon={<LogoutOutlined />}
            >
              Logout
            </Button>
          </div>
        </Header>
        {/* Transparent for the same reason as the Layout above, and z-indexed
            over the fixed canvas so content is not painted underneath it. */}
        <Content className="ad-shell-content">
          {/* Keyed by path so the entrance animation replays on every navigation
              (a persistent wrapper would only animate on first mount). */}
          <div className="page-enter" key={location.pathname}>
            <Outlet />
          </div>
        </Content>
        <ChangePasswordModal open={changePwOpen} onClose={() => setChangePwOpen(false)} />
      </Layout>
    );
  }

  return (
    <Layout className="ats-v2 ml-shell">
      {/* The ambient canvas glass refracts. Without something living behind them,
          backdrop-filtered surfaces just return the flat page colour. */}
      <AmbientBackdrop />

      {/* ---- Left Sidebar Navigation ---- */}
      <Sider
        className="glass-sidebar ml-sider"
        theme={isDark ? 'dark' : 'light'}
        width={248}
        collapsedWidth={72}
        collapsible
        collapsed={collapsed}
        onCollapse={handleCollapse}
        trigger={null}
        breakpoint="lg"
        onBreakpoint={(broken) => handleCollapse(broken)}
      >
        {/* Brand */}
        <div
          onClick={() => navigate('/dashboard')}
          className={'ml-sider-brand ' + (collapsed ? 'ml-sider-brand--collapsed' : 'ml-sider-brand--open')}
        >
          {/* Collapsed rail: the vector rotor. A 72px rail cannot show a wide lockup —
              the previous `objectFit: cover` crop left an unreadable "aa" fragment.
              This is still the official symbol: the rotor device at the left of the
              real logo is exactly what AapnaLogo traces. */}
          {collapsed ? (
            <AapnaLogo
              title={`${brand.name} — ${brand.productLabel}`}
              className="ml-logo"
            />
          ) : (
            <>
              {/* Expanded: the official bitmap, UNCROPPED. It was `objectFit: cover`
                  at width 74, which sliced off the Great Place To Work badge and left
                  "CMMIDEV/3 CERTIFIED" dangling — it read as broken rather than
                  certified. `contain` at the lockup's real aspect ratio shows it whole.
                  In dark mode it sits on a light chip rather than being inverted: the
                  GPTW badge is COLOUR, and invert(1) turned its red to cyan. Same
                  approach AuthLayout already uses to keep the coloured logo legible
                  on a dark panel. */}
              {/* SPACE SPLIT: the logo takes all remaining width (flex: 1), the label
                  takes only what its text needs (flex-shrink: 0 + nowrap). Fixed
                  widths here made the logo too small to read the certifications — this
                  way the mark grows to fill whatever the label leaves, at any sidebar
                  width. `contain` + left alignment means it scales without cropping. */}
              <span
                className="ml-logo-wrap"
              >
                <img
                  src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
                  alt={brand.name}
                  className="ml-logo-img"
                />
              </span>
              {/* Product label only. The logo bitmap already reads "aapna", so the
                  old "AAPNA" line above this said the brand name a second time.
                  nowrap keeps it on one line — it previously wrapped to "ATS /
                  PLATFORM", which read as broken. */}
              {/* The divider rule and its inset moved to .ml-product-label in
                  styles/shell.css, 2026-08-31 — as inline styles no stylesheet could
                  reach them, so a preset or tenant brand never could either. */}
              <span className="ml-product-label">
                {brand.productLabel}
              </span>
            </>
          )}
        </div>

        {/* Navigation Menu */}
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          className="ml-menu"
          /* AntD writes this as an INLINE `padding-left` on every item, so no stylesheet
             can reach it — the inline-style law, arriving from the library rather than
             from us. Left at its default 24 the items read 24px/16px asymmetric against
             AntD's own 16px right padding. Set here, at the cause, rather than fought
             with !important from shell.css. Collapsed mode drops the inline padding
             entirely and is unaffected. 16 = --space-4. */
          inlineIndent={16}
        />
      </Sider>

      {/* ---- Right Side: Top Bar + Content ---- */}
      <Layout className="ml-main">
        {/* ---- Top Bar ---- */}
        <Header
          className="glass ml-topbar"
        >
          {/* Left: collapse toggle + page title */}
          <Space size={14} align="center" className="ml-topbar-left">
            {/* `text`, like the bell: the sidebar toggle is chrome, and a tinted pill
                here would compete with the page title beside it. */}
            <Button
              emphasis="text"
              iconOnly
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => handleCollapse(!collapsed)}
              className="ml-collapse-btn"
            />
            {/* RETIRED 2026-08-31: <Text className="ml-page-title"> printed the page
                title a second time. Every route renders a PageHeader since the
                composition rollout, and this was character-identical to it on
                /candidates and /settings — the chrome repeating the page back to
                itself 12px above. The trail says where you ARE instead. */}
            <Breadcrumb items={crumbItems} separator="›" className="ml-crumbs" />
            {/* Company badge intentionally hidden for now (not required in the UI). */}
          </Space>

          {/* Centre: the global entry point. The bar is justify-content: space-between,
              so this third child takes the middle — which was ~700px of nothing. */}
          <Button
            emphasis="soft"
            icon={<SearchOutlined />}
            onClick={() => setCmdOpen(true)}
            className="ml-omnibar"
          >
            Search or jump to…
            <kbd className="ml-kbd">⌘K</kbd>
          </Button>

          {/* Right: Notifications + Theme toggle + Admin Portal + Avatar */}
          <Space size={12} align="center" style={{ flexShrink: 0 }}>
            <NotificationBell />
            <ThemeToggle />
            {hasAdminAccess && (
              <Button
                emphasis="soft"
                icon={<AdminPortalIcon />}
                onClick={() => navigate('/admin/dashboard')}
              >
                Admin Portal
              </Button>
            )}

            <Dropdown
              menu={{ items: userMenuItems, onClick: handleUserMenu }}
              trigger={['click']}
              placement="bottomRight"
            >
              <Space className="ml-user-chip">
                <Avatar
                  size={32}
                  icon={<UserOutlined />}
                  className="ml-avatar"
                />
              </Space>
            </Dropdown>
          </Space>
        </Header>

        {/* ---- Main Content Area ---- */}
        <Content
          style={{
            padding: '24px 28px 40px',
            width: '100%',
          }}
        >
          {/* Child Routes Content Outlet — keyed by path so the entrance
              animation replays on every navigation, not just first mount. */}
          <div className="page-enter" key={location.pathname}>
            <Outlet />
          </div>
        </Content>
      </Layout>
      <ChangePasswordModal open={changePwOpen} onClose={() => setChangePwOpen(false)} />
      {/* Mounted on the shell, not on Dashboard, so ⌘K reaches every route. The admin
          portal is a separate shell and deliberately does not get it. */}
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={navigate}
        isModuleEnabled={isModuleEnabled}
      />
    </Layout>
  );
}
