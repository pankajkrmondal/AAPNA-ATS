/**
 * interviewRecordings.js — post-interview RECORDING discovery sweep.
 *
 * Every N minutes it looks for booked rounds whose window has passed and which
 * are not yet linked to a recording, asks Graph what Teams produced for that
 * meeting, and stores the result against the booking. Requirement 1 of the
 * recordings brief: capture the Teams recording per round automatically instead
 * of relying on an interviewer to paste a link into their scorecard.
 *
 * WHY A SWEEP AND NOT A WEBHOOK: a recording is not available the instant a call
 * ends — Teams has to process and upload it, which takes minutes. Microsoft's own
 * guidance is that the artifact appears in the list only once it is ready, so
 * polling a small set of recently-ended meetings is both the simplest and the
 * documented approach.
 *
 * Idempotency, in two layers:
 *   - recording_checked_at records the last poll (mirrors attendance_checked_at);
 *   - graph_recording_id is UNIQUE in the database, so re-listing the same
 *     meeting on every tick can only ever update the existing row.
 * A booking is therefore safe to re-sweep for as long as we like.
 *
 * This job DISCOVERS and LINKS only. It does not copy anything to our own drive
 * (Phase 5) and it does not decide that a round is missing its recording
 * (Phase 6) — an absent recording is left unresolved so a late upload is still
 * picked up on a later tick.
 *
 * See docs/phase3/INTERVIEW-RECORDINGS-PLAN.md §4.
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { listMeetingArtifacts, isRecordingFetchEnabled, openRecordingContent } from '../services/graphRecording.service.js';
import { ensureDriveFolderPathFromRoot, uploadStreamToOneDrive, deleteDriveItem } from '../services/onedrive.service.js';
import { stageIsRecorded } from '../services/interviewSchedule.service.js';
import { resolveRecipients } from '../config/emailRecipients.js';
import { sendGraphEmail } from '../services/emailNotification.service.js';
import { wrapBrandedEmail } from '../services/emailLayout.service.js';

let job = null;
let retentionJob = null;

export const SETTING_KEYS = Object.freeze({
  ENABLED: 'interview_recording_enabled',
  INTERVAL_MIN: 'interview_recording_interval_min',
  GRACE_MIN: 'interview_recording_grace_min',
});

/** Poll intervals the UI offers, in minutes (shared with the other sweeps). */
export const ALLOWED_INTERVALS = Object.freeze([1, 2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);

const DEFAULTS = { enabled: false, intervalMin: 15, graceMin: 10 };

/**
 * How long a booking stays eligible for discovery.
 *
 * Bounded for two independent reasons. Ours: an unbounded sweep would re-poll
 * every interview ever held, on every tick, forever. Microsoft's: the per-meeting
 * artifact endpoints stop working once the onlineMeeting expires, 60 days after
 * the meeting — so past that point there is nothing left to find and the calls
 * would only ever return 403/404.
 */
const DISCOVERY_WINDOW_DAYS = 45;

/** Marks a booking as having at least one linked recording. */
const RECORDING_STATUS = Object.freeze({ AVAILABLE: 'available' });

/**
 * Reads the sweep configuration from rpa_settings, with defaults.
 * @returns {Promise<{enabled: boolean, intervalMin: number, graceMin: number}>}
 */
export async function getInterviewRecordingSettings() {
  const rows = await prisma.rpa_settings.findMany({
    where: { key: { in: Object.values(SETTING_KEYS) } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const intervalMin = parseInt(map[SETTING_KEYS.INTERVAL_MIN], 10);
  const graceMin = parseInt(map[SETTING_KEYS.GRACE_MIN], 10);

  return {
    enabled: map[SETTING_KEYS.ENABLED] === 'true',
    intervalMin: ALLOWED_INTERVALS.includes(intervalMin) ? intervalMin : DEFAULTS.intervalMin,
    graceMin: Number.isInteger(graceMin) && graceMin >= 0 ? graceMin : DEFAULTS.graceMin,
  };
}

/** Builds the node-cron expression for an every-N-minutes poll. */
const cronForInterval = (minutes) => (minutes >= 60 ? '0 * * * *' : `*/${minutes} * * * *`);

/**
 * Starts (or restarts) the discovery sweep from the current settings.
 * A disabled setting, or a missing Graph permission, means no cron at all.
 */
export async function startInterviewRecordingJob() {
  try {
    // Defensive: stop any live cron first so a double start never stacks two.
    stopInterviewRecordingJob();

    // Retention is scheduled FIRST, before any of the discovery gates below.
    // The deletion promised to candidates in their invite email does not lapse
    // because capture was switched off — if anything, an environment that has
    // stopped capturing is the one most likely to be left holding old video that
    // nobody is watching. It also runs on its own daily schedule rather than
    // inside the sweep: deleting is not a thing to do every 15 minutes.
    if (config.microsoft.recordingRetainMonths > 0) {
      retentionJob = cron.schedule('30 3 * * *', async () => {
        try {
          await purgeExpiredRecordings();
        } catch (err) {
          logger.error(`Recording retention sweep failed: ${err.message}`);
        }
      });
      logger.info(`🗑️  Recording retention: deleting archived video ${config.microsoft.recordingRetainMonths} months after a journey closes (daily 03:30).`);
    }

    if (!isRecordingFetchEnabled()) {
      logger.info('⏸️  Interview recording sweep disabled (MS_RECORDING_FETCH_ENABLED=false) — not scheduling.');
      return;
    }
    const { enabled, intervalMin } = await getInterviewRecordingSettings();
    if (!enabled) {
      logger.info('⏸️  Interview recording sweep disabled (interview_recording_enabled=false) — not scheduling.');
      return;
    }
    const expression = cronForInterval(intervalMin);
    job = cron.schedule(expression, async () => {
      try {
        await sweepInterviewRecordings();
        // Archiving runs after discovery in the same tick, so a recording found
        // on this pass is copied on this pass rather than waiting for the next.
        await archiveRecordings();
        // Then rule on rounds that were supposed to record and did not.
        await flagMissingRecordings();
      } catch (err) {
        logger.error(`Interview recording sweep failed: ${err.message}`);
      }
    });
    logger.info(`🎥 Interview recording sweep running every ${intervalMin} min ("${expression}").`);
  } catch (err) {
    logger.error(`Failed to start interview recording job: ${err.message}`);
  }
}

/** Stops the sweep crons if any are registered. */
export function stopInterviewRecordingJob() {
  if (job) {
    job.stop();
    job = null;
    logger.info('Interview recording sweep stopped.');
  }
  if (retentionJob) {
    retentionJob.stop();
    retentionJob = null;
  }
}

/** Applies a settings change immediately (called from the settings controller). */
export async function restartInterviewRecordingJob() {
  stopInterviewRecordingJob();
  await startInterviewRecordingJob();
}

/**
 * One sweep pass. Exported so it can be triggered manually and unit-tested.
 *
 * @returns {Promise<{processed: number, linked: number, unreadable: number, pending: number}>}
 *   linked     — bookings that gained at least one artifact on this pass
 *   unreadable — Graph could not answer (permission, expired meeting, error)
 *   pending    — answered, but nothing published yet; will be retried
 */
export async function sweepInterviewRecordings() {
  if (!isRecordingFetchEnabled()) return { processed: 0, linked: 0, unreadable: 0, pending: 0 };

  const { graceMin } = await getInterviewRecordingSettings();
  const endedBefore = new Date(Date.now() - graceMin * 60 * 1000);
  const windowStart = new Date(Date.now() - DISCOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const due = await prisma.rpa_interview_schedule.findMany({
    where: {
      // A cancelled round's meeting may still hold a recording, but nobody is
      // going to review a round that was called off, and rebooking creates a new
      // row that will be swept on its own merits.
      status: { not: 'cancelled' },
      // No Teams meeting, nothing to ask about — covers bookings made while the
      // calendar integration was off, and the manually-coordinated rounds.
      online_meeting_id: { not: null },
      // Already linked. Not driven by the presence of child rows, so a booking
      // whose recording is later deleted is not silently re-swept forever.
      recording_status: null,
      scheduled_end_at: { lt: endedBefore, gt: windowStart },
    },
    orderBy: { scheduled_end_at: 'desc' },
    // A cap keeps one tick's Graph usage predictable; anything not reached is
    // simply picked up on the next tick, which is minutes away.
    take: 50,
  });

  if (due.length === 0) return { processed: 0, linked: 0, unreadable: 0, pending: 0 };
  logger.info(`[Recording Sweep] ${due.length} booking(s) past end without a linked recording.`);

  let linked = 0, unreadable = 0, pending = 0;

  for (const row of due) {
    // Deliberately re-checked per row rather than filtered in the query: the
    // recorded-stage set is configuration (MS_RECORDED_STAGES), and a historical
    // booking from a round that is no longer recorded should not be polled.
    if (!stageIsRecorded(row.stage_key)) continue;

    const { artifacts, readable } = await listMeetingArtifacts(row.online_meeting_id);

    // Stamp the poll either way, so an operator can tell "never looked at" from
    // "looked at repeatedly, still nothing".
    const checked = { recording_checked_at: new Date(), modified_at: new Date() };

    if (!readable) {
      unreadable += 1;
      await prisma.rpa_interview_schedule.update({ where: { id: row.id }, data: checked });
      continue;
    }

    if (artifacts.length === 0) {
      // Readable but empty: Teams may still be processing the upload. Left
      // unresolved on purpose — Phase 6 decides when to call it missing.
      pending += 1;
      await prisma.rpa_interview_schedule.update({ where: { id: row.id }, data: checked });
      continue;
    }

    for (const a of artifacts) {
      // Upsert, not create: the sweep re-lists the same meeting on every tick,
      // and the unique graph_recording_id turns a repeat into a no-op update
      // rather than a duplicate row or a crash.
      await prisma.rpa_interview_recording.upsert({
        where: { graph_recording_id: a.graphId },
        create: {
          schedule_id: row.id,
          pipeline_id: row.pipeline_id,
          stage_key: row.stage_key,
          kind: a.kind,
          graph_recording_id: a.graphId,
          online_meeting_id: row.online_meeting_id,
          recorded_start_at: a.startAt,
          recorded_end_at: a.endAt,
          graph_content_url: a.contentUrl,
        },
        update: {
          // The content URL is the only field Graph can meaningfully revise for
          // an artifact we have already seen; everything else is immutable.
          graph_content_url: a.contentUrl,
          recorded_end_at: a.endAt,
          modified_at: new Date(),
        },
      });
    }

    // 'available' is set on the presence of a RECORDING, not of any artifact: a
    // meeting that produced only a transcript has not given the decision-makers
    // the thing they were promised, and should keep being polled for the video.
    const hasRecording = artifacts.some((a) => a.kind === 'recording');
    await prisma.rpa_interview_schedule.update({
      where: { id: row.id },
      data: { ...checked, ...(hasRecording ? { recording_status: RECORDING_STATUS.AVAILABLE } : {}) },
    });

    if (hasRecording) {
      linked += 1;
      logger.info(
        `[Recording Sweep] schedule ${row.id} (${row.stage_key}, pipeline ${row.pipeline_id}) → `
        + `${artifacts.filter((a) => a.kind === 'recording').length} recording(s), `
        + `${artifacts.filter((a) => a.kind === 'transcript').length} transcript(s) linked.`
      );
    } else {
      pending += 1;
    }
  }

  logger.info(`[Recording Sweep] linked=${linked} pending=${pending} unreadable=${unreadable}.`);
  return { processed: due.length, linked, unreadable, pending };
}

/** Whether copying recordings into our own OneDrive is switched on. */
export const isArchiveEnabled = () => Boolean(config.microsoft.recordingArchiveEnabled);

/**
 * How many recordings one tick will copy.
 *
 * Small on purpose. Each is potentially hundreds of megabytes pulled from Graph
 * and pushed back to OneDrive, so an unbounded pass could run for an hour, hold
 * a database connection the whole time, and collide with the next tick. Anything
 * not reached waits minutes for the next pass — there is no deadline here, only
 * a backlog that drains.
 */
const ARCHIVE_BATCH = 3;

/** Attempts before a recording is left alone for a human to look at. */
const MAX_ARCHIVE_ATTEMPTS = 5;

/**
 * Copies discovered recordings into the ATS's own OneDrive folder.
 *
 * WHY THIS EXISTS: a Teams recording lives in the ORGANIZER's personal OneDrive.
 * Personal OneDrives are deleted when someone leaves the company, so without a
 * copy every interview recording the company holds is one offboarding away from
 * gone. Microsoft also stops serving a meeting's artifacts through Graph about
 * 60 days after it took place, which caps how long the original link keeps
 * working even while the file still exists.
 *
 * Layout: Recordings_ATS / <Candidate> (pipeline-<id>) / <Round> - <date>.mp4
 * Grouping by candidate rather than by date because the question people ask is
 * always "the recordings for this person", never "everything from March".
 *
 * Best-effort per row: one recording that cannot be copied must not stop the
 * rest, so failures are recorded on the row and the pass continues.
 *
 * @returns {Promise<{attempted: number, archived: number, failed: number}>}
 */
export async function archiveRecordings() {
  if (!isRecordingFetchEnabled() || !isArchiveEnabled()) return { attempted: 0, archived: 0, failed: 0 };

  const due = await prisma.rpa_interview_recording.findMany({
    where: {
      kind: 'recording',
      archive_status: 'pending',
      graph_content_url: { not: null },
    },
    include: {
      rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: true } },
      rpa_pipeline_stages: true,
    },
    orderBy: { discovered_at: 'asc' }, // oldest first: closest to Graph expiry
    take: ARCHIVE_BATCH,
  });

  if (due.length === 0) return { attempted: 0, archived: 0, failed: 0 };
  logger.info(`[Recording Archive] ${due.length} recording(s) to copy.`);

  let archived = 0, failed = 0;

  for (const rec of due) {
    const candidate = rec.rpa_candidate_pipeline?.rpa_shortlisted_candidates;
    const candidateName = candidate?.candidate_name || 'Unknown candidate';
    const stageLabel = rec.rpa_pipeline_stages?.label || rec.stage_key;
    const when = rec.recorded_start_at ? new Date(rec.recorded_start_at) : new Date();
    const datePart = when.toISOString().slice(0, 10);

    try {
      const folderId = await ensureDriveFolderPathFromRoot([
        config.microsoft.recordingArchiveFolder,
        // Pipeline id in the folder name so two candidates of the same name are
        // never merged into one folder.
        `${candidateName} (pipeline-${rec.pipeline_id})`,
      ]);

      const { stream, totalBytes } = await openRecordingContent(rec.graph_content_url);
      const item = await uploadStreamToOneDrive({
        webStream: stream,
        totalBytes,
        parentItemId: folderId,
        fileName: `${stageLabel} - ${datePart}.mp4`,
      });

      await prisma.rpa_interview_recording.update({
        where: { id: rec.id },
        data: {
          archive_status: 'copied',
          archive_item_id: item.id,
          archive_web_url: item.webUrl,
          archive_bytes: BigInt(item.size || totalBytes),
          archived_at: new Date(),
          archive_error: null,
          modified_at: new Date(),
        },
      });
      archived += 1;
      logger.info(`[Recording Archive] ${candidateName} · ${stageLabel} → ${item.size} bytes copied.`);
    } catch (err) {
      failed += 1;
      // Attempts are counted in the error text rather than a new column: the
      // number only matters for deciding when to stop, and a schema change for
      // a retry counter is not worth it.
      const attempt = (Number((rec.archive_error || '').match(/^\[attempt (\d+)]/)?.[1]) || 0) + 1;
      const giveUp = attempt >= MAX_ARCHIVE_ATTEMPTS;
      await prisma.rpa_interview_recording.update({
        where: { id: rec.id },
        data: {
          // 'failed' drops it out of the due filter for good; a human can reset
          // it to 'pending' once whatever broke is fixed.
          archive_status: giveUp ? 'failed' : 'pending',
          archive_error: `[attempt ${attempt}] ${err.message}`.slice(0, 1000),
          modified_at: new Date(),
        },
      });
      logger[giveUp ? 'error' : 'warn'](
        `[Recording Archive] ${candidateName} · ${stageLabel} failed (attempt ${attempt}${giveUp ? ', giving up' : ''}) — ${err.message}`
      );
    }
  }

  logger.info(`[Recording Archive] archived=${archived} failed=${failed}.`);
  return { attempted: due.length, archived, failed };
}

/**
 * How long after a round ends before "no recording yet" becomes "no recording".
 *
 * Generous on purpose. Teams can take a while to publish a recording, and a
 * false "this interview wasn't recorded" alert is worse than a late true one: it
 * sends a recruiter chasing an interviewer over something that was working.
 */
const MISSING_AFTER_HOURS = 6;

/**
 * Flags rounds that were set to record but produced nothing, and tells someone.
 *
 * WHY THIS IS THE POINT OF THE WHOLE FEATURE'S HONESTY: Teams cannot lock a
 * recording on (§3.3). An interviewer who is a presenter can stop it, and the
 * candidate could simply not be recorded through some tenant hiccup. Without
 * this pass the failure is silent until someone goes looking weeks later — which
 * is exactly when the recording was needed and exactly when it is too late.
 * Detection is the compensating control for a rule we cannot enforce.
 *
 * Only rounds we ACTUALLY configured to record are considered
 * (record_auto_applied_at is set), so a round booked before this feature — or
 * one where Graph refused the options PATCH — never produces a false alarm.
 *
 * One alert per booking: recording_status='missing' is both the verdict and the
 * idempotency guard.
 *
 * @returns {Promise<{flagged: number, alerted: number}>}
 */
export async function flagMissingRecordings() {
  if (!isRecordingFetchEnabled()) return { flagged: 0, alerted: 0 };

  const cutoff = new Date(Date.now() - MISSING_AFTER_HOURS * 60 * 60 * 1000);
  const windowStart = new Date(Date.now() - DISCOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const due = await prisma.rpa_interview_schedule.findMany({
    where: {
      status: { not: 'cancelled' },
      record_auto_applied_at: { not: null }, // we DID set this round to record
      recording_status: null,
      // Only rounds we have actually looked for: without this a Graph outage
      // would be reported to recruiters as interviewers failing to record.
      recording_checked_at: { not: null },
      scheduled_end_at: { lt: cutoff, gt: windowStart },
      // A round nobody confirmed happened is the occurrence sweep's problem, not
      // this one — "no recording" is only news for an interview that took place.
      occurrence_status: 'held',
    },
    include: {
      rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: true } },
      rpa_pipeline_stages: true,
    },
    take: 20,
  });

  if (due.length === 0) return { flagged: 0, alerted: 0 };

  let alerted = 0;
  for (const row of due) {
    await prisma.rpa_interview_schedule.update({
      where: { id: row.id },
      data: { recording_status: 'missing', modified_at: new Date() },
    });

    const candidate = row.rpa_candidate_pipeline?.rpa_shortlisted_candidates;
    const stageLabel = row.rpa_pipeline_stages?.label || row.stage_key;
    const name = candidate?.candidate_name || 'the candidate';
    const subject = `No recording was produced for the ${stageLabel} with ${name}`;
    const html = `<p>The <strong>${stageLabel}</strong> interview with <strong>${name}</strong> was confirmed as held, and the meeting was set to record automatically — but <strong>no recording exists</strong>.</p>
      <p>The most likely reasons are that the recording was stopped during the call, or that nobody with permission to record joined.</p>
      <p>There is nothing to attach to this candidate's record, so the later rounds will have no earlier interview to review. If this round matters to the final decision, consider asking the panel for written notes.</p>`;

    const { to } = resolveRecipients('occurrenceNudge', config.microsoft.defaultSender);
    if (!to) continue;
    try {
      // OPERATOR_ADDRESSED: internal recruitment mailbox, reached in every env.
      await sendGraphEmail({
        sender: config.microsoft.defaultSender,
        to,
        subject,
        html: wrapBrandedEmail(html, { title: subject }),
        allowRealRecipients: true,
      });
      alerted += 1;
    } catch (err) {
      logger.error(`[Recording Missing] alert failed for schedule ${row.id}: ${err.message}`);
    }
  }

  logger.warn(`[Recording Missing] ${due.length} held round(s) produced no recording; ${alerted} alert(s) sent.`);
  return { flagged: due.length, alerted };
}

/**
 * Retention: deletes archived recordings 12 months after the journey closed.
 *
 * The decision (plan §0.5) was MP4 deleted, transcript kept. Two reasons this
 * has to actually run rather than sit in a policy document: the candidate invite
 * email now PROMISES deletion within 12 months, and an undeleted promise is
 * worse than no promise; and with Teams auto-expiry off on this tenant, nothing
 * else in the system ever reclaims a byte.
 *
 * Keyed on rpa_candidate_pipeline.closed_at, so an open journey's recordings are
 * never touched however old they are — a candidate still in play is still being
 * decided on.
 *
 * The ROW survives with archive_status='purged'. Deleting it would erase the
 * evidence that a recording once existed and was disposed of on schedule, which
 * is the part an auditor actually asks about.
 *
 * @returns {Promise<{purged: number, failed: number}>}
 */
export async function purgeExpiredRecordings() {
  const months = config.microsoft.recordingRetainMonths;
  if (!months || months <= 0) return { purged: 0, failed: 0 };

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  const due = await prisma.rpa_interview_recording.findMany({
    where: {
      kind: 'recording', // transcripts are kept indefinitely (plan §0.5)
      archive_status: 'copied',
      archive_item_id: { not: null },
      rpa_candidate_pipeline: { closed_at: { not: null, lt: cutoff } },
    },
    take: 25,
  });
  if (due.length === 0) return { purged: 0, failed: 0 };

  let purged = 0, failed = 0;
  for (const rec of due) {
    try {
      await deleteDriveItem(rec.archive_item_id);
      await prisma.rpa_interview_recording.update({
        where: { id: rec.id },
        data: {
          archive_status: 'purged',
          archive_item_id: null,
          archive_web_url: null,
          // graph_content_url goes too: the Teams original is long gone by now
          // (Microsoft stops serving it after ~60 days), so leaving it would
          // offer a Play button that could only ever fail.
          graph_content_url: null,
          modified_at: new Date(),
        },
      });
      purged += 1;
    } catch (err) {
      failed += 1;
      logger.error(`[Recording Retention] could not purge recording ${rec.id}: ${err.message}`);
    }
  }

  logger.info(`[Recording Retention] purged=${purged} failed=${failed} (older than ${months} months past closure).`);
  return { purged, failed };
}
