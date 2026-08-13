/**
 * MainLayout — Primary app shell with a left collapsible sidebar navigation.
 * The sidebar holds the brand + nav menu (icon rail when collapsed); a slim top
 * bar carries the page title, Admin Portal access, and the user menu.
 */
import { useState } from 'react';
import { Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  Layout,
  Menu,
  Button,
  Avatar,
  Dropdown,
  Input,
  Breadcrumb,
  Typography,
  Space,
  Tooltip,
} from 'antd';
import {
  DashboardOutlined,
  SolutionOutlined,
  FileTextOutlined,
  ShopOutlined,
  FilterOutlined,
  ApartmentOutlined,
  BarChartOutlined,
  MailOutlined,
  BellOutlined,
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
// import NotificationBell from '../components/common/NotificationBell';

const { Header, Content, Sider } = Layout;
const { Text } = Typography;

const SIDEBAR_COLLAPSED_KEY = 'ats.sidebarCollapsed';

/** Admin Portal glyph — a person with a small gear badge ("manage accounts").
 *  AntD has no single person+gear icon, so we compose UserOutlined + a small
 *  SettingOutlined. Inherits color/size (em-based) from the surrounding text. */
function AdminPortalIcon() {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', lineHeight: 0 }}>
      <UserOutlined />
      <SettingOutlined style={{ position: 'absolute', right: '-0.32em', bottom: '-0.16em', fontSize: '0.62em' }} />
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
  // Preserved pre-rebrand page — operational fallback, not a primary surface.
  // Shortened from "Recruitment Analytics (Legacy)", which truncated to
  // "Recruitment Analyti…" in the 248px sidebar and read as a broken duplicate.
  { key: '/analytics-legacy', icon: <BarChartOutlined />, label: 'Analytics (Legacy)' },
  { key: '/email',      icon: <MailOutlined />,      label: 'Email Templates' },
  { key: '/settings',   icon: <BellOutlined />,      label: 'Reminder Settings' },
];

/** Navigation menu shown to vendors — restricted to their own surfaces. */
const VENDOR_MENU_ITEMS = [
  { key: '/vendor-dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/vendor',           icon: <UploadOutlined />,    label: 'Upload Candidate' },
];

/** Path prefixes a vendor is allowed to visit; anything else redirects. */
const VENDOR_ALLOWED_PATHS = ['/vendor-dashboard', '/vendor'];

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
  settings: 'Reminder Settings',
};

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
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

  /** User dropdown menu (Reminder Settings lives in the sidebar). */
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
   *  This one boolean is the entire pilot scope. `.ats-v2` on the outer <Layout>
   *  wraps the Sider, Header AND the <Outlet />, so it scopes the shell chrome and
   *  the page's cards together. That containment is required, not cosmetic:
   *  `.glass-card` / `.glass` are also used by CandidateDetail, CandidateScreening
   *  and both Analytics pages, which have no ambient canvas behind them — styling
   *  those classes globally would wash out five screens nobody asked us to touch.
   *
   *  Roll out app-wide by widening (or deleting) this condition; revert the pilot
   *  by deleting the constant. */
  const isV2 = location.pathname.startsWith('/dashboard');

  /** Title for the current page, shown in the top bar. Vendors get their own
   *  labels (Upload Candidate / Dashboard) for their restricted surfaces. */
  const pageTitle = (user?.role || '').toLowerCase() === 'vendor'
    ? (selectedKey === '/vendor' ? 'Upload Candidate' : 'Dashboard')
    : (BREADCRUMB_MAP[pathSegments[0]] || 'Dashboard');

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
    return (
      <Layout style={{ minHeight: '100vh', background: 'var(--admin-bg)' }}>
        <Header className="admin-topbar">
          {/* Left: Logo + Sep + Title cluster */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Same two fixes as the sidebar brand: `cover` at width 85 sliced the GPTW
                badge off, and inverting a coloured badge in dark mode turned its red
                to cyan. `contain` plus a light chip instead. */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                ...(isDark && {
                  background: 'rgba(255,255,255,0.94)',
                  borderRadius: 7,
                  padding: '3px 6px',
                }),
              }}
            >
              <img
                src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
                alt={brand.name}
                style={{
                  height: 30,
                  width: 112,
                  objectFit: 'contain',
                  objectPosition: 'left center',
                  display: 'block',
                }}
              />
            </span>
            <div style={{ width: 1, height: 30, background: 'var(--border)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div className="admin-brand-icon"><AdminPortalIcon /></div>
              <div style={{ lineHeight: 1.2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-heading)', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                    HR Admin
                  </span>
                  <span className={`role-badge role-badge--${isSuperadmin ? 'superadmin' : 'admin'}`}>
                    {adminRoleLabel}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>
                  Users · Access · Companies
                </span>
              </div>
            </div>
          </div>

          {/* Right: Theme toggle + Portal switch + user chip + Logout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemeToggle />
            <Button
              className="admin-top-btn"
              type="text"
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
              <div className="admin-user-chip" style={{ cursor: 'pointer' }}>
                <Avatar size={26} style={{ background: 'var(--gradient-primary)', fontSize: 11, fontWeight: 700 }}>
                  {userInitials}
                </Avatar>
                <span>{user?.username || 'Admin'}</span>
              </div>
            </Dropdown>
            <Button
              className="admin-top-btn admin-top-btn--logout"
              type="text"
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
        <Content style={{ minHeight: 'calc(100vh - 64px)', background: 'var(--admin-bg)' }}>
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
    <Layout
      className={isV2 ? 'ats-v2' : undefined}
      style={{ minHeight: '100vh', background: isV2 ? 'transparent' : 'var(--ink)' }}
    >
      {/* The ambient canvas glass refracts. Without something living behind them,
          backdrop-filtered surfaces just return the flat page colour. */}
      {isV2 && <AmbientBackdrop />}

      {/* ---- Left Sidebar Navigation ---- */}
      <Sider
        className="glass-sidebar"
        theme={isDark ? 'dark' : 'light'}
        width={248}
        collapsedWidth={72}
        collapsible
        collapsed={collapsed}
        onCollapse={handleCollapse}
        trigger={null}
        breakpoint="lg"
        onBreakpoint={(broken) => handleCollapse(broken)}
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'auto',
          borderRight: '1px solid var(--border-light)',
        }}
      >
        {/* Brand */}
        <div
          onClick={() => navigate('/dashboard')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 64,
            padding: collapsed ? '0' : '0 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            cursor: 'pointer',
            borderBottom: '1px solid var(--border-light)',
            overflow: 'hidden',
          }}
        >
          {/* Collapsed rail: the vector rotor. A 72px rail cannot show a wide lockup —
              the previous `objectFit: cover` crop left an unreadable "aa" fragment.
              This is still the official symbol: the rotor device at the left of the
              real logo is exactly what AapnaLogo traces. */}
          {collapsed ? (
            <AapnaLogo
              title={`${brand.name} — ${brand.productLabel}`}
              style={{ width: 30, height: 30, color: 'var(--text)', flexShrink: 0 }}
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
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flex: '1 1 auto',
                  minWidth: 0,
                  height: 38,
                  ...(isDark && {
                    background: 'rgba(255,255,255,0.94)',
                    borderRadius: 7,
                    padding: '3px 5px',
                  }),
                }}
              >
                <img
                  src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
                  alt={brand.name}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    objectPosition: 'left center',
                    display: 'block',
                  }}
                />
              </span>
              {/* Product label only. The logo bitmap already reads "aapna", so the
                  old "AAPNA" line above this said the brand name a second time.
                  nowrap keeps it on one line — it previously wrapped to "ATS /
                  PLATFORM", which read as broken. */}
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: 'var(--text-2)',
                  textTransform: 'uppercase',
                  lineHeight: 1.15,
                  whiteSpace: 'nowrap',
                  borderLeft: '1px solid var(--border)',
                  paddingLeft: 8,
                }}
              >
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
          style={{
            border: 'none',
            background: 'transparent',
            padding: '12px 8px',
          }}
        />
      </Sider>

      {/* ---- Right Side: Top Bar + Content ---- */}
      <Layout style={{ background: isV2 ? 'transparent' : 'var(--ink)' }}>
        {/* ---- Top Bar ---- */}
        <Header
          className="glass"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 100,
            height: 64,
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-light)',
            /* This inline background is why the topbar has never actually looked
               like glass: it overrode its own `.glass` class. Under V2 it yields
               to the stylesheet so the tier-1 blur can take effect. */
            background: isV2 ? undefined : 'var(--colorBgContainer)',
          }}
        >
          {/* Left: collapse toggle + page title */}
          <Space size={14} align="center" style={{ minWidth: 0 }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => handleCollapse(!collapsed)}
              style={{ width: 36, height: 36, borderRadius: 8, fontSize: 16 }}
            />
            <Text style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }} className="text-truncate">
              {pageTitle}
            </Text>
            {/* Company badge intentionally hidden for now (not required in the UI). */}
          </Space>

          {/* Right: Theme toggle + Admin Portal + Avatar */}
          <Space size={12} align="center" style={{ flexShrink: 0 }}>
            <ThemeToggle />
            {hasAdminAccess && (
              <Button
                className="admin-top-btn"
                type="text"
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
              <Space style={{ cursor: 'pointer', padding: '2px 4px', borderRadius: 8 }}>
                <Avatar
                  size={32}
                  icon={<UserOutlined />}
                  style={{
                    background: 'var(--gradient-primary)',
                    cursor: 'pointer',
                  }}
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
    </Layout>
  );
}
