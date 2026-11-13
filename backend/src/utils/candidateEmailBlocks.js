/**
 * Small HTML blocks added to candidate emails (Phase 3 "Do Now", section C).
 * Pure, so they can be unit-tested; every value is HTML-escaped.
 *
 *   companyBlockHtml(text)   "About AAPNA" block (N17; U02c: copied once into the Shortlist template)
 *   jdLinkHtml(link)         fallback when the JD cannot be attached (N17)
 *   phoneConfirmHtml(link)   ask a candidate with no valid phone to confirm it (N22)
 *   appendToBody(html, ...)  add blocks at the end; inside the card (above the sign-off) for a full document
 *   insertAfterIntro(html, ...) add blocks right after the intro paragraph (INTRO_SLOT_ATTR)
 *   placeJdLink(html, card)  the JD card at the template's {{jd_link}}, else as before (U02b)
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
 * "About AAPNA" block. Plain text in, line breaks kept. Since U02c it is used only by
 * scripts/move-about-aapna-into-shortlist-template.mjs; the text now lives in the template.
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
 * Shown instead of the attachment when the JD is too large or unreadable: a
 * card with a "View Job Description" button. Table-based with inline styles
 * (Outlook desktop ignores div layouts); same look as the shortlist email's
 * "Interview Process" box. The button sits on its own line so it stacks on a
 * phone.
 * @param {string|null|undefined} link
 * @returns {string} '' when there is no usable link
 */
export function jdLinkHtml(link) {
  const href = safeHref(link);
  if (!href) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background:#f6f9eb;border-left:4px solid #7a922e;border-radius:8px;">`
    + `<tr><td style="padding:18px 20px;font-size:14px;color:#374151;line-height:1.6;">`
    + `<p style="margin:0 0 4px 0;font-size:15px;font-weight:700;color:#5a6e1f;">Job Description</p>`
    + `<p style="margin:0 0 14px 0;">Take a few minutes to read the full role details before your next step.</p>`
    + `<a href="${href}" target="_blank" style="display:inline-block;padding:10px 22px;background:#7a922e;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;">View Job Description</a>`
    + `</td></tr></table>`;
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
 * Marks the intro paragraph of the shortlist email ({role_paragraph}, built in
 * screening.service.js and mirrored in DecisionEmailModal.jsx). Blocks that
 * belong right under the intro (the JD card) are inserted after it.
 */
export const INTRO_SLOT_ATTR = 'data-ats-intro';

/** "Best regards" / "Warm regards" / "Kind regards" / a line opening "Regards," */
const SIGNOFF_RE = /\b(?:best|warm|kind)\s+regards\b|(?:^|>)\s*regards\s*,/gim;

/** Index of the last sign-off in `s` before `limit`, or -1. */
function lastSignoff(s, limit = s.length) {
  const hay = s.slice(0, limit);
  let at = -1;
  SIGNOFF_RE.lastIndex = 0;
  for (let m = SIGNOFF_RE.exec(hay); m; m = SIGNOFF_RE.exec(hay)) at = m.index;
  return at;
}

/** Index of the last opening tag matching `re` (global) in `s` before `limit`, or -1. */
function lastOpenTag(s, re, limit) {
  const hay = s.slice(0, limit);
  let at = -1;
  re.lastIndex = 0;
  for (let m = re.exec(hay); m; m = re.exec(hay)) at = m.index;
  return at;
}

/**
 * Appends blocks to an email body, keeping them above the sign-off.
 *
 *   full document  as a new card row just above the sign-off row ("Best
 *                  regards"), so the blocks sit inside the white card; with no
 *                  sign-off row, before </body>
 *   fragment       at the end, or just before the fragment's own sign-off when
 *                  it ends with one (wrapBrandedEmail only looks for a sign-off
 *                  in the body's last 400 characters, so a block after it would
 *                  add a second signature)
 *
 * @param {string} html
 * @param {...string} blocks - empty strings are skipped
 */
export function appendToBody(html, ...blocks) {
  const extra = blocks.filter(Boolean).join('');
  if (!extra) return html;
  const s = String(html ?? '');
  const lower = s.toLowerCase();
  const bodyEnd = lower.lastIndexOf('</body>');

  if (bodyEnd >= 0) {
    const signoff = lastSignoff(lower, bodyEnd);
    const row = signoff >= 0 ? lastOpenTag(lower, /<tr[\s>]/g, signoff) : -1;
    // The sign-off must sit inside that row, not after a row that already closed.
    if (row >= 0 && lower.indexOf('</tr>', row) > signoff) {
      return `${s.slice(0, row)}<tr><td style="padding:0 40px 24px 40px;">${extra}</td></tr>${s.slice(row)}`;
    }
    return `${s.slice(0, bodyEnd)}${extra}${s.slice(bodyEnd)}`;
  }

  const signoff = lastSignoff(lower);
  if (signoff >= 0 && signoff >= s.length - 400) {
    // Before the paragraph that holds the sign-off; when that opening tag is
    // far back (a wrapper div around the whole body), right at the sign-off.
    const open = lastOpenTag(lower, /<(?:p|div)[\s>]/g, signoff + 1);
    const textAt = lower[signoff] === '>' ? signoff + 1 : signoff;
    const at = open >= 0 && signoff - open <= 300 ? open : textAt;
    return `${s.slice(0, at)}${extra}${s.slice(at)}`;
  }
  return `${s}${extra}`;
}

/**
 * Inserts blocks right after the intro paragraph (the last element carrying
 * INTRO_SLOT_ATTR: pressing Enter in the editor can split the paragraph and
 * copy the attribute to both halves). With no marker, e.g. the recruiter
 * deleted the paragraph, falls back to appendToBody.
 * @param {string} html
 * @param {...string} blocks - empty strings are skipped
 */
export function insertAfterIntro(html, ...blocks) {
  const extra = blocks.filter(Boolean).join('');
  if (!extra) return html;
  const s = String(html);
  const lower = s.toLowerCase();
  const marker = lower.lastIndexOf(INTRO_SLOT_ATTR);
  const close = marker >= 0 ? lower.indexOf('</p>', marker) : -1;
  if (close < 0) return appendToBody(s, extra);
  const at = close + '</p>'.length;
  return `${s.slice(0, at)}${extra}${s.slice(at)}`;
}

/**
 * Where the JD card goes in a candidate template: `{{jd_link}}` (U02b). HR
 * places the chip on the Email Templates page. In an editable preview (the
 * Schedule window, the outcome popup) the token compiles to a visible marker
 * the editor keeps (a data- attribute, as for {{candidate_table}}); the card
 * replaces the token or the marker at send time (placeJdLink).
 */
export const JD_LINK_TOKEN = '{{jd_link}}';
export const JD_LINK_ATTR = 'data-ats-jd-link';
export const JD_LINK_PLACEHOLDER = `<div ${JD_LINK_ATTR}="1" style="margin:14px 0;padding:8px 10px;border:1px dashed #c9d3a7;border-radius:6px;color:#6b7280;font-size:12px;">The Job Description card goes here when the JD is sent as a link. When the JD is attached as a file, nothing shows here.</div>`;

/** Filler the editor leaves around a lone token in its paragraph. */
const FILL = '(?:\\s|&nbsp;|<br\\s*/?>)*';
const TOKEN = '\\{\\{?\\s*jd_link\\s*\\}\\}?';
/**
 * One JD slot: a paragraph holding only the token (replaced whole, so the
 * card's table never lands inside a <p>), the preview marker, or a bare token.
 */
const jdSlotRe = () => new RegExp(
  `<(p|div)\\b[^>]*>${FILL}${TOKEN}${FILL}</\\1>|<(div|p)\\b[^>]*${JD_LINK_ATTR}[^>]*>[\\s\\S]*?</\\2>|${TOKEN}`,
  'gi',
);

/** Does the body say where the JD card goes ({{jd_link}} or its marker)? */
export function hasJdLinkSlot(html) {
  return jdSlotRe().test(String(html ?? ''));
}

/**
 * Puts the JD card where the template says (U02b): at the first `{{jd_link}}`
 * token or its marker; any further slots are removed. With no slot, `fallback`
 * places it as before (appendToBody; shortlists pass insertAfterIntro). An
 * empty `linkHtml` (the JD is attached, switched off or missing) removes every
 * slot, so a raw token never reaches a candidate.
 * @param {string} html
 * @param {string} [linkHtml] - the jdLinkHtml card, or ''
 * @param {{ fallback?: (html: string, block: string) => string }} [options]
 * @returns {string}
 */
export function placeJdLink(html, linkHtml = '', { fallback = appendToBody } = {}) {
  const s = String(html ?? '');
  const card = linkHtml || '';
  let placed = false;
  const out = s.replace(jdSlotRe(), () => {
    if (placed) return '';
    placed = true;
    return card;
  });
  if (placed) return out;
  return card ? fallback(s, card) : s;
}

export default {
  escapeHtml, companyBlockHtml, jdLinkHtml, phoneConfirmHtml, appendToBody, insertAfterIntro, INTRO_SLOT_ATTR,
  placeJdLink, hasJdLinkSlot, JD_LINK_TOKEN, JD_LINK_ATTR, JD_LINK_PLACEHOLDER,
};
