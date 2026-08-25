import { useEffect, useMemo, useRef } from 'react';
import { message } from 'antd';
import { sanitizeDoc } from './sanitize';
import { buildBrandedShellHtml } from './brandedShell';

const contentCss = (compact) => `
  html, body { margin: 0; }
  body:focus { outline: none; }
  /* Degraded (no-wrapper) mode only — the branded shell supplies its own padding. */
  body:not(:has([data-editable-body])) { padding: ${compact ? '12px' : '16px'}; font-family: Arial, Helvetica, sans-serif; font-size: ${compact ? '13px' : '14px'}; -webkit-font-smoothing: antialiased; }
  /* The editable region is deliberately UNMARKED at rest, so the shell reads as
     the delivered email rather than as a form field inside a page — that framing
     was the whole difference in feel against a legacy whole-document template.
     Discoverability comes from hover and confirmation from focus, both as a soft
     tint rather than a hard rule. Note the read-only guarantee does not live
     here: it comes from which element carries contenteditable (see handleLoad),
     so softening this costs no protection. */
  [data-editable-body] { outline: none; min-height: 60px; border-radius: 4px; transition: background-color 120ms ease, box-shadow 120ms ease; }
  [data-editable-body]:hover { background-color: rgba(122,146,46,0.06); box-shadow: 0 0 0 6px rgba(122,146,46,0.06); }
  [data-editable-body]:focus { background-color: rgba(122,146,46,0.08); box-shadow: 0 0 0 6px rgba(122,146,46,0.08), 0 0 0 7px rgba(122,146,46,0.35); }
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
export default function useEmailIframeEditor({ initialHtml, onChange, wrapper, subject, compact = false, autoHeight = false }) {
  const iframeRef = useRef(null);
  const savedSelRef = useRef(null);
  const resizeObsRef = useRef(null);

  /**
   * Grows the frame to exactly its content so the PAGE does the scrolling and
   * there is no dead white space under a short email. Opt-in: callers that pass
   * an explicit `height` (the Pipeline drawer modals) must keep it, and an
   * inline height set here would silently override theirs.
   *
   * Measuring documentElement is safe from a feedback loop because nothing in
   * the shell sets height:100% — the document is content-sized, so it never
   * grows to fill whatever the frame currently is.
   */
  const autoSize = () => {
    if (!autoHeight) return;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc?.documentElement) return;
    const h = Math.ceil(doc.documentElement.getBoundingClientRect().height);
    if (h > 0) iframe.style.height = `${h}px`;
  };

  // Stop observing when the editor unmounts (it remounts per template).
  useEffect(() => () => {
    resizeObsRef.current?.disconnect();
    resizeObsRef.current = null;
  }, []);

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
    // Typing changes the content height, so the frame follows it.
    autoSize();
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

    // Measure once the content CSS is in, then keep following it — a late
    // reflow (web font swapping in, an image resolving) changes the height
    // after load, which a one-shot measurement would miss.
    autoSize();
    if (autoHeight && typeof ResizeObserver !== 'undefined' && doc.documentElement) {
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = new ResizeObserver(autoSize);
      resizeObsRef.current.observe(doc.documentElement);
    }

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
