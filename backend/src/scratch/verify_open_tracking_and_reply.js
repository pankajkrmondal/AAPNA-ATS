/**
 * Verification for Phase 2 Outlook changes (open tracking + reply from ATS):
 *  1. Pixel injection: outbound HTML gains the tracking <img> when
 *     PUBLIC_BASE_URL is set; unchanged when token/config missing.
 *  2. End-to-end reply: send a seed email (redirected to the test inbox in
 *     non-prod), store its rpa_email_messages row like the shortlist path does,
 *     then reply to it via replyToOutlookMessage — asserts the reply shares the
 *     seed's conversationId and sets in_reply_to.
 *  3. Open-tracking DB update: simulates two pixel hits with the same SQL the
 *     endpoint runs and checks opened/open_count/first_opened_at semantics.
 *
 * Run from backend/:  node src/scratch/verify_open_tracking_and_reply.js
 * (For the HTTP-level pixel test, see the curl commands in
 *  docs/changelog/CHANGES-outlook-open-tracking-and-reply.md — needs the server running.)
 */
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database.js';
import config from '../config/index.js';
import { sendGraphEmail, injectTrackingPixel } from '../services/emailNotification.service.js';
import { replyToOutlookMessage } from '../services/screening.service.js';

const results = [];
const cleanupMessageIds = [];

// 1) Pixel injection semantics.
{
  const html = '<html><body><p>hello</p></body></html>';
  const token = uuidv4();
  const withPixel = injectTrackingPixel(html, token);
  const okInjected = config.publicBaseUrl
    ? withPixel.includes(`/api/track/open/${token}`) && withPixel.indexOf('</body>') > withPixel.indexOf('<img')
    : withPixel === html;
  const okNoToken = injectTrackingPixel(html, '') === html;
  results.push(`1. pixel injection: ${okInjected && okNoToken ? 'OK' : 'FAILED'} (publicBaseUrl='${config.publicBaseUrl}')`);
}

// 2) E2E reply. Seed a sent message (like shortlist does), then reply to it.
try {
  const subject = `[ATS verification] Reply test ${new Date().toISOString()}`;
  const seedSend = await sendGraphEmail({
    sender: config.microsoft.defaultSender,
    to: config.email.testRecipients,
    subject,
    html: '<p>Seed message for ATS reply verification. Safe to ignore/delete.</p>',
  });
  if (!seedSend?.graphMessageId) throw new Error('Seed send captured no Graph ids — cannot test reply.');

  const seedRow = await prisma.rpa_email_messages.create({
    data: {
      graph_message_id: seedSend.graphMessageId,
      conversation_id: seedSend.conversationId,
      internet_msg_id: seedSend.internetMessageId,
      from_email: config.microsoft.defaultSender,
      to_emails: config.email.testRecipients.split(',').map((e) => e.trim()),
      subject,
      body_html: '<p>seed</p>',
      direction: 'outbound',
      sent_at: new Date(),
    },
  });
  cleanupMessageIds.push(seedRow.id);

  const reply = await replyToOutlookMessage(
    seedRow.id,
    '<p>Automated verification reply from the ATS. Safe to ignore.</p>',
    { id: 0, first_name: 'Verification', last_name: 'Bot' }
  );
  cleanupMessageIds.push(Number(reply.id));

  const sameConversation = reply.conversation_id === seedSend.conversationId;
  const replyRow = await prisma.rpa_email_messages.findUnique({ where: { id: Number(reply.id) } });
  const inReplyToOk = replyRow?.in_reply_to === seedSend.internetMessageId;
  const trackingRow = await prisma.rpa_email_tracking.findFirst({ where: { message_id: Number(reply.id) } });

  results.push(`2. reply E2E: ${sameConversation && inReplyToOk ? 'OK' : 'FAILED'} — sameConversation=${sameConversation}, in_reply_to set=${inReplyToOk}, tracking row=${Boolean(trackingRow)}, subject='${reply.subject}'`);

  // 3) Open-tracking update semantics (same SQL as the public endpoint), twice.
  if (trackingRow?.tracking_token) {
    for (let i = 0; i < 2; i++) {
      await prisma.$executeRaw`
        UPDATE rpa_email_tracking
        SET opened = true,
            open_count = COALESCE(open_count, 0) + 1,
            first_opened_at = COALESCE(first_opened_at, NOW()),
            last_opened_at = NOW()
        WHERE tracking_token = ${trackingRow.tracking_token}::uuid
      `;
    }
    const after = await prisma.rpa_email_tracking.findUnique({ where: { id: trackingRow.id } });
    const ok = after.opened === true && after.open_count === 2 && after.first_opened_at && after.last_opened_at;
    results.push(`3. open tracking update: ${ok ? 'OK' : 'FAILED'} — opened=${after.opened}, open_count=${after.open_count}`);
  } else {
    results.push('3. open tracking update: SKIPPED — no tracking token found');
  }
} catch (err) {
  results.push(`2/3. reply E2E: FAILED — ${err.message}`);
}

// Cleanup verification rows (tracking rows first due to FK).
try {
  if (cleanupMessageIds.length) {
    await prisma.rpa_email_tracking.deleteMany({ where: { message_id: { in: cleanupMessageIds } } });
    await prisma.rpa_email_messages.deleteMany({ where: { id: { in: cleanupMessageIds } } });
  }
} catch (err) {
  results.push(`cleanup: WARNING — ${err.message}`);
}

console.log('\n=== VERIFICATION RESULTS ===');
for (const r of results) console.log(r);
await prisma.$disconnect();
// screening.service.js pulls in the shared Redis client, whose reconnect loop
// would otherwise keep this one-off script alive forever on machines without
// a local Redis.
process.exit(results.some((r) => r.includes('FAILED')) ? 1 : 0);
