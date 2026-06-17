/**
 * One-off E2E test for the n8n "Microsoft Outlook Trigger2" node, re-implemented
 * as the Node email-resume-intake poller (jobs/emailResumeIntake.js).
 *
 * Flow:
 *   1) Send a CV (Aasul_Patel_Resume.pdf) as a REAL email attachment to the
 *      polled mailbox (MS_DEFAULT_SENDER_EMAIL) via MS Graph sendMail.
 *   2) Poll until the message is visible in the inbox (Graph is eventually consistent).
 *   3) Run runEmailResumeIntake() once — the same function the cron job calls — so
 *      we don't wait for the scheduled cron tick.
 *   4) Print the resulting upload batch + per-file parse status from the DB.
 *
 * This is test scaffolding only; it does not modify any application code.
 * Run:  node src/scratch/test_outlook_intake_e2e.js
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import 'dotenv/config';

// Mirror jobs/emailResumeIntake.js executionIdFor() so we can locate the batch.
const executionIdFor = (graphMessageId) =>
  `email-${crypto.createHash('sha1').update(graphMessageId).digest('hex').slice(0, 16)}`;

// Force the poller on for this run regardless of .env (runEmailResumeIntake itself
// doesn't gate on the flag — only startEmailResumeIntakeJob does — but we set it so
// config reflects an enabled poller for any logging/sanity checks).
process.env.EMAIL_INTAKE_ENABLED = 'true';

const CV_PATH = 'e:/Recruitment Process Automation/CV/NEW CV/Aasul_Patel_Resume.pdf';

const config = (await import('../config/index.js')).default;
const { getAccessToken } = await import('../services/onedrive.service.js');
const { fetchMessagesSince } = await import('../services/outlookReader.service.js');
const { runEmailResumeIntake } = await import('../jobs/emailResumeIntake.js');
const prisma = (await import('../config/database.js')).default;

const MAILBOX = config.microsoft.defaultSender;
const GRAPH = 'https://graph.microsoft.com/v1.0';

function log(...a) { console.log('[E2E]', ...a); }
// rpa_cv has BigInt columns; make them JSON-serializable for the report.
const j = (o) => JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

async function sendCvEmail() {
  if (!fs.existsSync(CV_PATH)) throw new Error(`CV not found at ${CV_PATH}`);
  const contentBytes = fs.readFileSync(CV_PATH).toString('base64');
  const token = await getAccessToken();
  const subject = `E2E TEST – Resume intake – Aasul Patel – ${new Date().toISOString()}`;

  const payload = {
    message: {
      subject,
      body: { contentType: 'Text', content: 'Automated E2E test: please find the attached resume.' },
      toRecipients: [{ emailAddress: { address: MAILBOX } }],
      attachments: [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: 'Aasul_Patel_Resume.pdf',
          contentType: 'application/pdf',
          contentBytes,
        },
      ],
    },
    saveToSentItems: 'true',
  };

  const url = `${GRAPH}/users/${encodeURIComponent(MAILBOX)}/sendMail`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`sendMail failed (${res.status}): ${t}`);
  }
  log(`Sent CV email to ${MAILBOX} with subject: "${subject}"`);
  return subject;
}

async function waitForInbox(subject, sinceIso, { tries = 12, delayMs = 5000 } = {}) {
  for (let i = 1; i <= tries; i++) {
    const msgs = await fetchMessagesSince(sinceIso, { withAttachmentsOnly: true });
    const hit = msgs.find((m) => m.subject === subject);
    if (hit) {
      log(`Message visible in inbox after ${i} check(s): graphMessageId=${hit.graphMessageId}`);
      return hit;
    }
    log(`Inbox not yet showing the message (check ${i}/${tries}); waiting ${delayMs}ms...`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error('Message never appeared in inbox within the wait window.');
}

async function main() {
  log(`Mailbox under test (MS_DEFAULT_SENDER_EMAIL): ${MAILBOX}`);
  log(`config.email.intake.enabled = ${config.email.intake.enabled}`);

  const sinceIso = new Date(Date.now() - 60 * 1000).toISOString(); // look back 1 min

  // 1) Deliver the CV as an attachment.
  const subject = await sendCvEmail();

  // 2) Wait for Graph to surface it in the inbox.
  const msg = await waitForInbox(subject, sinceIso);

  // 3) Rewind the watermark so the poller will look back far enough to see it,
  //    then run one poll cycle (the same function the cron job calls).
  await prisma.rpa_settings.upsert({
    where: { key: 'email_intake_last_sync' },
    update: { value: sinceIso },
    create: { key: 'email_intake_last_sync', value: sinceIso },
  });
  log(`Watermark reset to ${sinceIso}; invoking runEmailResumeIntake() once...`);
  await runEmailResumeIntake();

  // The parse pipeline runs in setImmediate; give it time to complete.
  log('Poll cycle returned. Waiting 20s for background parsing to finish...');
  await new Promise((r) => setTimeout(r, 20000));

  // 4) Report results for this message's batch.
  const expectedExecId = executionIdFor(msg.graphMessageId);
  log(`Expected execution_id for this message: ${expectedExecId}`);
  const batch = await prisma.rpa_upload_batch_summary.findFirst({
    where: { execution_id: expectedExecId },
    orderBy: { uploaded_at: 'desc' },
  });
  if (!batch) {
    log('❌ No upload batch was created for this message. Intake did NOT process it.');
  } else {
    log('✅ Upload batch created:');
    console.log(j(batch));
    const logs = await prisma.rpa_upload_log.findMany({
      where: { execution_id: batch.execution_id },
    });
    log(`Per-file upload logs (${logs.length}):`);
    console.log(j(logs));

    // Show the candidate row if one was created from this CV (table = rpa_cv).
    const cand = await prisma.rpa_cv.findFirst({
      where: { EmailID: { contains: 'aasul' } },
      orderBy: { createdAt: 'desc' },
    }).catch((e) => { log('candidate lookup error:', e.message); return null; });
    if (cand) {
      log('✅ Candidate row found (rpa_cv):');
      console.log(j({
        id: cand.id, Name: cand.Name, EmailID: cand.EmailID,
        ContactNumber: cand.ContactNumber, PositionApplied: cand.PositionApplied,
        Top5KeySkills: cand.Top5KeySkills, cvFileUrl: cand.cvFileUrl, createdAt: cand.createdAt,
      }));
    } else {
      log('⚠️  No rpa_cv row matched EmailID containing "aasul" (check parser output / logs).');
    }
  }

  await prisma.$disconnect();
  log('Done.');
}

main().catch(async (e) => {
  console.error('[E2E] FAILED:', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
