/**
 * Visual (WYSIWYG) email body editor: a designMode iframe with a small formatting
 * toolbar, mirroring the editor already proven on the Email Templates page
 * (EmailManagement.jsx). Lets HR edit the compiled email like a normal rich-text
 * box instead of hand-editing raw HTML.
 *
 * Uncontrolled after mount: `initialHtml` seeds the document once, edits stream
 * out via onChange as serialized HTML. To reset the content, remount the
 * component (e.g. change its `key`) rather than pushing a new `initialHtml`.
 */
import { useMemo, useRef } from 'react';
import { Button, Tag, Tooltip } from 'antd';
import {
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  LinkOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import DOMPurify from 'dompurify';

const SANITIZE_OPTS = { WHOLE_DOCUMENT: true, ADD_TAGS: ['style'], ADD_ATTR: ['target'] };
const sanitizeDoc = (html) => DOMPurify.sanitize(html || '', SANITIZE_OPTS);

// Minimal styling injected INTO the editor iframe so editing is comfortable without
// overriding the email's own inline styles.
const EDITOR_CONTENT_CSS = `
  html, body { margin: 0; }
  body { padding: 12px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; -webkit-font-smoothing: antialiased; }
  body:focus { outline: none; }
  img { max-width: 100%; }
`;

export default function EmailBodyEditor({ initialHtml, onChange, placeholders = [], height = 260 }) {
  const iframeRef = useRef(null);
  const savedSelRef = useRef(null);

  // Computed once for this mount — see the uncontrolled-after-mount note above.
  const srcDoc = useMemo(
    () => sanitizeDoc(initialHtml || '<p style="font-family:Arial,Helvetica,sans-serif;color:#8a8f8c">Empty email body.</p>'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const syncFromEditor = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || doc.designMode !== 'on') return;
    const clone = doc.documentElement.cloneNode(true);
    clone.querySelectorAll('style[data-editor-css]').forEach((el) => el.remove());
    // Strip pasted base64 images — unreliable in real mail clients and bloats stored HTML.
    clone.querySelectorAll('img[src^="data:"]').forEach((el) => el.remove());
    onChange?.(clone.outerHTML);
  };

  const focusAndRestore = () => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return null;
    iframe.contentWindow?.focus();
    const sel = doc.getSelection?.();
    if (sel && savedSelRef.current) {
      try {
        sel.removeAllRanges();
        sel.addRange(savedSelRef.current);
      } catch { /* range may be stale — ignore */ }
    }
    return doc;
  };

  const exec = (command, value = null) => {
    const doc = focusAndRestore();
    if (!doc) return;
    try { doc.execCommand(command, false, value); } catch { /* noop */ }
    syncFromEditor();
  };

  const handleLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.designMode = 'on';

    const style = doc.createElement('style');
    style.textContent = EDITOR_CONTENT_CSS;
    style.setAttribute('data-editor-css', '1');
    doc.head?.appendChild(style);

    doc.addEventListener('input', syncFromEditor);
    doc.addEventListener('selectionchange', () => {
      const sel = doc.getSelection?.();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (doc.body?.contains(range.commonAncestorContainer)) {
          savedSelRef.current = range.cloneRange();
        }
      }
    });
    // Block image paste (no image hosting here; base64 is unreliable on send).
    doc.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items || [];
      if (Array.from(items).some((it) => it.type?.startsWith('image/'))) e.preventDefault();
      setTimeout(syncFromEditor, 0);
    }, true);
  };

  const handleInsertLink = () => {
    const url = window.prompt('Link URL (https://…)');
    if (url && url.trim()) exec('createLink', url.trim());
  };

  const insertPlaceholder = (token) => {
    const doc = focusAndRestore();
    if (!doc) return;
    try { doc.execCommand('insertText', false, token); } catch { /* noop */ }
    syncFromEditor();
  };

  const noBlur = (e) => e.preventDefault(); // keep caret in the iframe when clicking the toolbar
  const sep = <span style={{ width: 1, height: 16, margin: '0 4px', background: 'var(--border-light, #eaebe8)' }} />;
  const toolbarBtn = (icon, title, onClick) => (
    <Tooltip title={title} key={title}>
      <Button type="text" size="small" icon={icon} onMouseDown={noBlur} onClick={onClick} />
    </Tooltip>
  );

  return (
    <div style={{ border: '1px solid var(--border-light, #eaebe8)', borderRadius: 8, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
          padding: '4px 6px',
          background: 'var(--ink, #f7f6f3)',
          borderBottom: '1px solid var(--border-light, #eaebe8)',
        }}
      >
        {toolbarBtn(<BoldOutlined />, 'Bold', () => exec('bold'))}
        {toolbarBtn(<ItalicOutlined />, 'Italic', () => exec('italic'))}
        {toolbarBtn(<UnderlineOutlined />, 'Underline', () => exec('underline'))}
        {sep}
        {toolbarBtn(<UnorderedListOutlined />, 'Bulleted list', () => exec('insertUnorderedList'))}
        {toolbarBtn(<OrderedListOutlined />, 'Numbered list', () => exec('insertOrderedList'))}
        {sep}
        {toolbarBtn(<LinkOutlined />, 'Insert link', handleInsertLink)}
        {toolbarBtn(<ClearOutlined />, 'Clear formatting', () => exec('removeFormat'))}
        {placeholders.length > 0 && (
          <>
            {sep}
            {placeholders.map((token) => (
              <Tooltip title="Insert at cursor" key={token}>
                <Tag
                  onMouseDown={noBlur}
                  onClick={() => insertPlaceholder(token)}
                  style={{ cursor: 'pointer', margin: 0, fontSize: 11, fontWeight: 500 }}
                >
                  +{token.replace(/[{}]/g, '')}
                </Tag>
              </Tooltip>
            ))}
          </>
        )}
      </div>
      <iframe
        ref={iframeRef}
        title="Email body editor"
        srcDoc={srcDoc}
        onLoad={handleLoad}
        style={{ width: '100%', height, border: 'none', display: 'block', background: '#fff' }}
      />
    </div>
  );
}
