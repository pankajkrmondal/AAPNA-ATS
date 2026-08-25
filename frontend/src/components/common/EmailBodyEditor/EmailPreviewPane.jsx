import { useRef } from 'react';
import { Typography } from 'antd';
import DOMPurify from 'dompurify';
import { SANITIZE_OPTS } from './sanitize';
import { buildBrandedShellHtml } from './brandedShell';
import { wrapBrandedPreview } from '../../../utils/emailPreview';

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
export default function EmailPreviewPane({ subject, bodyHtml, wrapper, variant = 'full', to = 'candidate@example.com', autoHeight = false }) {
  const frameRef = useRef(null);

  /**
   * Grows the frame to its content so a short email leaves no dead white space
   * and a long one needs no inner scrollbar — the page scrolls instead. Opt-in,
   * so the compact/modal previews keep their fixed heights.
   */
  const handleLoad = () => {
    if (!autoHeight) return;
    const doc = frameRef.current?.contentDocument;
    const h = doc?.documentElement && Math.ceil(doc.documentElement.getBoundingClientRect().height);
    if (h > 0) frameRef.current.style.height = `${h}px`;
  };

  const srcDoc = wrapper?.headerHtml
    ? DOMPurify.sanitize(buildBrandedShellHtml(DOMPurify.sanitize(bodyHtml || '', SANITIZE_OPTS), wrapper), { ADD_TAGS: ['style'], ADD_ATTR: ['target'] })
    : DOMPurify.sanitize(
        wrapBrandedPreview(bodyHtml || '<p style="font-family:sans-serif;color:#8a8f8c">Empty.</p>', { title: subject }),
        SANITIZE_OPTS
      );

  if (variant === 'compact') {
    return (
      <div style={{ border: '1px solid var(--border-light, #eaebe8)', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ padding: '6px 10px', background: 'var(--ink-4, #f4f6f9)', fontSize: 12, fontWeight: 600 }}>
          {subject}
        </div>
        <iframe title="Email preview" sandbox="" className="email-preview-iframe" style={{ height: 260 }} srcDoc={srcDoc} />
      </div>
    );
  }

  return (
    <div className="email-preview-shell">
      {/* Chrome styling lives in index.css (.email-preview-shell*) rather than
          in an inline object here. It was previously an off-palette slate ramp
          with no dark-mode path, so this bar stayed near-white in dark mode. */}
      <div className="email-preview-shell__chrome">
        <div className="email-preview-shell__lights">
          <div className="email-preview-shell__light email-preview-shell__light--r" />
          <div className="email-preview-shell__light email-preview-shell__light--y" />
          <div className="email-preview-shell__light email-preview-shell__light--g" />
          <Text className="email-preview-shell__mode">New Message — Preview Mode</Text>
        </div>
        <div className="email-preview-shell__row">
          <Text className="email-preview-shell__key">Subject:</Text>
          <Text strong className="email-preview-shell__val email-preview-shell__val--strong">{subject}</Text>
        </div>
        <div className="email-preview-shell__row">
          <Text className="email-preview-shell__key">To:</Text>
          <Text className="email-preview-shell__val">{to}</Text>
        </div>
      </div>
      {/* `sandbox="allow-same-origin"`, not the empty `sandbox=""` this carried
          before — that made the frame an OPAQUE origin, which silently nulls
          `contentDocument` from the parent (same-origin policy), so
          `handleLoad()` below could never measure the content and `autoHeight`
          never actually fired: the frame sat stuck at CSS's `min-height:
          240px` with anything taller spilling into the browser's own iframe
          scrollbar — while the Editor tab's iframe (no sandbox at all; see
          EmailBodyEditor.jsx) auto-grew correctly, which is why only Preview
          showed one.
          `allow-same-origin` WITHOUT `allow-scripts` does not reopen the XSS
          surface sandbox="" was closing: script execution is still fully
          blocked (no <script>, no inline handlers, no javascript: URLs)
          regardless of origin — only combining allow-same-origin WITH
          allow-scripts would be dangerous, and this adds neither. The content
          is also already DOMPurify-sanitized before it ever reaches srcDoc. */}
      <iframe
        ref={frameRef}
        title="Email preview"
        sandbox="allow-same-origin"
        className="email-preview-iframe"
        srcDoc={srcDoc}
        onLoad={handleLoad}
      />
    </div>
  );
}
