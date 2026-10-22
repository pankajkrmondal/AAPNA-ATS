/**
 * PublicPageShell — the AAPNA-branded frame for the public, token-linked pages
 * a candidate or interviewer reaches from an email (document upload, interviewer
 * scorecard).
 *
 * These pages are the only AAPNA surface most external people ever see, and they
 * were unbranded white cards on grey — visually unrelated to the branded email
 * that sent the person there. This reproduces that email's shell (green band,
 * logo, white card, grey footer — the tokens in backend emailLayout.service.js)
 * so clicking through from the mail feels like one continuous journey rather
 * than a hand-off to some unrelated tool.
 *
 * `subtitle` is the one-line "what this page is for" explanation; it sits in the
 * band exactly where the email's sub-line does.
 */
import { Typography } from 'antd';

const { Text } = Typography;

/** Mirrors BRAND in backend/src/services/emailLayout.service.js — keep in step. */
export const BRAND = Object.freeze({
  accent: '#7a922e',
  page: '#f4f6f9',
  card: '#ffffff',
  footerBg: '#f3f4f6',
  footerText: '#9ca3af',
  logo: 'https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png',
});

export default function PublicPageShell({ title, subtitle, maxWidth = 680, children }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: BRAND.page,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '32px 16px',
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth,
          background: BRAND.card,
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 6px 24px rgba(0,0,0,0.08)',
        }}
      >
        {/* Green band — same composition as the branded email header. */}
        <div style={{ background: BRAND.accent, padding: '30px 32px', textAlign: 'center' }}>
          <img
            src={BRAND.logo}
            alt="AAPNA Infotech"
            width={180}
            style={{ display: 'block', margin: '0 auto 14px auto', maxWidth: '70%' }}
          />
          {title && (
            <h1 style={{ margin: 0, fontSize: 21, lineHeight: 1.3, color: '#ffffff', fontWeight: 800 }}>
              {title}
            </h1>
          )}
          {subtitle && (
            <p style={{ margin: '7px 0 0 0', color: '#e7f0c5', fontSize: 13.5, lineHeight: 1.5 }}>
              {subtitle}
            </p>
          )}
        </div>

        <div style={{ padding: '26px 32px 30px 32px' }}>{children}</div>

        <div
          style={{
            background: BRAND.footerBg,
            padding: '14px 16px',
            textAlign: 'center',
            fontSize: 12,
            color: BRAND.footerText,
          }}
        >
          <Text style={{ color: BRAND.footerText, fontSize: 12 }}>
            © {new Date().getFullYear()} AAPNA Infotech. All rights reserved.
          </Text>
        </div>
      </div>
    </div>
  );
}
