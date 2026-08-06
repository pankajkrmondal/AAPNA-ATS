/**
 * documentReminder.js — the daily Documents-round reminder sweep (Phase 3 M4).
 *
 * RT asked for "reminders until submitted". What shipped was a manual
 * "Send reminder" button, which means the chasing only happens when somebody
 * remembers to chase — and the Documents round is the one stage where the ball
 * is entirely in the candidate's court, so nobody is watching it.
 *
 * This closes that: once a request has been outstanding for
 * DOCUMENT_REMINDER_AFTER_DAYS, it is reminded once a day until either every
 * document is in or DOCUMENT_REMINDER_MAX_COUNT reminders have been sent.
 *
 * Reuses sendReminder() from documentCollection.service.js rather than
 * duplicating the email path, so the manual button and the cron send exactly the
 * same mail, honour the same template override, and increment the same counters.
 *
 * Pure DB polling with no external API, so — like offerSweep.js — there is
 * nothing to feature-gate; only the cadence and thresholds are configurable.
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { sendReminder } from '../services/documentCollection.service.js';

let task = null;

/**
 * One sweep pass. Exported so it can be triggered manually and unit-tested.
 * @returns {Promise<{due: number, sent: number}>}
 */
export async function runDocumentReminders() {
  const { afterDays, maxCount, repeatHours } = config.document.reminder;

  const firstReminderCutoff = new Date(Date.now() - afterDays * 86400000);
  const repeatCutoff = new Date(Date.now() - repeatHours * 3600000);

  // Outstanding = the link is still open AND at least one document is not yet
  // verified. `rejected` counts as outstanding: the candidate has something to
  // re-upload, which is exactly what the rejection variant of the reminder says.
  const due = await prisma.rpa_document_requests.findMany({
    where: {
      token_status: 'active',
      reminder_count: { lt: maxCount },
      // Never chase a candidate whose journey has been closed underneath them.
      rpa_candidate_pipeline: { final_outcome: null },
      rpa_candidate_documents: { some: { status: { not: 'verified' } } },
      OR: [
        // Never reminded: wait afterDays from the original request.
        { last_reminded_at: null, requested_at: { lt: firstReminderCutoff } },
        // Reminded before: wait repeatHours from the last one.
        { last_reminded_at: { lt: repeatCutoff } },
      ],
    },
    select: { id: true, pipeline_id: true, reminder_count: true },
  });

  if (due.length === 0) return { due: 0, sent: 0 };
  logger.info(`[Document Reminder] ${due.length} outstanding document request(s) due a reminder.`);

  let sent = 0;
  for (const request of due) {
    try {
      // acted_by is null: the sweep is not a person, and the audit note it
      // writes should not name one.
      await sendReminder(Number(request.pipeline_id), { actedBy: null });
      sent += 1;
    } catch (err) {
      // Per-row guard, matching offerSweep.js: one candidate's failure must not
      // stop everyone else's reminder going out.
      logger.error(`[Document Reminder] reminder failed for pipeline ${request.pipeline_id}: ${err.message}`);
    }
  }

  logger.info(`[Document Reminder] sent ${sent}/${due.length} reminder(s).`);
  return { due: due.length, sent };
}

/** Registers the daily document reminder sweep. */
export function startDocumentReminderJob() {
  stopDocumentReminderJob();

  const expression = config.document.reminder.cron;
  if (!cron.validate(expression)) {
    logger.error(`Invalid DOCUMENT_REMINDER_CRON "${expression}" — document reminders not scheduled.`);
    return;
  }

  task = cron.schedule(expression, () => {
    logger.info('⏰ Running document reminder sweep…');
    runDocumentReminders().catch((err) =>
      logger.error(`[Document Reminder] Unhandled error: ${err.message}`)
    );
  });
  logger.info(
    `📄 Document reminder sweep scheduled: "${expression}" ` +
    `(first after ${config.document.reminder.afterDays} day(s), max ${config.document.reminder.maxCount}).`
  );
}

/** Stops the sweep if one is registered. */
export function stopDocumentReminderJob() {
  if (task) {
    task.stop();
    task = null;
    logger.info('Document reminder sweep stopped.');
  }
}
