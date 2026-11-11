/**
 * U08: the built-in "Zeko Interview Reminder" email. Seeded create-only into
 * rpa_email_templates by prisma/seed-zeko-reminder-template.js, so HR can edit
 * it on the Email Templates page; jobs/zekoExpiryReminder.js sends this default
 * while no active row exists.
 *
 * A body fragment, like the Zeko invitation: the sender wraps it in the AAPNA
 * shell (wrapBrandedEmail).
 */
export const ZEKO_REMINDER_TEMPLATE_NAME = 'Zeko Interview Reminder';

export const ZEKO_REMINDER_TEMPLATE_DEFAULT = Object.freeze({
  name: ZEKO_REMINDER_TEMPLATE_NAME,
  category: 'interview',
  subject: 'Reminder: your AI interview closes soon — {{job_title}}',
  body_html: `<p>Dear <strong>{{candidate_name}}</strong>,</p>
<p>This is a reminder that your AI-powered video interview for the position of <strong>{{job_title}}</strong> is still waiting for you.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:#f6f9eb;border-left:4px solid #7a922e;border-radius:8px;">
  <tr><td style="padding:16px 18px;">
  <p style="margin:0;font-size:14px;color:#374151;"><strong>The interview link closes on:</strong> {{interview_end}}</p>
  </td></tr>
</table>
<p>Please complete it before then using the link below:</p>
<p style="margin:16px 0;"><a href="{{interview_link}}" target="_blank" style="background:#7a922e;color:#ffffff;padding:13px 28px;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;display:inline-block;">Start my interview</a></p>
<p style="font-size:13px;color:#6b7280;word-break:break-all;">Or copy this link: <a href="{{interview_link}}" style="color:#5a6e1f;">{{interview_link}}</a></p>
<p style="font-size:13px;color:#6b7280;">If you have already completed it, please ignore this email. For any questions, reply to this email and our HR team will help.</p>`,
  placeholders: Object.freeze(['candidate_name', 'job_title', 'interview_end', 'interview_link']),
});

export default ZEKO_REMINDER_TEMPLATE_DEFAULT;
