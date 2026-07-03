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

export default function AuthLayout() {
  const location = useLocation();
  const isAdmin = location.pathname.includes('/admin');

  return (
    <div className="auth-split">
      {/* ---- Left: brand panel ---- */}
      <div className="auth-brand-panel">
        {/* Logo chip (keeps the original colored logo legible on olive) */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: '#fff',
              borderRadius: 12,
              padding: '10px 16px',
              boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
            }}
          >
            <img src={LOGO} alt="AAPNA" style={{ height: 32, width: 'auto', objectFit: 'contain', display: 'block' }} />
          </div>
        </div>

        {/* Value proposition */}
        <div style={{ position: 'relative', zIndex: 1, maxWidth: 460 }}>
          <h1
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(28px, 3.4vw, 40px)',
              fontWeight: 800,
              lineHeight: 1.18,
              letterSpacing: '-0.02em',
              margin: '0 0 16px',
              color: '#fff',
            }}
          >
            Recruitment, reimagined for speed and precision.
          </h1>
          <p style={{ fontSize: 15.5, lineHeight: 1.7, color: 'rgba(255,255,255,0.88)', margin: '0 0 28px' }}>
            AAPNA's intelligent ATS streamlines every step — from sourcing and AI screening to
            requisitions, approvals, and analytics.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {BRAND_HIGHLIGHTS.map((text) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <CheckCircleFilled style={{ color: '#fff', fontSize: 18, opacity: 0.95 }} />
                <span style={{ fontSize: 14.5, fontWeight: 500, color: 'rgba(255,255,255,0.94)' }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <Text style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)' }}>
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
            className="auth-brand-logo-mobile"
            style={{ height: 38, width: 'auto', objectFit: 'contain', margin: '0 auto 24px' }}
          />

          {/* Heading */}
          <div style={{ marginBottom: 24 }}>
            {isAdmin && (
              <span
                style={{
                  display: 'inline-block',
                  background: 'var(--gold-bg)',
                  color: 'var(--gold)',
                  border: '1px solid var(--border)',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  padding: '3px 12px',
                  borderRadius: 999,
                  marginBottom: 14,
                }}
              >
                HR Admin Portal
              </span>
            )}
            <h2
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 26,
                fontWeight: 800,
                color: 'var(--text)',
                margin: '0 0 6px',
                letterSpacing: '-0.02em',
              }}
            >
              {isAdmin ? 'Welcome back' : 'Sign in to your account'}
            </h2>
            <Text type="secondary" style={{ fontSize: 14 }}>
              {isAdmin
                ? 'Sign in to manage users and system access'
                : 'Enter your credentials to access the dashboard'}
            </Text>
          </div>

          {/* Login / form */}
          <Outlet />
        </div>
      </div>
    </div>
  );
}
