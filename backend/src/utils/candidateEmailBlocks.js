/**
 * Small HTML blocks added to candidate emails (Phase 3 "Do Now", section C).
 * Pure, so they can be unit-tested; every value is HTML-escaped.
 *
 *   companyBlockHtml(text)   "About AAPNA" from Settings (N17)
 *   jdLinkHtml(link)         fallback when the JD cannot be attached (N17)
 *   phoneConfirmHtml(link)   ask a candidate with no valid phone to confirm it (N22)
 *   appendToBody(html, ...)  insert blocks before </body> when the body is a full document
 */

export const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/** Only http(s) links are written into an href. */
const safeHref = (link) => (/^https?:\/\//i.test(String(link || '').trim()) ? escapeHtml(String(link).trim()) : null);

/**
 * "About AAPNA" from the Settings text. Plain text in, line breaks kept.
 * @param {string|null|undefined} text
 * @returns {string} '' when the setting is empty
 */
export function companyBlockHtml(text) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const body = escapeHtml(t).replace(/\r?\n/g, '<br>');
  return `<div style="border-top:1px solid #e5e7eb;margin-top:18px;padding-top:12px;font-size:13px;color:#374151;">`
    + `<p style="margin:0 0 6px 0;font-weight:700;color:#111827;">About AAPNA</p>`
    + `<p style="margin:0;">${body}</p></div>`;
}

/**
 * Shown instead of the attachment when the JD is too large or unreadable.
 * @param {string|null|undefined} link
 * @returns {string} '' when there is no usable link
 */
export function jdLinkHtml(link) {
  const href = safeHref(link);
  if (!href) return '';
  return `<p style="margin:14px 0 0 0;">View the job description: <a href="${href}">Job description</a></p>`;
}

/**
 * Asks the candidate to confirm their mobile number on the details form.
 * @param {string|null|undefined} link - the missing-details form link
 * @returns {string}
 */
export function phoneConfirmHtml(link) {
  const href = safeHref(link);
  if (!href) return '';
  return `<p style="margin:14px 0 0 0;"><strong>Please confirm your mobile number.</strong> `
    + `We use it to reach you about interviews: <a href="${href}">Confirm your mobile number</a></p>`;
}

/**
 * Appends blocks to an email body: before </body> for a full HTML document,
 * otherwise at the end.
 * @param {string} html
 * @param {...string} blocks - empty strings are skipped
 */
export function appendToBody(html, ...blocks) {
  const extra = blocks.filter(Boolean).join('');
  if (!extra) return html;
  const i = String(html).toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? `${html.slice(0, i)}${extra}${html.slice(i)}` : `${html}${extra}`;
}

export default { escapeHtml, companyBlockHtml, jdLinkHtml, phoneConfirmHtml, appendToBody };
