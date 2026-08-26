/**
 * Mirrors wrapBrandedEmail()'s table skeleton (backend/src/services/
 * emailLayout.service.js) so an editable/preview render matches the delivered
 * mail exactly. Shared by useEmailIframeEditor (editable) and EmailPreviewPane
 * (read-only) so the two can never drift from each other.
 *
 * `wrapper` is { headerHtml, footerHtml } from a backend preview-compile
 * endpoint — the same module the send path uses to build the real email.
 */
export function buildBrandedShellHtml(bodyHtml, wrapper, { editable = false } = {}) {
  const bodyCell = editable
    ? `<div data-editable-body contenteditable="true">${bodyHtml}</div>`
    : (bodyHtml || '');
  return `<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif">`
    + `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:20px 8px"><tr><td align="center">`
    + `<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08)">`
    + wrapper.headerHtml
    + `<tr><td style="padding:32px 40px 24px 40px;font-size:15px;color:#374151;line-height:1.8">${bodyCell}</td></tr>`
    + (wrapper.footerHtml || '')
    + `</table></td></tr></table></body>`;
}
