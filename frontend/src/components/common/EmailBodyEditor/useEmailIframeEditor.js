import { useEffect, useMemo, useRef } from 'react';
import { message } from 'antd';
import { sanitizeDoc } from './sanitize';
import { buildBrandedShellHtml } from './brandedShell';

const contentCss = (compact) => `
  html, body { margin: 0; }
  body:focus { outline: none; }
  /* Degraded (no-wrapper) mode only — the branded shell supplies its own padding. */
  body:not(:has([data-editable-body])) { padding: ${compact ? '12px' : '16px'}; font-family: Arial, Helvetica, sans-serif; font-size: ${compact ? '13px' : '14px'}; -webkit-font-smoothing: antialiased; }
  /* Make the editable region visibly the only editable part. */
  [data-editable-body] { outline: 1px dashed rgba(79,47,184,0.55); outline-offset: 6px; border-radius: 2px; min-height: 60px; }
  [data-editable-body]:focus { outline: 2px solid rgba(79,47,184,0.85); }
  img { max-width: 100%; }
`;

/**
 * Dual-mode iframe rich-text editing engine, shared by every email editor in
 * the app.
 *
 * Whole-document mode (`wrapper` absent): designMode='on' on the entire
 * iframe document — used by the Email Templates page and Candidate
 * Screening's shortlist/reject modal, where the template/draft IS the raw
 * body.
 *
 * Protected-chrome mode (`wrapper` = {headerHtml, footerHtml}): only a
 * [data-editable-body] slot inside a REAL branded email shell is editable;
 * the header/footer chrome stays read-only. This is a deliberate fix for a
 * documented prior bug — letting the whole document be editable let a stray
 * edit corrupt/delete the header or footer and ship it that way. Preserved
 * here, not reintroduced.
 */
export default function useEmailIframeEditor({ initialHtml, onChange, wrapper, subject, compact = false }) {
  const iframeRef = useRef(null);
  const savedSelRef = useRef(null);

  // Frozen on first mount only — reloading on every keystroke would drop the
  // caret. Consumers remount via `key` to load genuinely different content.
  const srcDoc = useMemo(() => {
    const body = sanitizeDoc(initialHtml || '<p>Empty.</p>');
    return wrapper?.headerHtml ? buildBrandedShellHtml(body, wrapper, { editable: true }) : body;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The header headline IS the subject in protected-chrome sends, so keep the
  // band in step as the recruiter edits the subject field. Hard-gated on
  // `wrapper` — whole-document templates may carry their own real <h1> that
  // must never be silently overwritten by subject keystrokes.
  useEffect(() => {
    if (!wrapper?.headerHtml) return;
    const doc = iframeRef.current?.contentDocument;
    const h1 = doc?.querySelector('h1');
    if (!h1) return;
    const next = (subject || '').trim();
    if (h1.textContent !== next) h1.textContent = next;
  }, [subject, wrapper?.headerHtml]);

  /** Reads back only the editable region — the slot in protected-chrome mode, the whole document otherwise. */
  const syncFromEditor = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const slot = doc.querySelector('[data-editable-body]');
    if (slot) {
      onChange(slot.innerHTML);
      return;
    }
    if (doc.designMode === 'on') {
      const clone = doc.documentElement.cloneNode(true);
      clone.querySelectorAll('style[data-editor-css]').forEach((el) => el.remove());
      // Strip pasted base64 images that rode along in HTML paste — unreliable
      // in real mail clients and bloats stored HTML.
      clone.querySelectorAll('img[src^="data:"]').forEach((el) => el.remove());
      onChange(clone.outerHTML);
    }
  };

  const handleLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const slot = doc.querySelector('[data-editable-body]');
    if (slot) {
      // Chrome stays read-only; only the body slot accepts input.
      slot.setAttribute('contenteditable', 'true');
    } else {
      doc.designMode = 'on';
    }

    // Drop editor-CSS copies that leaked into content saved before
    // serialization stripped them.
    doc.querySelectorAll('style').forEach((s) => {
      if (s.getAttribute('data-editor-css')) s.remove();
    });
    const style = doc.createElement('style');
    style.textContent = contentCss(compact);
    style.setAttribute('data-editor-css', '1');
    doc.head?.appendChild(style);

    doc.addEventListener('input', syncFromEditor);
    doc.addEventListener('selectionchange', () => {
      const sel = doc.getSelection?.();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        // Only remember selections inside the editable region, so the toolbar
        // can never apply formatting to protected chrome.
        const scope = slot || doc.body;
        if (scope?.contains(range.commonAncestorContainer)) {
          savedSelRef.current = range.cloneRange();
        }
      }
    });
    // No image hosting — block pasted/dropped raster images (base64 is
    // unreliable in real mail clients and bloats stored HTML).
    doc.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items || [];
      if (Array.from(items).some((it) => it.type?.startsWith('image/'))) {
        e.preventDefault();
        message.info('Pasted images aren’t supported. Use "Insert image" to add a hosted URL.');
        return;
      }
      setTimeout(syncFromEditor, 0);
    }, true);
    doc.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files || [];
      if (Array.from(files).some((f) => f.type?.startsWith('image/'))) {
        e.preventDefault();
        message.info('Dropped images aren’t supported. Use "Insert image" to add a hosted URL.');
      }
    }, true);
  };

  const exec = (command, value = null) => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    iframeRef.current.contentWindow?.focus();
    // Focus the editable slot so execCommand has a valid target even before
    // the recruiter has clicked into the body — harmless no-op in whole-doc
    // mode, where there is no slot.
    doc.querySelector('[data-editable-body]')?.focus?.();
    const sel = doc.getSelection?.();
    if (sel && savedSelRef.current) {
      try { sel.removeAllRanges(); sel.addRange(savedSelRef.current); } catch { /* stale range */ }
    }
    try { doc.execCommand(command, false, value); } catch { /* noop */ }
    syncFromEditor();
  };

  const handleInsertLink = () => {
    const url = window.prompt('Link URL (https://…)');
    if (url && url.trim()) exec('createLink', url.trim());
  };

  const insertPlaceholder = (token) => exec('insertText', token);

  return { iframeRef, srcDoc, handleLoad, exec, handleInsertLink, insertPlaceholder };
}
