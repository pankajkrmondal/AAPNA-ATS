/**
 * assessmentDeadlineChecker.js — polls rpa_assessment_invites for invites
 * whose deadline has passed with no Evalground result landed yet, and
 * notifies recruiters in-app (Socket.io bell only, no email — mirrors the
 * assessment:import_done idiom already used by assessmentImport.service.js).
 *
 * Mirrors zekoScheduler.js's shape (config-gated-by-nothing since this has no
 * external API dependency, env-sourced cron, module-level job handle) rather
 * than reminderScheduler.js's DB-backed-cron shape — the polling cadence
 * isn't an admin-tunable knob here, unlike the deadline-days count itself
 * (which lives in rpa_settings via assessmentSettings.service.js).
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { emitToRole } from '../socket/index.js';
import { notify, NOTIFICATION_TYPES } from '../services/notification.service.js';

let job = null;

export function startAssessmentDeadlineJob() {
  const configured = config.assessment.deadlineCheckCron;
  const schedule = cron.validate(configured) ? configured : '0 * * * *';
  if (!cron.validate(configured)) {
    logger.error(`Invalid ASSESSMENT_DEADLINE_CHECK_CRON "${configured}" — falling back to hourly.`);
  }

  job = cron.schedule(schedule, async () => {
    logger.info('⏰ Running Evalground invite deadline check…');
    try {
      await checkOverdueAssessmentInvites();
    } catch (error) {
      logger.error('Assessment deadline check failed:', { error: error.message });
    }
  });

  logger.info(`📅 Assessment deadline checker cron scheduled: "${schedule}"`);
}

export function stopAssessmentDeadlineJob() {
  if (job) {
    job.stop();
    job = null;
    logger.info('Assessment deadline checker cron stopped');
  }
}

/**
 * Finds each pipeline's LATEST invite (a re-invite supersedes the earlier
 * attempt's deadline entirely) where the deadline has passed, no bell has
 * fired yet for THIS invite, and no result has landed. Idempotent: stamps
 * reminded_at so it never fires twice for the same invite.
 * @returns {Promise<number>} count of invites notified
 */
export async function checkOverdueAssessmentInvites() {
  const overdue = await prisma.$queryRaw`
    WITH latest_invites AS (
      SELECT DISTINCT ON (pipeline_id) *
      FROM rpa_assessment_invites
      ORDER BY pipeline_id, sent_at DESC
    )
    SELECT li.id AS invite_id, li.pipeline_id, li.deadline_at
    FROM latest_invites li
    WHERE li.deadline_at < NOW()
      AND li.reminded_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM rpa_assessment_results r
        WHERE r.pipeline_id = li.pipeline_id AND r.status IN ('matched', 'score_overwritten')
      );
  `;

  if (!overdue || overdue.length === 0) return 0;
  logger.info(`[Assessment Deadline Checker] Found ${overdue.length} overdue invite(s) with no landed result.`);

  const pipelineIds = overdue.map((r) => r.pipeline_id);
  const pipelines = await prisma.rpa_candidate_pipeline.findMany({
    where: { id: { in: pipelineIds } },
    include: { rpa_shortlisted_candidates: { include: { mrf: true } } },
  });
  const pipelineById = new Map(pipelines.map((p) => [String(p.id), p]));

  let notified = 0;
  for (const row of overdue) {
    try {
      const pipeline = pipelineById.get(String(row.pipeline_id));
      const candidateName = pipeline?.rpa_shortlisted_candidates?.candidate_name || null;
      const position = pipeline?.rpa_shortlisted_candidates?.mrf?.position_hiring_for
        || pipeline?.rpa_shortlisted_candidates?.position_applied || null;

      // Kept for any open view that refreshes on it; the bell reads the row.
      emitToRole('recruiter', 'assessment:deadline_expired', {
        pipelineId: Number(row.pipeline_id),
        inviteId: Number(row.invite_id),
        candidateName,
        position,
        deadlineAt: row.deadline_at,
      });

      await notify({
        type: NOTIFICATION_TYPES.ASSESSMENT_DEADLINE_EXPIRED,
        title: 'Evalground invite deadline passed',
        description: `${candidateName || 'A candidate'}${position ? ` — ${position}` : ''} — re-invite or upload the result`,
        pipelineId: row.pipeline_id,
        meta: { invite_id: Number(row.invite_id) },
      });

      await prisma.rpa_assessment_invites.update({
        where: { id: row.invite_id },
        data: { reminded_at: new Date() },
      });
      notified += 1;
    } catch (err) {
      logger.error(`[Assessment Deadline Checker] Failed to notify for invite ${row.invite_id}: ${err.message}`);
    }
  }
  return notified;
}
