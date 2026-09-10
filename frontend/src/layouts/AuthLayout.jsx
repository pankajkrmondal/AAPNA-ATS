/**
 * AuthLayout — Split-screen auth layout for login / admin-login.
 * Left: rich olive brand panel (logo, value proposition, feature highlights).
 * Right: clean form panel with contextual heading + the page form (Outlet).
 */
import { Outlet, useLocation } from 'react-router-dom';
import { Typography } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';

const { Text } = Typography;

const LOGO = 'https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png';

const BRAND_HIGHLIGHTS = [
  'AI-powered candidate screening & profiling',
  'Automated requisition & approval workflows',
  'Real-time pipeline metrics & analytics',
];

/** Contextual heading/subheading per auth page (fallback: login copy). */
const PAGE_HEADINGS = {
  '/forgot-password': {
    title: 'Reset your password',
    subtitle: "Enter your username or email and we'll send you a reset link",
  },
  '/reset-password': {
    title: 'Choose a new password',
    subtitle: 'Set a new password for your account to sign back in',
  },
};

export default function AuthLayout() {
  const location = useLocation();
  const isAdmin = location.pathname.includes('/admin');
  const pageHeading = PAGE_HEADINGS[location.pathname];

  return (
    <div className="auth-split">
      {/* ---- Left: brand panel ---- */}
      <div className="auth-brand-panel">
        {/* Logo chip (keeps the original colored logo legible on olive) */}
        <div className="auth-brand-panel__top">
          <div className="auth-logo-chip">
            <img src={LOGO} alt="AAPNA" />
          </div>
        </div>

        {/* Value proposition */}
        <div className="auth-brand-panel__body">
          {/* The headline took its own clamp() — the only one in the app — rather than
              the display role. It now uses --fs-display, so a font-pack swap retunes it
              with everything else. */}
          <h1 className="auth-headline">
            Recruitment, reimagined for speed and precision.
          </h1>
          <p className="auth-lede">
            AAPNA's intelligent ATS streamlines every step — from sourcing and AI screening to
            requisitions, approvals, and analytics.
          </p>

          <div className="auth-highlights">
            {BRAND_HIGHLIGHTS.map((text) => (
              <div key={text} className="auth-highlight">
                <CheckCircleFilled />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="auth-brand-panel__foot">
          <Text className="auth-foot-text">
            © {new Date().getFullYear()} AAPNA Infotech · All rights reserved
          </Text>
        </div>
      </div>

      {/* ---- Right: form panel ---- */}
      <div className="auth-form-panel">
        <div className="auth-form-inner animate-fade-in-up">
          {/* Logo (mobile only — brand panel is hidden) */}
          <img
            src={LOGO}
            alt="AAPNA"
            className="auth-brand-logo-mobile auth-logo-mobile"
          />

          {/* Heading */}
          <div className="auth-form-heading">
            {isAdmin && <span className="auth-admin-badge">HR Admin Portal</span>}
            <h2 className="auth-form-title">
              {pageHeading?.title || (isAdmin ? 'Welcome back' : 'Sign in to your account')}
            </h2>
            <Text type="secondary" className="auth-form-subtitle">
              {pageHeading?.subtitle
                || (isAdmin
                  ? 'Sign in to manage users and system access'
                  : 'Enter your credentials to access the dashboard')}
            </Text>
          </div>

          {/* Login / form */}
          <Outlet />
        </div>
      </div>
    </div>
  );
}
