/**
 * AuthLayout — Layout for login / registration pages.
 * Centered glassmorphism card over an animated gradient background with AAPNA branding.
 */
import { Outlet } from 'react-router-dom';
import { Typography } from 'antd';

const { Text } = Typography;

export default function AuthLayout() {
  return (
    <div className="auth-background">
      {/* Floating orbs (decorative) */}
      <div
        style={{
          position: 'absolute',
          top: '10%',
          left: '15%',
          width: 300,
          height: 300,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,95,86,0.08) 0%, transparent 70%)',
          animation: 'float 12s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '15%',
          right: '10%',
          width: 250,
          height: 250,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(74,124,89,0.06) 0%, transparent 70%)',
          animation: 'float 16s ease-in-out infinite reverse',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          right: '30%',
          width: 180,
          height: 180,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,122,111,0.05) 0%, transparent 70%)',
          animation: 'float 10s ease-in-out infinite 2s',
          pointerEvents: 'none',
        }}
      />

      {/* Card container */}
      <div
        className="glass"
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 440,
          borderRadius: 20,
          padding: '44px 40px 36px',
          animation: 'scaleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        }}
      >
        {/* Brand header matching legacy screenshots */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img
            src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png"
            alt="AAPNA GPTW"
            style={{
              height: 42,
              objectFit: 'contain',
              display: 'block',
              margin: '0 auto 20px',
            }}
          />
          {window.location.pathname.includes('/admin') ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <span
                  style={{
                    display: 'inline-block',
                    background: '#eef3da',
                    color: '#5c6f1f',
                    border: '1px solid #b8cc6e',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 12px',
                    borderRadius: 999,
                  }}
                >
                  HR Admin Portal
                </span>
              </div>
              <h2
                style={{
                  fontFamily: "'Lora', serif, Georgia",
                  fontSize: 22,
                  fontWeight: 700,
                  color: 'var(--text)',
                  marginBottom: 6,
                }}
              >
                Welcome Back
              </h2>
              <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>
                Sign in to manage users and system access
              </Text>
            </>
          ) : (
            <>
              <h2
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: '#1a1a2e',
                  marginBottom: 6,
                }}
              >
                Recruitment Portal
              </h2>
              <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>
                Sign in to access the dashboard
              </Text>
            </>
          )}
        </div>

        {/* Page content (Login / Register form) */}
        <Outlet />
      </div>

      {/* Footer */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          zIndex: 1,
          textAlign: 'center',
        }}
      >
        <Text type="secondary" style={{ fontSize: 12, opacity: 0.6 }}>
          © {new Date().getFullYear()} AAPNA · All rights reserved
        </Text>
      </div>
    </div>
  );
}
