/**
 * Idempotent seed for the branded candidate-facing email templates.
 *
 * Upserts three templates in rpa_email_templates:
 *   - Shortlist Notification   (category 'shortlist')   — branded "You're Shortlisted" email.
 *   - Rejection — Post Interview (category 'rejection')  — branded "Application Update" email.
 *   - Application On Hold       (category 'general', by name) — branded "On Hold" email.
 *
 * Supersedes seed-onhold-template.js. Safe to run multiple times.
 *
 *   node prisma/seed-email-templates.js
 *
 * Notes:
 *  - The shortlist body uses {candidate_name} and {role_paragraph}; the service
 *    (shortlistCandidates) injects the JD vs keyword intro paragraph at send time.
 *  - Status templates use {candidate_name} and {position}.
 *  - No personal recruiter name appears — all sign off as "AAPNA Recruitment Team".
 */
import prisma from '../src/config/database.js';

const SHORTLIST_SUBJECT = "You're Shortlisted -- Complete Your HR AI Interview | AAPNA Infotech";

const SHORTLIST_BODY = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AAPNA Recruitment</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 10px;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08);">
<tr><td style="background:#7a922e;padding:32px 40px;text-align:center;">
<img src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png" width="190" style="display:block;margin:0 auto 16px auto;">
<h1 style="margin:0;font-size:24px;color:#ffffff;font-weight:800;">Your Application Has Been Shortlisted 🎉</h1>
<p style="margin:6px 0 0 0;color:#e7f0c5;font-size:13px;">Where Culture, Code, and Courage Come Together</p>
</td></tr>
<tr><td style="padding:32px 40px 16px 40px;font-size:15px;color:#374151;line-height:1.7;">
<p style="margin:0 0 14px 0;">Dear <strong>{candidate_name}</strong>,</p>
<p style="margin:0 0 14px 0;">Greetings from <strong>AAPNA Infotech</strong>.</p>
{role_paragraph}
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e7eb;"></td></tr>
<tr><td style="padding:24px 40px;font-size:14px;color:#374151;line-height:1.7;">
<p>As the next step, you are required to complete an <strong>HR AI Interview through the Zeko HR platform</strong>. The interview link will be shared with you shortly in a separate email.</p>
<h3 style="margin-top:18px;color:#7a922e;">Important Instructions</h3>
<ul style="padding-left:18px;margin:10px 0;">
<li style="margin-bottom:6px;">Ensure you have a <strong>stable internet connection</strong>.</li>
<li style="margin-bottom:6px;">Use a <strong>laptop or desktop with webcam</strong>.</li>
<li style="margin-bottom:6px;">Fill all required details carefully.</li>
<li style="margin-bottom:6px;">Attend the interview <strong>without external help or AI tools</strong>.</li>
<li style="margin-bottom:6px;">Complete the interview <strong>in one sitting</strong>.</li>
<li style="margin-bottom:6px;">Finish within <strong>24–48 hours</strong>.</li>
</ul>
</td></tr>
<tr><td style="padding:0 40px 28px 40px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f9eb;border-left:4px solid #7a922e;border-radius:8px;">
<tr><td style="padding:20px;font-size:14px;color:#374151;line-height:1.6;">
<strong style="color:#5a6e1f;font-size:15px;">Interview Process at AAPNA Infotech</strong>
<ol style="margin:12px 0 0 18px;">
<li>HR AI Interview (Zeko HR platform)</li>
<li>Evalground Technical Assessment</li>
<li>Zeko Functional / Coding Assessment</li>
<li>Technical Interview – Round 1</li>
<li>Technical Interview – Round 2</li>
<li>Final Discussion with HR / Leadership</li>
<li>Client Interview (if applicable)</li>
</ol>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 40px 30px 40px;text-align:center;">
<p style="font-size:14px;color:#374151;margin-bottom:14px;">Before proceeding, please review our website.</p>
<a href="https://www.aapnainfotech.com/" style="display:inline-block;padding:12px 28px;background:#7a922e;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;">Explore AAPNA Infotech</a>
</td></tr>
<tr><td style="padding:0 40px 32px 40px;font-size:14px;color:#6b7280;line-height:1.6;">
<p style="margin:0 0 4px 0;">Best regards,</p>
<p style="margin:0;font-weight:700;color:#111827;">AAPNA Recruitment Team</p>
<p style="margin:2px 0 0 0;color:#7a922e;font-weight:700;">AAPNA Infotech</p>
</td></tr>
<tr><td style="background:#f3f4f6;padding:16px;text-align:center;font-size:12px;color:#9ca3af;">
This email was sent because your profile was submitted to AAPNA Infotech's recruitment system.<br>
© 2026 AAPNA Infotech. All rights reserved.
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;

/** Branded wrapper for screening status updates (rejected / on hold). */
function statusBody(statusLabel, bodyParagraphs) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 10px"><tr><td align="center"><table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08)"><tr><td style="background:#7a922e;padding:32px 40px;text-align:center"><img src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png" width="190" style="display:block;margin:0 auto 16px auto"><h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:800">${statusLabel}</h1><p style="margin:6px 0 0 0;color:#e7f0c5;font-size:13px">AAPNA Infotech - Recruitment Update</p></td></tr><tr><td style="padding:32px 40px 8px 40px;font-size:15px;color:#374151;line-height:1.8"><p>Dear <strong>{candidate_name}</strong>,</p><p>Greetings from <strong>AAPNA Infotech</strong>.</p>${bodyParagraphs}</td></tr><tr><td style="padding:0 40px 32px 40px;font-size:14px;color:#6b7280;line-height:1.6"><p style="margin:0 0 4px 0">Best regards,</p><p style="margin:0;font-weight:700;color:#111827">AAPNA Recruitment Team</p><p style="margin:2px 0 0 0;color:#7a922e;font-weight:700">AAPNA Infotech</p></td></tr><tr><td style="background:#f3f4f6;padding:16px;text-align:center;font-size:12px;color:#9ca3af">This email was sent by AAPNA Infotech's recruitment system.<br>© 2026 AAPNA Infotech. All rights reserved.</td></tr></table></td></tr></table></body></html>`;
}

const REJECTED_PARAS = `<p>After careful consideration of your profile, we regret to inform you that we are unable to move forward with your application for <strong>{position}</strong> at this time.</p><p>We truly appreciate the time and effort you invested in our process. We will keep your profile on file and encourage you to apply for future opportunities.</p><p>We wish you all the best in your career journey.</p>`;

const ONHOLD_PARAS = `<p>Thank you for your continued interest in the <strong>{position}</strong> position at AAPNA Infotech.</p><p>Your application is currently on hold while we complete our initial screening. We will reach out with an update as soon as possible.</p><p>We appreciate your patience.</p>`;

const TEMPLATES = [
  {
    find: { category: 'shortlist' },
    data: {
      name: 'Shortlist Notification',
      category: 'shortlist',
      subject: SHORTLIST_SUBJECT,
      body_html: SHORTLIST_BODY,
      placeholders: ['{candidate_name}', '{role_paragraph}'],
      is_active: true,
    },
  },
  {
    find: { category: 'rejection' },
    data: {
      name: 'Rejection — Post Interview',
      category: 'rejection',
      subject: 'Update on Your Application - AAPNA Infotech',
      body_html: statusBody('Application Update', REJECTED_PARAS),
      placeholders: ['{candidate_name}', '{position}'],
      is_active: true,
    },
  },
  {
    find: { name: 'Application On Hold' },
    data: {
      name: 'Application On Hold',
      category: 'general',
      subject: 'Application on Hold - AAPNA Infotech',
      body_html: statusBody('Application on Hold', ONHOLD_PARAS),
      placeholders: ['{candidate_name}', '{position}'],
      is_active: true,
    },
  },
];

async function main() {
  for (const t of TEMPLATES) {
    const existing = await prisma.rpa_email_templates.findFirst({ where: t.find });
    if (existing) {
      await prisma.rpa_email_templates.update({
        where: { id: existing.id },
        data: { ...t.data, modified_at: new Date() },
      });
      console.log(`Updated #${existing.id} "${t.data.name}".`);
    } else {
      const created = await prisma.rpa_email_templates.create({ data: t.data });
      console.log(`Created #${created.id} "${t.data.name}".`);
    }
  }
}

main()
  .catch((e) => {
    console.error('Seed failed:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
