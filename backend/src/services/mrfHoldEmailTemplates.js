/**
 * Editable defaults for the MRF Hold & Delegate notices (plan §6.7).
 *
 * These rows live in rpa_email_templates (category 'general', so they appear
 * under Email Templates › General / Alerts next to "MRF Approval Request") and
 * are resolved BY NAME at send time. The objects below are both:
 *   - the seed source (prisma/seed-mrf-hold-email-templates.js), and
 *   - the code fallback when a row is missing or inactive,
 * so the two can never drift apart.
 *
 * Bodies are fragments: emailLayout.service.js wrapBrandedEmail() adds the
 * branded header (the subject is the headline), the sign-off and the footer,
 * exactly as the Email Templates editor shows them.
 *
 * Tokens ending in `_line` / `_row` are HTML fragments the service builds and
 * that are empty when not applicable (no note, no comment, …). They are listed
 * in OPTIONAL_PLACEHOLDERS (emailTemplate.controller.js and EmailManagement.jsx)
 * so HR may delete them from a body. Every other token is required on save.
 *
 * No imports on purpose: the seed script loads this file without the app.
 */

export const MRF_HOLD_TEMPLATE_NAMES = Object.freeze({
  holdNotice: 'MRF On Hold Notice',
  holdDateChanged: 'MRF Hold Date Changed',
  delegateDecision: 'MRF Decided On Your Behalf',
  approversAway: 'MRF Approvers Away Notice',
});

export const MRF_HOLD_TEMPLATE_DEFAULTS = Object.freeze({
  // To HR + hiring manager + the approvers who did not hold it (plan D4).
  [MRF_HOLD_TEMPLATE_NAMES.holdNotice]: {
    subject: '{{mrf_label}} – on hold until {{hold_until}}',
    body_html: `<p>Hi Team,</p>
<p><strong>{{mrf_label}}</strong> has been <strong>put on hold</strong> until <strong>{{hold_until}}</strong> by {{held_by}} on {{held_at}}.</p>
{{note_line}}
<p>Until then the requisition is not open: it does not appear in JD screening, the pipeline or vendor uploads. On {{hold_until}} it goes back to pending and the approval request is emailed to the approvers again.</p>`,
    placeholders: ['mrf_label', 'hold_until', 'held_by', 'held_at', 'note_line'],
  },

  // Same recipients, when the hold-until date is moved in the ATS.
  [MRF_HOLD_TEMPLATE_NAMES.holdDateChanged]: {
    subject: '{{mrf_label}} – hold date changed to {{hold_until}}',
    body_html: `<p>Hi Team,</p>
<p>The hold on <strong>{{mrf_label}}</strong> now ends on <strong>{{hold_until}}</strong>{{previous_until_line}}. Changed by {{changed_by}} on {{changed_at}}.</p>
{{note_line}}
<p>On {{hold_until}} the requisition goes back to pending and the approval request is emailed to the approvers again.</p>`,
    placeholders: ['mrf_label', 'hold_until', 'changed_by', 'changed_at', 'previous_until_line', 'note_line'],
  },

  // To each roster approver after an HR Admin Recruiter / Admin decided in the ATS.
  [MRF_HOLD_TEMPLATE_NAMES.delegateDecision]: {
    subject: '{{mrf_label}} – {{decision}} on your behalf by {{decided_by}}',
    body_html: `<p>Dear {{approver_name}},</p>
<p><strong>{{decided_by}}</strong> ({{decided_by_role}}) has <strong>{{decision}}</strong> the requisition <strong>{{mrf_label}}</strong> on your behalf{{absence_line}}.</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">
  <tr><td style="color:#666">Decision</td><td><strong>{{decision_upper}}</strong></td></tr>
  <tr><td style="color:#666">By</td><td>{{decided_by}}</td></tr>
  <tr><td style="color:#666">When</td><td>{{decided_at}}</td></tr>
  {{hold_until_row}}
</table>
{{comment_line}}
<p>No action is needed from you; your approval link for this request is now closed. If this decision is wrong, please contact the HR team. The full approval trail is on the MRF page in the ATS.</p>`,
    placeholders: [
      'approver_name', 'mrf_label', 'decision', 'decision_upper', 'decided_by', 'decided_by_role', 'decided_at',
      'absence_line', 'hold_until_row', 'comment_line',
    ],
  },

  // To the approvers and HR Admin Recruiters when an absence window is switched on.
  [MRF_HOLD_TEMPLATE_NAMES.approversAway]: {
    subject: 'MRF approvals: approvers marked away {{absence_from}} – {{absence_to}}',
    body_html: `<p>Hi,</p>
<p>The MRF approvers are marked <strong>away from {{absence_from}} to {{absence_to}}</strong>{{absence_note_line}}. Set by {{set_by}}.</p>
<p>During these dates {{on_behalf_names}} can approve, reject or hold MRFs from the ATS on the approvers' behalf. Every such decision is recorded in the approval trail and emailed to the approvers straight away.</p>`,
    placeholders: ['absence_from', 'absence_to', 'set_by', 'on_behalf_names', 'absence_note_line'],
  },
});

/** Fragment tokens HR may remove from a body (merged into OPTIONAL_PLACEHOLDERS). */
export const MRF_HOLD_OPTIONAL_PLACEHOLDERS = Object.freeze([
  'note_line', 'previous_until_line', 'absence_line', 'hold_until_row', 'comment_line', 'absence_note_line',
]);
