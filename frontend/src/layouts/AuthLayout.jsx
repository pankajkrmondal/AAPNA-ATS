/**
 * AuthLayout — Split-screen auth layout for login / admin-login.
 * Left: deep olive brand panel (logo, value proposition, and an illustrative
 * hiring-pipeline card with floating AI-match / MRF-approval badges).
 * Right: clean form panel with contextual heading + the page form (Outlet).
 * Always light (wrapped in ForceLight in App.jsx), so there is no theme toggle.
 *
 * The pipeline card is decorative sample content (aria-hidden), not live data.
 */
import { Outlet, useLocation } from 'react-router-dom';
import { Typography } from 'antd';
import { CheckOutlined, VideoCameraOutlined, SafetyCertificateFilled } from '@ant-design/icons';

const { Text } = Typography;

const LOGO = 'https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png';

/** Stages of the sample pipeline card; `done` / `current` drive the styling. */
const PIPELINE_STAGES = [
  { label: 'Sourced', state: 'done' },
  { label: 'Screened', state: 'done' },
  { label: 'Interview', state: 'current' },
  { label: 'Offer', state: 'todo' },
  { label: 'Joined', state: 'todo' },
];

const AI_MATCH = 92;

/** Decorative hiring-pipeline illustration for the brand panel. */
function PipelineShowcase() {
  return (
    <div className="auth-showcase" aria-hidden="true">
      <div className="auth-float auth-float--match">
        <span className="auth-match-ring" style={{ '--pct': AI_MATCH }}>
          <span>{AI_MATCH}%</span>
        </span>
        <span className="auth-float__text">
          <strong>AI match score</strong>
          <small>Résumé vs. job description</small>
        </span>
      </div>

      <div className="auth-pipeline-card">
        <div className="auth-pipeline-card__head">
          <div>
            <div className="auth-pipeline-card__title">Senior React Developer</div>
            <div className="auth-pipeline-card__sub">Engineering · 3 openings</div>
          </div>
          <span className="auth-pill">MRF-142</span>
        </div>

        <ol className="auth-stepper">
          {PIPELINE_STAGES.map((stage, i) => (
            <li key={stage.label} className={`auth-step auth-step--${stage.state}`}>
              <span className="auth-step__dot">
                {stage.state === 'done' ? <CheckOutlined /> : i + 1}
              </span>
              <span className="auth-step__label">{stage.label}</span>
            </li>
          ))}
        </ol>

        <div className="auth-pipeline-card__foot">
          <VideoCameraOutlined />
          <span>Round 2 on Microsoft Teams · tomorrow, 11:00 AM</span>
        </div>
      </div>

      <div className="auth-float auth-float--approved">
        <span className="auth-float__icon">
          <SafetyCertificateFilled />
        </span>
        <span className="auth-float__text">
          <strong>Requisition approved</strong>
          <small>Hiring manager signed off · 2m ago</small>
        </span>
      </div>
    </div>
  );
}

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
        {/* Brand chip: white logo pill (keeps the colored logo legible) + product name */}
        <div className="auth-brand-chip">
          <span className="auth-brand-chip__logo">
            <img src={LOGO} alt="AAPNA" />
          </span>
          <span className="auth-brand-chip__text">
            <strong>AAPNA ATS</strong>
            <small>Applicant Tracking System</small>
          </span>
        </div>

        {/* Value proposition + pipeline illustration */}
        <div className="auth-brand-body">
          <h1 className="auth-brand-title">
            Right talent,
            <br />
            <span className="auth-brand-title__accent">hired faster.</span>
          </h1>
          <p className="auth-brand-lede">
            Requisitions approved in a click, résumés ranked by AI against the JD, interviews
            scheduled on Teams — and every candidate's journey in one pipeline.
          </p>

          <PipelineShowcase />
        </div>

        {/* Footer */}
        <div className="auth-brand-foot">
          © {new Date().getFullYear()} AAPNA Infotech · All rights reserved
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
              {pageHeading?.title || (isAdmin ? 'Welcome back' : 'Sign in to your account')}
            </h2>
            <Text type="secondary" style={{ fontSize: 14 }}>
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
