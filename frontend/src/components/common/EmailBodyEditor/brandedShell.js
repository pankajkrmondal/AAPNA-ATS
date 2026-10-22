/**
 * Mirrors wrapBrandedEmail()'s table skeleton (backend/src/services/
 * emailLayout.service.js) so an editable/preview render matches the delivered
 * mail exactly. Shared by useEmailIframeEditor (editable) and EmailPreviewPane
 * (read-only) so the two can never drift from each other.
 *
 * `wrapper` is { headerHtml, footerHtml } from a backend preview-compile
 * endpoint — the same module the send path uses to build the real email.
 *
 * FONT-FAMILY IS SET ON THE TABLES, NOT JUST <body>, ON PURPOSE.
 * This output is handed to an iframe `srcDoc`, and it is also run through
 * DOMPurify by EmailPreviewPane — which strips the document wrapper, so the
 * doctype below cannot be relied on to survive every path. Without a doctype
 * the iframe parses in quirks mode, where tables do NOT inherit font-family
 * from <body>: every word of the email then falls back to the browser's
 * default serif, which is what made the editable shell read as a plain
 * document rather than an email. Declaring the family on the tables makes the
 * render correct either way — and it is how real email HTML is written
 * anyway, since mail clients cannot be trusted to inherit it.
 */
const FONT_STACK = 'Arial,Helvetica,sans-serif';

export function buildBrandedShellHtml(bodyHtml, wrapper, { editable = false } = {}) {
  const bodyCell = editable
    ? `<div data-editable-body contenteditable="true">${bodyHtml}</div>`
    : (bodyHtml || '');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="margin:0;padding:0;background:#f4f6f9;font-family:${FONT_STACK}">`
    + `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 10px;font-family:${FONT_STACK}"><tr><td align="center">`
    + `<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08);font-family:${FONT_STACK}">`
    + wrapper.headerHtml
    + `<tr><td style="padding:32px 40px 24px 40px;font-family:${FONT_STACK};font-size:15px;color:#374151;line-height:1.8">${bodyCell}</td></tr>`
    + (wrapper.footerHtml || '')
    + `</table></td></tr></table></body></html>`;
}
