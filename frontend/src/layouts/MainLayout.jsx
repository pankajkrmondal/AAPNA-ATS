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
  Tag,
} from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  FileTextOutlined,
  ShopOutlined,
  FilterOutlined,
  BarChartOutlined,
  MailOutlined,
  SettingOutlined,
  SearchOutlined,
  UserOutlined,
  LogoutOutlined,
  SunOutlined,
  MoonOutlined,
  UploadOutlined,
  CrownOutlined,
  FundOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';

import useAuth from '../hooks/useAuth';
import useTheme from '../hooks/useTheme';
// import NotificationBell from '../components/common/NotificationBell';

const { Header, Content, Sider } = Layout;
const { Text } = Typography;

const SIDEBAR_COLLAPSED_KEY = 'ats.sidebarCollapsed';

/** Navigation menu items */
const MENU_ITEMS = [
  { key: '/dashboard',  icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/candidates', icon: <TeamOutlined />,      label: 'Candidates' },
  { key: '/hr-upload',  icon: <UploadOutlined />,    label: 'HR Upload' },
  { key: '/mrf',        icon: <FileTextOutlined />,  label: 'MRF' },
  { key: '/vendor',     icon: <ShopOutlined />,      label: 'Vendor' },
  { key: '/filtering',  icon: <FilterOutlined />,    label: 'Screening' },
  { key: '/analytics',  icon: <BarChartOutlined />,  label: 'Analytics' },
  { key: '/email',      icon: <MailOutlined />,      label: 'Email' },
  { key: '/settings',   icon: <SettingOutlined />,   label: 'Settings' },
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
const VENDOR_DASHBOARD_MENU_ITEM = { key: '/vendor-dashboard', icon: <FundOutlined />, label: 'Vendor Dashboard' };

/** Map paths to breadcrumb labels */
const BREADCRUMB_MAP = {
  dashboard: 'Dashboard',
  'vendor-dashboard': 'Vendor Dashboard',
  candidates: 'Candidates',
  'hr-upload': 'HR Upload',
  mrf: 'MRF',
  vendor: 'Vendor',
  filtering: 'Screening',
  analytics: 'Analytics',
  email: 'Email',
  settings: 'Settings',
};

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  /** Sidebar collapse state — persisted across reloads. */
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  );
  const handleCollapse = (value) => {
    setCollapsed(value);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(value));
  };

  const pathSegments = location.pathname.split('/').filter(Boolean);

  /** User dropdown menu — vendors don't have access to Settings. */
  const userMenuItems = (user?.role || '').toLowerCase() === 'vendor'
    ? [{ key: 'logout', icon: <LogoutOutlined />, label: 'Logout', danger: true }]
    : [
        { key: 'settings', icon: <SettingOutlined />, label: 'Settings' },
        { type: 'divider' },
        { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', danger: true },
      ];

  const handleUserMenu = async ({ key }) => {
    if (key === 'logout') {
      await logout();
      navigate('/login');
    } else if (key === 'settings') {
      navigate('/settings');
    }
  };

  /** Get the currently active menu key */
  let selectedKey = '/' + (pathSegments[0] || 'dashboard');
  if (pathSegments[0] === 'candidates' && pathSegments[1] && location.state?.from === 'analytics') {
    selectedKey = '/analytics';
  }
  const isAdminPath = location.pathname.startsWith('/admin');

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
  const companyLabel = isSuperadmin ? 'All Companies' : (user?.company_name || 'Unassigned');
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
      <Layout style={{ minHeight: '100vh', background: '#f2f4f0' }}>
        <Header className="admin-topbar">
          {/* Left: Logo + Sep + Title cluster */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img
              src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
              alt="AAPNA"
              style={{ height: 32, width: 85, objectFit: 'cover', objectPosition: 'left' }}
            />
            <div style={{ width: 1, height: 30, background: '#dde2d0' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div className="admin-brand-icon"><CrownOutlined /></div>
              <div style={{ lineHeight: 1.2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-heading)', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                    HR Admin
                  </span>
                  <span className={`role-badge role-badge--${isSuperadmin ? 'superadmin' : 'admin'}`}>
                    {adminRoleLabel}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: '#8b938a', fontWeight: 500 }}>
                  Users · Access · Companies
                </span>
              </div>
            </div>
          </div>

          {/* Right: Portal switch + user chip + Logout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button
              className="admin-top-btn"
              type="text"
              onClick={() => navigate('/dashboard')}
              icon={<DashboardOutlined />}
            >
              Recruitment Portal
            </Button>
            <div className="admin-user-chip">
              <Avatar size={26} style={{ background: 'var(--gradient-primary)', fontSize: 11, fontWeight: 700 }}>
                {userInitials}
              </Avatar>
              <span>{user?.username || 'Admin'}</span>
            </div>
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
        <Content style={{ minHeight: 'calc(100vh - 64px)', background: '#f2f4f0' }}>
          <Outlet />
        </Content>
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--ink)' }}>
      {/* ---- Left Sidebar Navigation ---- */}
      <Sider
        className="glass-sidebar"
        theme="light"
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
            gap: 10,
            height: 64,
            padding: collapsed ? '0' : '0 18px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            cursor: 'pointer',
            borderBottom: '1px solid var(--border-light)',
          }}
        >
          <img
            src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
            alt="AAPNA Logo"
            style={{
              height: 28,
              width: collapsed ? 32 : 74,
              objectFit: 'cover',
              objectPosition: 'left',
              filter: isDark ? 'invert(1) brightness(2)' : 'none',
              transition: 'all 0.3s ease',
            }}
          />
          {!collapsed && (
            <div style={{ lineHeight: 1.2 }}>
              <span style={{ fontSize: 14, fontWeight: 700, display: 'block', color: 'var(--text)', letterSpacing: '-0.02em' }}>
                AAPNA
              </span>
              <span style={{ fontSize: 9, letterSpacing: '0.05em', color: 'var(--text-2)', textTransform: 'uppercase', fontWeight: 500 }}>
                ATS Platform
              </span>
            </div>
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
      <Layout style={{ background: 'var(--ink)' }}>
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
            background: 'var(--colorBgContainer)',
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
            <Tag
              color={companyLabel === 'All Companies' ? 'gold' : 'default'}
              style={{ borderRadius: 999, fontSize: 11, fontWeight: 600, margin: 0 }}
            >
              {companyLabel}
            </Tag>
          </Space>

          {/* Right: Admin Portal + Avatar */}
          <Space size={12} align="center" style={{ flexShrink: 0 }}>
            {hasAdminAccess && (
              <Button
                type="text"
                icon={<CrownOutlined style={{ color: 'var(--gold)', fontSize: 14 }} />}
                onClick={() => navigate('/admin/dashboard')}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--gold)',
                  background: 'var(--gold-subtle)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  height: 32,
                  padding: '0 10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
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
          {/* Child Routes Content Outlet */}
          <div className="page-enter">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
