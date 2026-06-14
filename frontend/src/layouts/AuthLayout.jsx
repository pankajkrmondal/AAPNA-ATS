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
          width: 450,
          height: 450,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0, 95, 86, 0.14) 0%, transparent 70%)',
          animation: 'float 14s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '15%',
          right: '10%',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(79, 70, 229, 0.11) 0%, transparent 70%)',
          animation: 'float 18s ease-in-out infinite reverse',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '40%',
          right: '30%',
          width: 300,
          height: 300,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(217, 119, 6, 0.08) 0%, transparent 70%)',
          animation: 'float 12s ease-in-out infinite 2s',
          pointerEvents: 'none',
        }}
      />

      {/* Card container */}
      <div
        className="glass-auth-card"
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
            alt="AAPNA Logo"
            style={{
              height: 42,
              width: 110,
              objectFit: 'cover',
              objectPosition: 'left',
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
                  fontWeight: 800,
                  color: 'var(--text)',
                  marginBottom: 6,
                  letterSpacing: '-0.02em',
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
                  fontSize: 22,
                  fontWeight: 800,
                  color: 'var(--text)',
                  marginBottom: 6,
                  letterSpacing: '-0.02em',
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
