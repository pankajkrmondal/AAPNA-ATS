import prisma from '../config/database.js';
import config from '../config/index.js';
import { resolveRecipients, loadEmailRecipients } from '../config/emailRecipients.js';
import { compileTemplate } from '../services/emailNotification.service.js';

// Replicate sendMissingDataEmail + sendWelcomeEmail step-by-step for a real
// candidate, but DO NOT actually send email — find which step throws.
async function trySend(label, candidate, templateName, buildReplacements, flowKey) {
  console.log(`\n##### ${label} for cand id=${candidate.id} #####`);
  try {
    const sender = config.microsoft.defaultSender;
    console.log('  sender:', sender);

    const { to: toEmail } = resolveRecipients(flowKey, candidate.EmailID);
    console.log('  resolved toEmail:', JSON.stringify(toEmail));
    if (!toEmail) { console.log('  -> would SKIP (no recipient)'); return; }

    const template = await prisma.rpa_email_templates.findFirst({
      where: { name: templateName, is_active: true }
    });
    console.log('  template found?', !!template, template ? `(id=${template.id})` : '');
    if (!template) { console.log('  -> would THROW: template not found'); return; }

    const { subject, html } = compileTemplate(template.subject, template.body_html, buildReplacements());
    console.log('  compiled subject:', subject?.slice(0, 60));
    console.log('  html length:', html?.length);

    // (skip sendGraphEmail)
    // simulate the rpa_email_log.create payload validation
    const logPayload = {
      email_type: flowKey === 'missingData' ? 'data_collection' : 'welcome',
      recipient_email: toEmail,
      recipient_name: candidate.Name || 'Candidate',
      subject,
      body_html: html,
      reference_id: candidate.id ? Number(candidate.id) : null,
      sent_at: new Date()
    };
    console.log('  log payload OK. recipient_email length:', String(toEmail).length);
    console.log('  -> all steps before Graph send PASSED');
  } catch (err) {
    console.log('  !!! THROWS:', err.message);
  }
}

async function main() {
  try {
    await loadEmailRecipients();
    console.log('config.email.redirectInNonProd :', config.email.redirectInNonProd);
    console.log('config.email.testRecipients    :', JSON.stringify(config.email.testRecipients));
    console.log('config.cors.frontendUrl        :', config.cors.frontendUrl);
    console.log('config.microsoft.defaultSender :', config.microsoft.defaultSender);

    const cand = await prisma.rpa_cv.findUnique({ where: { id: 209n } });
    const c = { id: Number(cand.id), Name: cand.Name, EmailID: cand.EmailID };

    await trySend('WELCOME', c, 'Welcome Candidate Email', () => ({ candidate_name: c.Name || 'Candidate' }), 'welcome');

    const token = Buffer.from(c.EmailID || '').toString('base64');
    const weblink = `${config.cors.frontendUrl}/missing-jd-upload?token=${token}`;
    await trySend('MISSING DATA', c, 'Missing Profile Data Collection',
      () => ({ candidate_name: c.Name || 'Candidate', upload_link: weblink }), 'missingData');
  } catch (err) {
    console.error('DIAG ERROR:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
