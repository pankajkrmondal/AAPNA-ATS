/**
 * MainLayout — Primary app shell with collapsible sidebar, header, and content area.
 * Features glassmorphism sidebar, breadcrumb, notifications, dark mode toggle, and user menu.
 */
import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
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
  Switch,
  Tooltip,
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
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SearchOutlined,
  UserOutlined,
  LogoutOutlined,
  SunOutlined,
  MoonOutlined,
  ProfileOutlined,
  UploadOutlined,
} from '@ant-design/icons';

import useAuth from '../hooks/useAuth';
import useTheme from '../hooks/useTheme';
import NotificationBell from '../components/common/NotificationBell';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

/** Navigation menu items */
const MENU_ITEMS = [
  { key: '/dashboard',  icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/candidates', icon: <TeamOutlined />,      label: 'Candidates' },
  { key: '/hr-upload',  icon: <UploadOutlined />,    label: 'HR Manual Upload' },
  { key: '/mrf',        icon: <FileTextOutlined />,  label: 'MRF' },
  { key: '/vendor',     icon: <ShopOutlined />,      label: 'Vendor Portal' },
  { key: '/filtering',  icon: <FilterOutlined />,    label: 'Candidate Screening' },
  { key: '/analytics',  icon: <BarChartOutlined />,  label: 'Analytics' },
  { key: '/email',      icon: <MailOutlined />,      label: 'Email' },
  { key: '/settings',   icon: <SettingOutlined />,   label: 'Settings' },
];

/** Map paths to breadcrumb labels */
const BREADCRUMB_MAP = {
  dashboard: 'Dashboard',
  candidates: 'Candidates',
  'hr-upload': 'HR Resume Upload',
  mrf: 'MRF',
  vendor: 'Vendor Portal',
  filtering: 'Candidate Screening',
  analytics: 'Analytics',
  email: 'Email',
  settings: 'Settings',
};

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  /** Build breadcrumb items from the current path. */
  const pathSegments = location.pathname.split('/').filter(Boolean);
  const breadcrumbItems = [
    { title: 'Home' },
    ...pathSegments.map((seg) => ({
      title: BREADCRUMB_MAP[seg] || seg.charAt(0).toUpperCase() + seg.slice(1),
    })),
  ];

  /** User dropdown menu */
  const userMenuItems = [
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
  const selectedKey = '/' + (pathSegments[0] || 'dashboard');
  const isAdminPath = location.pathname.startsWith('/admin');
  const isDashboardPath = location.pathname === '/dashboard';

  const hasAdminAccess =
    ['admin', 'superadmin'].includes((user?.role || '').toLowerCase());

  if (isAdminPath) {
    return (
      <Layout style={{ minHeight: '100vh', background: '#f2f4f0' }}>
        <Header
          style={{
            background: '#ffffff',
            borderBottom: '1px solid #dde2d0',
            height: 60,
            padding: '0 28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 90,
            boxShadow: '0 1px 0 #dde2d0',
          }}
        >
          {/* Left: Logo + Sep + Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img
              src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
              alt="AAPNA"
              style={{ height: 32, objectFit: 'contain' }}
            />
            <div style={{ width: 1, height: 26, background: '#dde2d0' }} />
            <span
              style={{
                fontFamily: "'Lora', serif",
                fontSize: 15,
                color: '#5c6f1f',
                fontWeight: 700,
                letterSpacing: '0.2px',
              }}
            >
              HR Admin
            </span>
          </div>

          {/* Right: Badge + Logout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button
              type="text"
              onClick={() => navigate('/dashboard')}
              icon={<DashboardOutlined />}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#7a922e',
                border: '1px solid #b8cc6e',
                borderRadius: 6,
                height: 30,
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              Recruitment Portal
            </Button>
            <span
              style={{
                display: 'inline-block',
                lineHeight: '24px',
                background: '#eef3da',
                color: '#5c6f1f',
                border: '1px solid #b8cc6e',
                fontSize: 11,
                fontWeight: 600,
                padding: '0 12px',
                borderRadius: 999,
              }}
            >
              {user?.username || 'Admin'}
            </span>
            <Button
              type="text"
              onClick={async () => {
                await logout();
                navigate('/admin/login');
              }}
              icon={<LogoutOutlined />}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#6b7561',
                border: '1px solid #dde2d0',
                borderRadius: 6,
                height: 30,
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              Logout
            </Button>
          </div>
        </Header>
        <Content style={{ minHeight: 'calc(100vh - 60px)', background: '#f2f4f0' }}>
          <Outlet />
        </Content>
      </Layout>
    );
  }

  if (isDashboardPath) {
    return (
      <Layout style={{ minHeight: '100vh', background: 'var(--ink)' }}>
        <Header
          style={{
            background: 'var(--colorBgContainer)',
            borderBottom: '1px solid var(--border)',
            height: 64,
            padding: '0 28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 90,
          }}
        >
          {/* Left: Logo Mark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                background: 'linear-gradient(135deg, var(--gold), #5a7a1e)',
                borderRadius: 9,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>A</span>
            </div>
            <div>
              <span style={{ fontSize: 14, fontWeight: 700, display: 'block', lineHeight: 1.2 }}>
                AAPNA Infotech
              </span>
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font)',
                  fontWeight: 500,
                }}
              >
                HR Recruitment
              </span>
            </div>
          </div>

          {/* Right: Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Tooltip title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
              <Button
                type="text"
                icon={
                  isDark ? (
                    <SunOutlined style={{ fontSize: 18, color: '#f0b429' }} />
                  ) : (
                    <MoonOutlined style={{ fontSize: 18 }} />
                  )
                }
                onClick={toggleTheme}
                style={{ width: 40, height: 40, borderRadius: 10 }}
              />
            </Tooltip>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--colorBgContainer)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '6px 12px 6px 10px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              }}
            >
              {hasAdminAccess && (
                <Button
                  type="primary"
                  icon={<SettingOutlined />}
                  onClick={() => navigate('/admin/dashboard')}
                  style={{
                    height: 30,
                    width: 30,
                    borderRadius: 6,
                    background: 'linear-gradient(135deg, var(--gold), #5a7a1e)',
                    borderColor: 'var(--gold)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                  }}
                  title="Admin Dashboard"
                />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                  {user?.username || 'User'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'lowercase' }}>
                  ({user?.role || ''})
                </span>
              </div>
              <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
              <Button
                type="text"
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
                icon={<LogoutOutlined />}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#c0392b',
                  padding: 0,
                  height: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                Logout
              </Button>
            </div>

            <img
              src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
              alt="AAPNA Logo"
              style={{ height: 42, objectFit: 'contain' }}
            />
          </div>
        </Header>
        <Content style={{ minHeight: 'calc(100vh - 64px)' }}>
          <Outlet />
        </Content>
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* ---- Sidebar ---- */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={260}
        collapsedWidth={80}
        className="glass-sidebar"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          borderRight: '1px solid var(--border-light)',
          overflow: 'auto',
          transition: 'all 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Brand */}
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '0' : '0 24px',
            borderBottom: '1px solid var(--border-light)',
            transition: 'all 0.3s',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'var(--gradient-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 16, fontFamily: 'var(--font)' }}>A</span>
          </div>
          {!collapsed && (
            <div style={{ marginLeft: 12, overflow: 'hidden', whiteSpace: 'nowrap' }}>
              <Text
                strong
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  display: 'block',
                  lineHeight: 1.2,
                }}
              >
                AAPNA
              </Text>
              <Text
                type="secondary"
                style={{
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontWeight: 500,
                }}
              >
                ATS Platform
              </Text>
            </div>
          )}
        </div>

        {/* Navigation Menu */}
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={MENU_ITEMS.filter(item => {
            const role = (user?.role || '').toLowerCase();
            if (role === 'vendor') {
              return item.key === '/dashboard' || item.key === '/vendor';
            }
            return true;
          })}
          onClick={({ key }) => navigate(key)}
          style={{
            border: 'none',
            background: 'transparent',
            padding: '12px 8px',
          }}
        />
      </Sider>

      {/* ---- Main Area ---- */}
      <Layout
        style={{
          marginLeft: collapsed ? 80 : 260,
          transition: 'margin-left 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Top Header */}
        <Header
          className="glass"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 90,
            height: 64,
            padding: '0 28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-light)',
          }}
        >
          {/* Left: Collapse + Breadcrumb */}
          <Space size={16} align="center">
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              style={{
                fontSize: 18,
                width: 40,
                height: 40,
                borderRadius: 10,
              }}
            />
            <Breadcrumb items={breadcrumbItems} />
          </Space>

          {/* Right: Search + Actions */}
          <Space size={8} align="center">
            {/* Search */}
            <Input
              prefix={<SearchOutlined style={{ color: 'var(--text-2)', opacity: 0.5 }} />}
              placeholder="Search candidates, MRFs..."
              style={{
                width: 260,
                borderRadius: 10,
                background: 'var(--gold-subtle)',
                border: '1px solid var(--border-light)',
              }}
              allowClear
            />

            {/* Admin Dashboard */}
            {hasAdminAccess && (
              <Tooltip title="Admin Dashboard">
                <Button
                  type="text"
                  icon={<SettingOutlined style={{ fontSize: 18 }} />}
                  onClick={() => navigate('/admin/dashboard')}
                  style={{ width: 40, height: 40, borderRadius: 10 }}
                />
              </Tooltip>
            )}

            {/* Dark mode toggle */}
            <Tooltip title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
              <Button
                type="text"
                icon={isDark ? <SunOutlined style={{ fontSize: 18, color: '#f0b429' }} /> : <MoonOutlined style={{ fontSize: 18 }} />}
                onClick={toggleTheme}
                style={{ width: 40, height: 40, borderRadius: 10 }}
              />
            </Tooltip>

            {/* Notifications */}
            <NotificationBell />

            {/* User Avatar + Dropdown */}
            <Dropdown
              menu={{ items: userMenuItems, onClick: handleUserMenu }}
              trigger={['click']}
              placement="bottomRight"
            >
              <Space
                style={{
                  cursor: 'pointer',
                  padding: '4px 12px 4px 4px',
                  borderRadius: 10,
                  transition: 'background 0.2s',
                }}
              >
                <Avatar
                  size={34}
                  icon={<UserOutlined />}
                  style={{
                    background: 'var(--gradient-primary)',
                    cursor: 'pointer',
                  }}
                />
                <div style={{ lineHeight: 1.3 }}>
                  <Text strong style={{ fontSize: 13, display: 'block' }}>
                    {user?.name || user?.username || 'User'}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {user?.role || 'HR Admin'}
                  </Text>
                </div>
              </Space>
            </Dropdown>
          </Space>
        </Header>

        {/* Content */}
        <Content
          style={{
            padding: 28,
            minHeight: 'calc(100vh - 64px)',
          }}
        >
          <div className="page-enter">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
