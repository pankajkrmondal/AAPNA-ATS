import DOMPurify from 'dompurify';
import { html_beautify } from 'js-beautify';

// Strip base64/data-URI images anywhere we sanitize — they're blocked by Outlook/Gmail
// on send and bloat stored HTML. Hosted https images (added via Insert image) are kept.
// Registered once, globally — DOMPurify hooks aren't scoped per call site, so this must
// live in code every editor consumer actually imports (previously only registered by
// the Email Templates page, leaving other editors unprotected until that page happened
// to have been visited in the same session).
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'img' && node.getAttribute) {
    const src = (node.getAttribute('src') || '').trim().toLowerCase();
    if (src.startsWith('data:') && node.parentNode) {
      node.parentNode.removeChild(node);
    }
  }
});

export const SANITIZE_OPTS = { WHOLE_DOCUMENT: true, ADD_TAGS: ['style'], ADD_ATTR: ['target'] };

export const sanitizeDoc = (html) => DOMPurify.sanitize(html || '', SANITIZE_OPTS);

// Pretty-print serialized email HTML so a raw-source view is readable — the
// WYSIWYG serializer emits it as one long line.
export const formatHtml = (html) => {
  try {
    return html_beautify(html || '', {
      indent_size: 2,
      wrap_line_length: 0,
      preserve_newlines: true,
      max_preserve_newlines: 1,
    });
  } catch {
    return html || '';
  }
};
