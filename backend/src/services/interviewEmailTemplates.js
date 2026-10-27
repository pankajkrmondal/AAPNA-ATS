/**
 * Editable defaults for the two L14 interview emails:
 *   - "Interview Feedback Received": to the recruitment mailbox when an
 *     interviewer submits a scorecard (flow key `scorecardSubmitted`);
 *   - "Candidate Pack for Interview Panel": the "Send JD, CV and report so far
 *     to the panel" action on an already-booked round.
 *
 * Same arrangement as mrfHoldEmailTemplates.js: these objects are both the seed
 * source (prisma/seed-interview-email-templates.js) and the code fallback when
 * a row is missing or inactive, so the two cannot drift apart. Bodies are
 * fragments; wrapBrandedEmail() adds the branded header, sign-off and footer.
 *
 * `earlier_rounds_block` is an HTML fragment the service builds (the rounds so
 * far and what is attached). It is always present, so it is a normal required
 * placeholder.
 *
 * No imports on purpose: the seed script loads this file without the app.
 */

export const INTERVIEW_EMAIL_TEMPLATE_NAMES = Object.freeze({
  feedbackReceived: 'Interview Feedback Received',
  panelPack: 'Candidate Pack for Interview Panel',
});

export const INTERVIEW_EMAIL_TEMPLATE_DEFAULTS = Object.freeze({
  [INTERVIEW_EMAIL_TEMPLATE_NAMES.feedbackReceived]: {
    subject: 'Feedback received: {{candidate_name}} · {{stage_label}}',
    body_html: `<p>Hi Team,</p>
<p><strong>{{interviewer}}</strong> has submitted the <strong>{{stage_label}}</strong> scorecard for <strong>{{candidate_name}}</strong> ({{position}}).</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">
  <tr><td style="color:#666">Recommendation</td><td><strong>{{recommendation}}</strong></td></tr>
  <tr><td style="color:#666">Average score</td><td>{{avg_score}}</td></tr>
  <tr><td style="color:#666">Submitted</td><td>{{submitted_at}}</td></tr>
  <tr><td style="color:#666">Comments</td><td>{{comments}}</td></tr>
</table>
<p>The round is ready for your decision in the Candidate Pipeline.</p>
<p style="margin:16px 0;"><a href="{{candidate_link}}" style="background:#7a922e;color:#ffffff;padding:11px 22px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">Open in the ATS</a></p>`,
    placeholders: ['candidate_name', 'stage_label', 'interviewer', 'position', 'recommendation', 'avg_score', 'submitted_at', 'comments', 'candidate_link'],
  },

  [INTERVIEW_EMAIL_TEMPLATE_NAMES.panelPack]: {
    subject: 'Candidate pack: {{candidate_name}} · {{stage_label}}',
    body_html: `<p>Hi {{interviewer_name}},</p>
<p>Ahead of your <strong>{{stage_label}}</strong> interview with <strong>{{candidate_name}}</strong> ({{position}}) on {{interview_when}}, here is what the candidate has done so far.</p>
{{earlier_rounds_block}}
<p style="font-size:13px;color:#6b7280;">Please keep these files confidential and delete them after the interview.</p>`,
    placeholders: ['interviewer_name', 'stage_label', 'candidate_name', 'position', 'interview_when', 'earlier_rounds_block'],
  },
});
