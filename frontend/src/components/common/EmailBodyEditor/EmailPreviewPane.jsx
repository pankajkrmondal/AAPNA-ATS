import { Typography } from 'antd';
import DOMPurify from 'dompurify';
import { SANITIZE_OPTS } from './sanitize';
import { buildBrandedShellHtml } from './brandedShell';
import { wrapBrandedPreview, isFullHtmlDocument } from '../../../utils/emailPreview';

const { Text } = Typography;

/**
 * Read-only rendered preview of a compiled email.
 *
 * `wrapper` (a real {headerHtml, footerHtml} from a backend preview-compile
 * endpoint) wins when present — preview and delivery can't drift. Without
 * one, falls back to `wrapBrandedPreview()`'s client-side approximation
 * (the Email Templates page's case — it has no per-template backend preview
 * endpoint today).
 */
export default function EmailPreviewPane({ subject, bodyHtml, wrapper, variant = 'full', to = 'candidate@example.com' }) {
  const srcDoc = wrapper?.headerHtml
    ? DOMPurify.sanitize(buildBrandedShellHtml(DOMPurify.sanitize(bodyHtml || '', SANITIZE_OPTS), wrapper), { ADD_TAGS: ['style'], ADD_ATTR: ['target'] })
    : DOMPurify.sanitize(
        wrapBrandedPreview(bodyHtml || '<p style="font-family:sans-serif;color:#8a8f8c">Empty.</p>', { title: subject }),
        SANITIZE_OPTS
      );
  const isWrapped = !wrapper?.headerHtml && !isFullHtmlDocument(bodyHtml || '');

  if (variant === 'compact') {
    return (
      <div style={{ border: '1px solid var(--border-light, #ebe8f4)', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ padding: '6px 10px', background: 'var(--ink-4, #f4f6f9)', fontSize: 12, fontWeight: 600 }}>
          {subject}
        </div>
        <iframe title="Email preview" sandbox="" className="email-preview-iframe" style={{ height: 260 }} srcDoc={srcDoc} />
      </div>
    );
  }

  return (
    <div className="email-preview-shell" style={{ border: '1px solid var(--border)', borderRadius: 12, background: '#ffffff', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
      <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} />
          <Text style={{ fontSize: 11, color: '#64748b', marginLeft: 10, fontWeight: 500 }}>
            New Message — Preview Mode
          </Text>
        </div>
        <div style={{ display: 'flex', fontSize: 13, gap: 10 }}>
          <Text style={{ width: 60, color: '#64748b' }}>Subject:</Text>
          <Text strong style={{ color: '#0f172a' }}>{subject}</Text>
        </div>
        <div style={{ display: 'flex', fontSize: 13, gap: 10 }}>
          <Text style={{ width: 60, color: '#64748b' }}>To:</Text>
          <Text style={{ color: '#334155' }}>{to}</Text>
        </div>
        {isWrapped && (
          <div style={{ display: 'flex', fontSize: 11.5, gap: 10 }}>
            <Text style={{ width: 60, color: '#64748b' }}>Format:</Text>
            <Text style={{ color: '#64748b' }}>
              Standard AAPNA header &amp; footer are applied automatically on send.
            </Text>
          </div>
        )}
      </div>
      <iframe title="Email preview" sandbox="" className="email-preview-iframe" srcDoc={srcDoc} />
    </div>
  );
}
