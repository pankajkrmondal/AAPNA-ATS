/**
 * MainLayout — Primary app shell with horizontal top navigation bar.
 * Replicates modern ATS layouts (like Workable, Greenhouse) by placing navigation in a clean top bar.
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
  SearchOutlined,
  UserOutlined,
  LogoutOutlined,
  SunOutlined,
  MoonOutlined,
  UploadOutlined,
  CrownOutlined,
} from '@ant-design/icons';

import useAuth from '../hooks/useAuth';
import useTheme from '../hooks/useTheme';
import NotificationBell from '../components/common/NotificationBell';

const { Header, Content } = Layout;
const { Text } = Typography;

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

/** Map paths to breadcrumb labels */
const BREADCRUMB_MAP = {
  dashboard: 'Dashboard',
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
  const isDashboard = location.pathname === '/dashboard';

  const hasAdminAccess =
    ['admin', 'superadmin'].includes((user?.role || '').toLowerCase());

  // Filter and strip icons from menu items by user role
  const menuItems = MENU_ITEMS.filter(item => {
    const role = (user?.role || '').toLowerCase();
    if (role === 'vendor') {
      return item.key === '/dashboard' || item.key === '/vendor';
    }
    return true;
  }).map(item => ({
    key: item.key,
    label: item.label,
  }));

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
                color: '#005f56',
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
                color: '#005f56',
                border: '1px solid #dde1df',
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
                background: '#e0f0ef',
                color: '#005f56',
                border: '1px solid #dde1df',
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

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--ink)' }}>
      {/* ---- Top Header Menu Bar ---- */}
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
        {/* Left: Logo and Brand Title */}
        <div 
          style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', flexShrink: 0 }} 
          onClick={() => navigate('/dashboard')}
        >
          <img
            src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
            alt="AAPNA Logo"
            style={{
              height: 30,
              objectFit: 'contain',
              filter: isDark ? 'invert(1) brightness(2)' : 'none',
              transition: 'filter 0.3s ease',
            }}
          />
          <div style={{ lineHeight: 1.2 }}>
            <span style={{ fontSize: 14, fontWeight: 700, display: 'block', color: 'var(--text)', letterSpacing: '-0.02em' }}>
              AAPNA
            </span>
            <span style={{ fontSize: 9, letterSpacing: '0.05em', color: 'var(--text-2)', textTransform: 'uppercase', fontWeight: 500 }}>
              ATS Platform
            </span>
          </div>
        </div>

        {/* Middle: Horizontal Navigation Menu (hide on dashboard page) */}
        {!isDashboard ? (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', padding: '0 12px' }}>
            <Menu
              mode="horizontal"
              selectedKeys={[selectedKey]}
              items={menuItems}
              onClick={({ key }) => navigate(key)}
              style={{
                border: 'none',
                background: 'transparent',
                width: '100%',
                maxWidth: 900,
                justifyContent: 'center',
                lineHeight: '64px',
              }}
            />
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}

        {/* Right: Dark Mode, Notifications, Avatar */}
        <Space size={12} align="center" style={{ flexShrink: 0 }}>
          {/* Admin Dashboard Access */}
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

          {/* Dark Mode Switcher */}
          <Tooltip title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
            <Button
              type="text"
              icon={isDark ? <SunOutlined style={{ fontSize: 16, color: '#f0b429' }} /> : <MoonOutlined style={{ fontSize: 16 }} />}
              onClick={toggleTheme}
              style={{ width: 36, height: 36, borderRadius: 8 }}
            />
          </Tooltip>

          {/* Real-time Notifications Bell */}
          <NotificationBell />

          {/* User Profile Dropdown Menu */}
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
          padding: '24px 28px 48px',
          maxWidth: 1200,
          width: '100%',
          margin: '0 auto',
        }}
      >
        {/* Child Routes Content Outlet */}
        <div className="page-enter">
          <Outlet />
        </div>
      </Content>
    </Layout>
  );
}
