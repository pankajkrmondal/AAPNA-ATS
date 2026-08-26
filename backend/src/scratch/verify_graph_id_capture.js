/**
 * Verification for the Outlook quick-win changes:
 *  1. sendGraphEmail returns real Graph ids (draft → send path).
 *  2. logFailedEmail persists a status='failed' row in rpa_email_log.
 *  3. The reminder scheduler query works with the new status column.
 *
 * Run from backend/:  node src/scratch/verify_graph_id_capture.js
 * Uses the current NODE_ENV (.env) — in dev/staging all mail is redirected to
 * the internal test inbox, so no candidate is ever emailed.
 */
import prisma from '../config/database.js';
import config from '../config/index.js';
import { sendGraphEmail, logFailedEmail } from '../services/emailNotification.service.js';

const results = [];

// 1) Real send via the shared mailbox (redirected to test inbox in non-prod).
try {
  const sendResult = await sendGraphEmail({
    sender: config.microsoft.defaultSender,
    to: config.email.testRecipients,
    subject: `[ATS verification] Graph id capture test ${new Date().toISOString()}`,
    html: '<p>Automated verification of the new draft→send Graph id capture. Safe to ignore/delete.</p>',
  });
  const captured = Boolean(sendResult?.conversationId && sendResult?.graphMessageId);
  results.push(`1. send: OK — ids ${captured ? 'CAPTURED' : 'NOT captured (legacy sendMail fallback used — check Mail.ReadWrite permission)'}`);
  console.log('   sendResult:', JSON.stringify(sendResult, null, 2));
} catch (err) {
  results.push(`1. send: FAILED — ${err.message}`);
}

// 2) Failed-send persistence.
try {
  await logFailedEmail({
    emailType: 'verification_test',
    recipientEmail: 'verify@example.invalid',
    recipientName: 'Verification',
    subject: 'verification row',
    err: new Error('synthetic failure for verification'),
  });
  const row = await prisma.rpa_email_log.findFirst({
    where: { email_type: 'verification_test' },
    orderBy: { id: 'desc' },
  });
  if (row && row.status === 'failed' && row.error_message) {
    results.push(`2. failed-send log: OK — row ${row.id} status='${row.status}', error='${row.error_message}'`);
    await prisma.rpa_email_log.delete({ where: { id: row.id } }); // clean up test row
  } else {
    results.push(`2. failed-send log: FAILED — row not found or wrong shape: ${JSON.stringify(row)}`);
  }
} catch (err) {
  results.push(`2. failed-send log: FAILED — ${err.message}`);
}

// 3) Reminder query with the status guard (same SQL as reminderScheduler.js).
try {
  const pending = await prisma.$queryRawUnsafe(
    `SELECT el.id FROM rpa_email_log el
     WHERE el.responded_at IS NULL AND el.status = 'sent' AND el.reminder_count < $1
       AND (
         (el.last_reminder_at IS NULL AND el.sent_at <= NOW() - ($2 || ' days')::interval)
         OR (el.last_reminder_at IS NOT NULL AND el.last_reminder_at <= NOW() - ($2 || ' days')::interval)
       ) LIMIT 5;`,
    3,
    2
  );
  results.push(`3. reminder query with status guard: OK — ${pending.length} sample row(s) matched`);
} catch (err) {
  results.push(`3. reminder query with status guard: FAILED — ${err.message}`);
}

console.log('\n=== VERIFICATION RESULTS ===');
for (const r of results) console.log(r);
await prisma.$disconnect();
