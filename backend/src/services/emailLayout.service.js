/**
 * emailLayout.service.js — the single AAPNA branded email shell.
 *
 * Every Pipeline Tracker notification (stage outcomes, interview
 * schedule/reschedule/cancel, reminders, scorecard invites, occurrence
 * nudges) stores only its BODY as an HTML fragment. The green header,
 * logo, card and footer are added here, once, at send time.
 *
 * Why wrap at send time instead of baking the shell into each template
 * (docs/phase3/PIPELINE-TRACKER-BRANDED-EMAIL-PLAN.md §2):
 *  - the recruiter edits the body in a designMode iframe before sending;
 *    chrome inside that value could be deleted or broken by a stray edit,
 *  - ensureTeamsBlock() appends the Teams card by concatenation, which on a
 *    full document would land after </html> — outside the branded card,
 *  - two reminder bodies are hard-coded with no template row to edit,
 *  - one shell means one place to change the logo or colour.
 *
 * Ordering on every send path is:
 *   compile -> recruiter edit -> ensureTeamsBlock -> wrapBrandedEmail
 *   -> injectTrackingPixel -> sendGraphEmail
 * injectTrackingPixel must run last: it inserts before </body>, which only
 * exists once this module has wrapped the fragment.
 *
 * Markup is deliberately table-based and copied from the proven statusBody()
 * shell in prisma/seed-email-templates.js — Outlook desktop does not honour
 * div+flex layouts. Do not re-author it as divs.
 */

/** Brand tokens — the values already used across the seeded branded templates. */
const BRAND = Object.freeze({
  accent: '#7a922e',
  page: '#f4f6f9',
  card: '#ffffff',
  text: '#374151',
  footerBg: '#f3f4f6',
  footerText: '#9ca3af',
  logo: 'https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png',
});

/** Marks the editable body slot for the drawer's preview editor (§4.1). */
export const EDITABLE_SLOT_ATTR = 'data-editable-body';

/**
 * True when the HTML already carries its own document shell.
 *
 * This is the guard that makes wrapping safe to apply everywhere: the legacy
 * branded templates (Welcome, Shortlist, Duplicate Alert, Rejection, On Hold)
 * and any admin-authored full-document template pass through untouched and
 * render exactly as they do today. It also protects against double-wrapping a
 * body that a recruiter saved before this change shipped.
 *
 * @param {string} html
 * @returns {boolean}
 */
export function isFullHtmlDocument(html) {
  if (typeof html !== 'string' || html.trim() === '') return false;
  return /<!DOCTYPE\s|<html[\s>]|<body[\s>]/i.test(html);
}

/**
 * Strips the preview-only editable-slot marker from a body fragment.
 * The drawer round-trips the slot's innerHTML, so the attribute should never
 * reach a delivered email; this is belt-and-braces for any path that echoes a
 * wrapped preview back to the send path.
 *
 * @param {string} html
 * @returns {string}
 */
export function stripEditableSlot(html) {
  if (typeof html !== 'string') return html;
  return html.replace(new RegExp(`\\s*${EDITABLE_SLOT_ATTR}(="[^"]*")?`, 'gi'), '');
}

/**
 * Escapes text destined for the header band. The title is the email SUBJECT,
 * which is free text (recruiter-editable, and may carry a candidate name or a
 * role like "C++ & .NET"), so it must never be interpolated as raw HTML.
 */
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The green header band: logo, title, and the standing sub-line. */
function headerHtml(title, subtitle, accent) {
  const safeTitle = escapeHtml(title).trim();
  return `<tr><td style="background:${accent};padding:32px 40px;text-align:center">`
    + `<img src="${BRAND.logo}" width="190" alt="AAPNA Infotech" style="display:block;margin:0 auto 16px auto">`
    + (safeTitle ? `<h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:800">${safeTitle}</h1>` : '')
    + `<p style="margin:6px 0 0 0;color:#e7f0c5;font-size:13px">${escapeHtml(subtitle)}</p>`
    + `</td></tr>`;
}

/** The grey footer band. */
function footerHtml() {
  return `<tr><td style="background:${BRAND.footerBg};padding:16px;text-align:center;font-size:12px;color:${BRAND.footerText}">`
    + `This email was sent by AAPNA Infotech's recruitment system.<br>`
    + `&copy; 2026 AAPNA Infotech. All rights reserved.`
    + `</td></tr>`;
}

/**
 * Wraps a body fragment in the standard AAPNA branded email shell.
 *
 * Idempotent by design: a body that is already a full HTML document is
 * returned unchanged (see isFullHtmlDocument), so this can be applied to every
 * send path without auditing which templates are already branded.
 *
 * `title` is the email's own SUBJECT (RT decision, 2026-07-25). The legacy
 * branded templates already work this way — "Application on Hold" appears both
 * as the subject and as the header headline — so passing the compiled subject
 * keeps the new templates consistent with them and needs no per-template
 * configuration. Callers must pass the subject AFTER any recruiter edit, so the
 * band never disagrees with what the mail client shows.
 *
 * @param {string} bodyHtml - the body fragment (already compiled + recruiter-edited)
 * @param {object} [opts]
 * @param {string} [opts.title] - headline inside the green band; pass the compiled subject
 * @param {string} [opts.subtitle] - small line under the title
 * @param {string} [opts.accent] - header background; defaults to the AAPNA green
 * @param {boolean} [opts.editableSlot] - emit the data-editable-body marker (preview only)
 * @returns {string} a full HTML document, or the input unchanged
 */
export function wrapBrandedEmail(bodyHtml, {
  title = '',
  subtitle = 'AAPNA Infotech — Recruitment Update',
  accent = BRAND.accent,
  editableSlot = false,
} = {}) {
  // Already a document (legacy branded template) — never nest a second shell.
  if (isFullHtmlDocument(bodyHtml)) return bodyHtml;

  const body = typeof bodyHtml === 'string' ? bodyHtml : '';
  const slotAttr = editableSlot ? ` ${EDITABLE_SLOT_ATTR}="1"` : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="margin:0;padding:0;background:${BRAND.page};font-family:Arial,Helvetica,sans-serif">`
    + `<table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};padding:30px 10px"><tr><td align="center">`
    + `<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:${BRAND.card};border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08)">`
    + headerHtml(title, subtitle, accent)
    + `<tr><td style="padding:32px 40px 24px 40px;font-size:15px;color:${BRAND.text};line-height:1.8">`
    + `<div${slotAttr}>${body}</div>`
    + `</td></tr>`
    + footerHtml()
    + `</table></td></tr></table></body></html>`;
}

/**
 * The header/footer chrome as standalone strings, for the drawer's
 * "preview before send" popup: the UI renders these around the editable body
 * so the recruiter sees the real email while only ever editing the fragment.
 *
 * Produced by the same functions the send path uses, so the preview cannot
 * drift from what is delivered.
 *
 * @param {object} [opts] - same title/subtitle/accent as wrapBrandedEmail
 * @returns {{headerHtml: string, footerHtml: string, title: string, accent: string}}
 */
export function brandedWrapperParts({ title = '', subtitle = 'AAPNA Infotech — Recruitment Update', accent = BRAND.accent } = {}) {
  return {
    headerHtml: headerHtml(title, subtitle, accent),
    footerHtml: footerHtml(),
    title,
    accent,
  };
}

export default { wrapBrandedEmail, isFullHtmlDocument, brandedWrapperParts, stripEditableSlot, EDITABLE_SLOT_ATTR };
