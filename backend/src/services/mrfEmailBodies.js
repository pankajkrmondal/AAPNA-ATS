/**
 * Body fragments for the new-MRF flow's emails (L15), and the requisition
 * details table they all carry.
 *
 * Every one of these used to be its own hand-built document: the hiring
 * manager's "New MRF Request" (its own header, logo and a "© 2025" footer), the
 * approval request ("AAPNA Requisition Portal"), the HR copy and the outcome
 * (plain Calibri pages), and the decision notices. They are now fragments:
 * emailLayout.service.js wrapBrandedEmail() adds the branded header (the
 * subject is the headline), the sign-off and the footer, exactly as it does for
 * every pipeline and MRF Hold email.
 *
 * Markup is table-based on purpose — Outlook desktop does not honour div and
 * flex layouts (see emailLayout.service.js).
 *
 * Pure and import-free so the bodies can be unit-tested without Prisma, Graph
 * or config (tests/unit/mrfEmailBodies.test.js).
 */

const ACCENT = '#7a922e';
const ACCENT_DARK = '#5a6e1f';
const TEXT = '#374151';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const TINT = '#f6f8ef';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BUTTON_COLOURS = Object.freeze({
  primary: ACCENT,
  danger: '#c0392b',
  hold: '#234e8c',
});

/**
 * An email button: an anchor styled as a block, which every mail client draws.
 * @param {string} href
 * @param {string} label
 * @param {'primary'|'danger'|'hold'|'outline'} [kind]
 */
export function emailButton(href, label, kind = 'primary') {
  const url = escapeHtml(href);
  if (kind === 'outline') {
    return `<a href="${url}" target="_blank" style="background:#ffffff;color:${ACCENT_DARK};padding:10px 22px;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;display:inline-block;border:1.5px solid ${ACCENT};">${escapeHtml(label)}</a>`;
  }
  const bg = BUTTON_COLOURS[kind] || ACCENT;
  return `<a href="${url}" target="_blank" style="background:${bg};color:#ffffff;padding:11px 22px;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;display:inline-block;">${escapeHtml(label)}</a>`;
}

const CALLOUT_TONES = Object.freeze({
  note: { bg: TINT, border: ACCENT, text: TEXT },
  info: { bg: '#eef3fb', border: '#9db6dd', text: '#1b3d6e' },
});

/**
 * A highlighted note. `html` is trusted, caller-built markup.
 * @param {string} html
 * @param {'note'|'info'} [tone]
 */
export function emailCallout(html, tone = 'note') {
  const t = CALLOUT_TONES[tone] || CALLOUT_TONES.note;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:${t.bg};border-left:4px solid ${t.border};border-radius:6px">`
    + `<tr><td style="padding:12px 16px;font-size:14px;line-height:1.6;color:${t.text}">${html}</td></tr></table>`;
}

/** A step card: label, one line of explanation, one button. */
function stepCard(label, descHtml, buttonHtml) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;background:#f9fbf5;border:1px solid ${LINE};border-left:4px solid ${ACCENT};border-radius:8px">`
    + `<tr><td style="padding:16px 20px">`
    + `<p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${ACCENT_DARK}">${escapeHtml(label)}</p>`
    + `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#4b5563">${descHtml}</p>`
    + buttonHtml
    + `</td></tr></table>`;
}

// ── The requisition details table ──────────────────────────────────────

// Compact rows with light separators (not a full grid), muted labels and
// zebra striping: the approval email carries every field, so the table is
// styled to read quickly rather than trimmed.
const ROW_LINE = '#eef1e8';
const ZEBRA = '#fafbf7';
const CELL = `padding:7px 12px;border-bottom:1px solid ${ROW_LINE};vertical-align:top;font-size:13px;line-height:1.5`;
const LABEL_CELL = `${CELL};font-weight:600;color:${MUTED};width:42%`;
const VALUE_CELL = `${CELL};color:#1f2937`;
const HEAD_CELL = `padding:8px 12px;border-bottom:1px solid ${LINE};text-align:left;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${MUTED};background:${TINT}`;
const BAND_CELL = `padding:8px 12px;border-bottom:1px solid ${LINE};font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${ACCENT_DARK};background:${TINT}`;
const EMPTY_VALUE = '<span style="color:#c4c9bb">—</span>';

/**
 * The requisition details table stored on rpa_mrf.emailbody and carried by the
 * approval request, the HR copy and the outcome email.
 *
 * Every submitted value is escaped: the form is PUBLIC (/mrf-submit), and the
 * table goes straight into the approvers' inbox. It used to interpolate the
 * values raw, so markup typed into any field rendered in the approval email.
 *
 * @param {object} j - the submitted form values
 * @param {string|null} jdLink
 * @param {string|null} testPaperLink
 * @param {object|null} parsedJd - the AI-parsed JD summary
 * @returns {string} an HTML table
 */
export function buildMrfDetailsTable(j, jdLink, testPaperLink, parsedJd) {
  const v = (val) => (val === null || val === undefined || val === '' ? '' : escapeHtml(val));

  // For dropdown fields with an "Other" option: show "Other - <custom text>" when chosen.
  const otherFmt = (sel, other) =>
    String(sel || '').trim().toLowerCase() === 'other' && v(other)
      ? `Other - ${v(other)}`
      : v(sel);

  const aiExperienceRange = parsedJd && (parsedJd.min_experience_years != null || parsedJd.max_experience_years != null)
    ? `${v(parsedJd.min_experience_years) || '—'} - ${v(parsedJd.max_experience_years) || '—'} years`
    : '';
  const link = (url, text) => (url ? `<a href="${escapeHtml(url)}" style="color:${ACCENT_DARK}">${text}</a>` : 'Not Uploaded');

  const rows = [
    ['Submitter Email', v(j.submitter_email)],
    ['Name of the Hiring Manager', v(j.hiring_manager_name)],
    ['Designation of the Hiring Manager', v(j.hiring_manager_designation)],
    ['Date of Request', v(j.date_of_request)],
    ['Required in', v(j.required_in)],
    ['Position hiring for', v(j.position_hiring_for)],
    ['Number of Positions', v(j.number_of_positions)],
    ['Position reports to', v(j.position_reports_to)],
    ['Requirement for the team', v(j.requirement_for_team)],
    ['Requirement for team (Other)', v(j.requirement_for_team_other)],
    ['Desired Qualification', v(j.desired_qualification)],
    ['PG Qualification Info', v(j.pg_information)],
    ['Graduate / Other Info', v(j.graduate_other_information)],
    ['Other Qualification Info', v(j.other_qualification_more_info)],
    ['Replacement or New Role', v(j.replacement_or_new_role)],
    ['Replacement Comments', v(j.replacement_comments)],
    ['Total Years of Experience', v(j.total_years_of_experience)],
    ['Relevant Years of Experience', v(j.relevant_years_of_experience)],
    ['Project Name', v(j.project_name)],
    ['Project Duration', v(j.project_duration)],
    ['Employment Type', v(j.employment_type)],
    ['Existing Resource Allocation Possible', j.existing_resource_allocation ? 'Yes' : 'No'],
    ['Existing Resource Info', v(j.existing_resource_information)],
    ['Roles & Responsibilities', otherFmt(j.roles_responsibilities, j.roles_responsibilities_other)],
    ['Mandatory Skills', otherFmt(j.mandatory_skills, j.mandatory_skills_other)],
    ['Good to Have Skills', otherFmt(j.good_to_have_skills, j.good_to_have_skills_other)],
    ['1st Technical Round', v(j.first_technical_round)],
    ['2nd Technical Round', v(j.second_technical_round)],
    ['CEO / Management Round', v(j.ceo_management_round)],
    ['CEO Panel Details', v(j.ceo_panel_details)],
    ['HR Round', v(j.hr_round)],
    ['Client Round', v(j.client_round)],
    ['Client Round Coordinator', v(j.client_round_coordinator)],
    ['Job Timing', v(j.job_timing)],
    ['Daily Interview Slot (Round 1)', v(j.first_round_interview_slot)],
    ['Daily Interview Slot (Round 2)', v(j.second_round_interview_slot)],
    ['Weekly Meeting Slot', v(j.weekly_meeting_slot)],
    ['Client Details', v(j.client_details)],
    ['Additional Information', v(j.additional_information)],
    ['Competencies Required', v(j.competencies_required)],
    ['Question Paper Link', link(testPaperLink, 'Click here to view Test Paper')],
    ['Question Paper New Owner', v(j.question_paper_new_owner)],
    ['JD Document Link', link(jdLink, 'Click here to view JD')],
  ];
  const ai = [
    ['AI Experience Range', aiExperienceRange || 'Not Available'],
    ['AI Mandatory Skills (from JD)', v(parsedJd?.mandatory_skills) || 'Not Available'],
    ['AI Good to Have Skills (from JD)', v(parsedJd?.good_to_have_skills) || 'Not Available'],
    ['AI Education (from JD)', v(parsedJd?.education) || 'Not Available'],
    ['AI Roles & Responsibilities (from JD)', v(parsedJd?.roles_and_responsibilities) || 'Not Available'],
  ];
  const tr = ([label, value], i) => `<tr${i % 2 ? ` style="background:${ZEBRA}"` : ''}>`
    + `<td style="${LABEL_CELL}">${label}:</td><td style="${VALUE_CELL}">${value === '' ? EMPTY_VALUE : value}</td></tr>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;width:100%;border:1px solid ${LINE};border-radius:8px;color:${TEXT}">`
    + `<thead><tr><th style="${HEAD_CELL};border-top-left-radius:8px">Field Name</th><th style="${HEAD_CELL};border-top-right-radius:8px">User Submitted Data</th></tr></thead>`
    + `<tbody>${rows.map(tr).join('')}`
    + `<tr><td style="${BAND_CELL}" colspan="2">AI-Parsed JD Summary</td></tr>`
    + `${ai.map(tr).join('')}</tbody></table>`;
}

const TABLE_FIELDS = ['hiring_manager_name', 'position_hiring_for', 'mandatory_skills', 'parsed_jd_json', 'jd_document_link', 'question_paper'];

/**
 * The details table for an MRF, built from the record at send time so an MRF
 * submitted before a design change still gets the current table. Falls back to
 * the table stored at submission (rpa_mrf.emailbody) when the record was loaded
 * without the form fields.
 * @param {object} mrfRecord - an rpa_mrf row
 * @param {(d: Date) => string} fmtDate - the same formatter the submission used
 * @returns {string}
 */
export function mrfDetailsTableFor(mrfRecord, fmtDate) {
  const rec = mrfRecord || {};
  if (!TABLE_FIELDS.every((k) => Object.prototype.hasOwnProperty.call(rec, k))) return rec.emailbody || '';
  try {
    return buildMrfDetailsTable(
      { ...rec, date_of_request: rec.date_of_request ? fmtDate(rec.date_of_request) : '' },
      rec.jd_document_link || null,
      rec.question_paper || null,
      rec.parsed_jd_json || null,
    );
  } catch {
    return rec.emailbody || '';
  }
}

/**
 * Restyle a details table stored BEFORE L15 (black 1px borders, Calibri, grey
 * header) so an approval email re-sent after a hold, or an outcome email, still
 * matches the branded shell. Only style values change; the content is
 * untouched. Idempotent, and a no-op on a table built by buildMrfDetailsTable.
 * @param {string} html
 */
export function brandLegacyMrfTable(html) {
  return String(html || '')
    .replace(/border:\s*1px solid black/gi, `border: 1px solid ${LINE}`)
    .replace(/background-color:\s*#f2f2f2/gi, `background-color: ${TINT}`)
    .replace(/font-family:\s*Calibri,\s*sans-serif;\s*/gi, '');
}

/** "Requisition details" heading + the (restyled) table, or nothing. */
function detailsSection(tableBody) {
  const table = brandLegacyMrfTable(tableBody).trim();
  if (!table) return '';
  return `<p style="margin:24px 0 8px 0;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${MUTED}">Requisition details</p>${table}`;
}

// ── Approval request pieces ────────────────────────────────────────────

const DECISION_BUTTONS = Object.freeze([
  ['approveLink', 'Approve', BUTTON_COLOURS.primary],
  ['rejectLink', 'Reject', BUTTON_COLOURS.danger],
  ['holdLink', 'Hold', BUTTON_COLOURS.hold],
]);

/**
 * Approve / Reject / Hold as one row of equal, compact buttons. Table-based:
 * the coloured cell carries the height (Outlook desktop ignores padding on a
 * link), and the row is capped at 384 px but shrinks on a phone.
 * @param {{approveLink: string, rejectLink: string, holdLink?: string|null}} links
 */
export function decisionButtons(links) {
  const cells = DECISION_BUTTONS.filter(([key]) => links[key]).map(([key, label, bg]) => (
    `<td width="33%" style="padding:0 4px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`
    + `<td bgcolor="${bg}" height="40" align="center" valign="middle" style="background:${bg};border-radius:6px">`
    + `<a href="${escapeHtml(links[key])}" target="_blank" style="display:block;padding:10px 4px;font-size:14px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;text-align:center;border-radius:6px;mso-line-height-rule:exactly">${label}</a>`
    + `</td></tr></table></td>`
  ));
  return `<table role="presentation" align="center" width="384" cellpadding="0" cellspacing="0" style="width:100%;max-width:384px;margin:18px auto 0 auto"><tr>${cells.join('')}</tr></table>`;
}

/**
 * The small grey note under the buttons (who else was asked, do not forward).
 * `html` is trusted, caller-built markup.
 * @param {string} html
 */
export function approvalNote(html) {
  return `<p style="margin:10px auto 0 auto;max-width:440px;font-size:12px;line-height:1.6;color:${MUTED};text-align:center">${html}</p>`;
}

/**
 * The editable intro, with its spacing tightened: empty paragraphs (the
 * editor's blank lines) are dropped, a double line break becomes a paragraph
 * break, and every paragraph gets the same small gap. The wording is untouched.
 * @param {string} html - trusted (Email Templates)
 */
export function tightenIntro(html) {
  const body = String(html || '')
    .replace(/<p[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
    .replace(/(?:<br\s*\/?>\s*){2,}/gi, '</p><p>')
    .trim();
  const wrapped = /^<p[\s>]/i.test(body) ? body : `<p>${body}</p>`;
  return wrapped.replace(/<p(?:\s[^>]*)?>/gi, '<p style="margin:0 0 10px 0">');
}

// ── The emails ─────────────────────────────────────────────────────────

/**
 * "New MRF Request" to the hiring manager: review the JD, then fill the MRF.
 * @param {object} p
 * @param {string} p.firstName
 * @param {string} p.introHtml - the recruiter's own intro (trusted: typed by
 *   staff in the New MRF Request card), or the built-in default
 * @param {string|null} p.jdLink
 * @param {string} p.mrfFormUrl
 */
export function buildMrfRequestBody({ firstName, introHtml, jdLink, mrfFormUrl }) {
  const jdCard = jdLink
    ? stepCard(
      'Step 1 · Review the JD',
      'We are sharing the existing Job Description for your reference. Please review it and let us know if any changes are needed. <strong>Upload the updated or final JD in the MRF (Step 2).</strong>',
      emailButton(jdLink, 'View Job Description', 'outline'),
    )
    : '';
  const mrfCard = stepCard(
    jdLink ? 'Step 2 · Fill the MRF and upload the JD' : 'Fill the MRF and upload the JD',
    'Please open and complete the Manpower Requisition Form. <strong>Upload the actual Job Description</strong> in the form before you submit it.',
    emailButton(mrfFormUrl, 'Open MRF'),
  );
  return `<p>Dear <strong>${escapeHtml(firstName || 'Hiring Manager')}</strong>,</p>
<div>${introHtml}</div>
<div style="height:8px;line-height:8px">&nbsp;</div>
${jdCard}${mrfCard}
${emailCallout('Once the form is submitted and approved, we will create and publish the job opening. Please reach out if you need any help completing the form.')}`;
}

/**
 * The approval request to an approver (personal links) or to the leaders
 * (the shared-link flow).
 * @param {object} p
 * @param {string} p.greeting - already escaped by the caller
 * @param {string} p.introText - the editable "MRF Approval Request" intro (trusted)
 * @param {string} p.approveLink
 * @param {string} p.rejectLink
 * @param {string|null} [p.holdLink]
 * @param {string} [p.bannerHtml] - trusted, caller-built (back-from-hold notice)
 * @param {string} [p.noteHtml] - trusted, caller-built (personal-link note)
 * @param {string} p.tableBody - rpa_mrf.emailbody
 */
export function buildMrfApprovalRequestBody({
  greeting, introText, approveLink, rejectLink, holdLink = null, bannerHtml = '', noteHtml = '', tableBody,
}) {
  const buttons = decisionButtons({ approveLink, rejectLink, holdLink });
  const details = detailsSection(tableBody);
  // The same buttons again after the long table, so nobody scrolls back up.
  const again = details ? buttons : '';
  return `${bannerHtml}<p style="margin:0 0 12px 0"><strong>${greeting}</strong></p>
<div style="font-size:14px;line-height:1.65;color:${TEXT}">${tightenIntro(introText)}</div>
${buttons}
${noteHtml}
${details}
${again}`;
}

/**
 * The two post-decision notices: "already decided by someone else" and "your
 * decision was recorded".
 * @param {object} p
 * @param {string} p.greeting - already escaped
 * @param {string} p.lead - trusted, caller-built
 * @param {{word: string, byName: string, atIst: string, untilLabel?: string, comments?: string}} p.decision
 * @param {string} p.closing - trusted, caller-built
 */
export function buildMrfDecisionNoticeBody({ greeting, lead, decision, closing }) {
  const row = (label, valueHtml) => `<tr><td style="padding:6px 16px 6px 0;color:${MUTED};white-space:nowrap">${label}</td><td style="padding:6px 0">${valueHtml}</td></tr>`;
  const comment = decision.comments
    ? `<p><strong>Comment:</strong> ${escapeHtml(decision.comments)}</p>`
    : '';
  return `<p>${greeting}</p>
<p>${lead}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0;font-size:14px">
${row('Decision', `<strong>${escapeHtml(String(decision.word || '').toUpperCase())}</strong>`)}
${row('By', escapeHtml(decision.byName))}
${row('When', escapeHtml(decision.atIst))}
${decision.untilLabel ? row('On hold until', `<strong>${escapeHtml(decision.untilLabel)}</strong>`) : ''}
</table>
${comment}
<p>${closing}</p>`;
}

/** The HR team's copy of a new submission. */
export function buildMrfSubmissionHrBody({ tableBody }) {
  return `<p>Hi Team,</p>
<p>A new MRF has been submitted. The details are below. (This is an automated email.)</p>
${detailsSection(tableBody)}`;
}

/**
 * The approved / declined notice to HR (and, in production, the HM and
 * approvers). Signed by the CEO, as it always was, so the shell adds no second
 * sign-off.
 *
 * Keeps the exact "<strong>Comment from Management:</strong> … </p>" markup:
 * the audit backfill (DDL 2026-09-25-mrf-approval-audit.sql) reads comments
 * out of logged outcome emails with that pattern.
 *
 * @param {object} p
 * @param {boolean} p.approved
 * @param {string|null} [p.comments] - typed on a PUBLIC page; escaped here
 * @param {{name: string, atIst: string}|null} [p.decidedBy]
 * @param {string} p.tableBody
 */
export function buildMrfOutcomeBody({ approved, comments = null, decidedBy = null, tableBody }) {
  const statusText = approved ? 'Approved' : 'Declined';
  const decidedBySection = decidedBy
    ? `<p><strong>${statusText} by:</strong> ${escapeHtml(decidedBy.name)} on ${escapeHtml(decidedBy.atIst)}</p>`
    : '';
  const commentSection = comments
    ? `<p><strong>Comment from Management:</strong> ${escapeHtml(comments)}</p>`
    : '';
  const [lead, next, thanks] = approved
    ? [
      'This is to formally inform you that Management has <strong>approved</strong> the request to proceed with the recruitment of additional manpower.',
      'Please initiate the recruitment process as per company policies and the approved MRF details.',
      'Thank you for your continued support, and we look forward to timely updates on the progress.',
    ]
    : [
      'This is to formally inform you that Management has reviewed the request for additional manpower and has <strong>decided not to proceed</strong> with it at this time.',
      'Accordingly, please place the recruitment activity on hold until further instructions.',
      'Thank you for your understanding.',
    ];
  return `<p>Hi Team,</p>
<p>${lead}</p>
${decidedBySection}
${commentSection}
<p>${next}</p>
${detailsSection(tableBody)}
<p style="margin-top:22px">${thanks}</p>
<p>Best regards,<br>CEO, AAPNA</p>`;
}
