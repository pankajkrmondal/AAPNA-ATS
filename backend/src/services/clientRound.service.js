/**
 * clientRound.service.js — marking the Client Interview (Phase 3, M3).
 *
 * The client interview is arranged entirely offline: RT talks to the client
 * directly, and the ATS records what happened (RT, 2026-08-25). Q14 is absolute
 * about the boundary — *"the system must not generate anything for the client"* —
 * so NOTHING in this module sends an email, creates a calendar event, or
 * dispatches a scorecard. It is two date-stamps and a transcription.
 *
 * WHY THIS REUSES rpa_interview_schedule
 * --------------------------------------
 * That table already models exactly what is needed here: a round, when it
 * happened (scheduled_start_at), whether it was held (occurrence_status), and
 * free-text notes. Giving the client round its own table would have duplicated
 * all four for two fields' worth of new information, and cost a DDL +
 * `prisma db pull` against shared staging.
 *
 * What it does NOT reuse is interviewSchedule.service.js's booking flow. That
 * one exists to invite people: it requires an interviewer mailbox, creates a
 * Teams meeting and emails both sides. The client round is not bookable there
 * any more (`client` is commented out of SCHEDULABLE_STAGES) precisely because
 * the address it collected was what the scorecard link was later emailed to.
 * These functions write the row directly instead, so there is no code path from
 * here to an outbound message.
 *
 * The two guards that back that up live elsewhere and still apply to any row
 * this module writes: dispatchScorecards() returns early for a manually-
 * coordinated stage, and jobs/interviewOccurrence.js skips them.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { assertJourneyOpen } from './pipeline.service.js';
import { STAGE_KEYS } from '../config/pipelineStages.js';
import { stageSendsInvites } from './interviewSchedule.service.js';

/** Serializes a schedule row for the API (BigInt -> Number). */
function serialize(row) {
  if (!row) return null;
  return { ...row, id: Number(row.id), pipeline_id: Number(row.pipeline_id) };
}

/**
 * Loads the journey, or 404s — and refuses to touch a closed one, matching
 * offer.service.js. A closed record is history.
 */
async function loadPipeline(pipelineId, action = 'mark this round') {
  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    include: { rpa_shortlisted_candidates: true },
  });
  if (!pipeline) throw new AppError('Pipeline journey not found.', 404);
  assertJourneyOpen(pipeline, action);
  return pipeline;
}

/** Appends a note to the journey's audit trail. */
async function auditNote(pipelineId, notes, actedBy) {
  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: BigInt(pipelineId),
      stage_key: STAGE_KEYS.CLIENT,
      event_type: 'note',
      notes,
      acted_by: actedBy || null,
    },
  });
}

/**
 * Belt and braces: this module must only ever be reachable for a round the ATS
 * does not invite for. If someone re-enables client invites without reading
 * this file, fail loudly rather than quietly writing a row that a later
 * scorecard sweep might act on.
 */
function assertManuallyCoordinated() {
  if (stageSendsInvites(STAGE_KEYS.CLIENT)) {
    throw new AppError('The client round is configured to send invites — use the booking flow instead.', 500);
  }
}

/**
 * The live client-round row for a journey, or null.
 *
 * The status predicate is `not 'cancelled'`, deliberately — it must match
 * uq_interview_schedule_live, which is UNIQUE (pipeline_id, stage_key) WHERE
 * status <> 'cancelled'. A narrower filter (e.g. status = 'scheduled') misses a
 * round that the OLD booking flow marked held, since markInterviewOccurrence
 * moves such a row to 'completed': recordClientRoundArranged() would then take
 * its create branch and hit the unique index, and recordClientRoundFeedback()
 * would claim the round had never been arranged. getLiveSchedule() and
 * getSchedulesByStage() — which is what the drawer renders from — use the same
 * predicate, so this stays consistent with what the recruiter can see.
 */
async function liveRow(pipelineId) {
  return prisma.rpa_interview_schedule.findFirst({
    where: {
      pipeline_id: BigInt(pipelineId),
      stage_key: STAGE_KEYS.CLIENT,
      status: { not: 'cancelled' },
    },
    orderBy: { created_at: 'desc' },
  });
}

/** The client round's current marks, or null when nothing is recorded yet. */
export async function getClientRound(pipelineId) {
  return serialize(await liveRow(pipelineId));
}

/**
 * Marks "Arranged Offline" — the round took place (or is set) at a given time,
 * coordinated by the recruiter with the client directly.
 *
 * Re-recording UPDATES the existing row rather than inserting a second one:
 * the partial unique index uq_interview_schedule_live allows only one live
 * booking per pipeline+stage, and correcting a mistyped date must not trip it.
 *
 * @param {number} pipelineId
 * @param {object} params
 * @param {string} params.happenedAt - ISO datetime of the client interview
 * @param {string} [params.contactName] - who from the client side took it
 * @param {number} params.actedBy
 */
export async function recordClientRoundArranged(pipelineId, { happenedAt, contactName = null, actedBy } = {}) {
  assertManuallyCoordinated();
  const pipeline = await loadPipeline(pipelineId);

  if (!happenedAt) throw new AppError('Tell us when the client interview took place.', 400);
  const when = new Date(happenedAt);
  if (Number.isNaN(when.getTime())) throw new AppError('A valid date and time is required.', 400);

  const name = (contactName || '').trim() || null;
  const existing = await liveRow(pipelineId);

  // scheduled_end_at is NOT NULL but no duration is captured for an offline
  // round, so it mirrors the start rather than inventing a length.
  const data = {
    scheduled_start_at: when,
    scheduled_end_at: when,
    interviewer_name: name,
    modified_at: new Date(),
  };

  const row = existing
    ? await prisma.rpa_interview_schedule.update({ where: { id: existing.id }, data })
    : await prisma.rpa_interview_schedule.create({
      data: {
        pipeline_id: pipeline.id,
        stage_key: STAGE_KEYS.CLIENT,
        status: 'scheduled',
        created_by: actedBy || null,
        // Deliberately no interviewer_email. Nothing is sent for this round,
        // and an address here is what used to receive the scorecard link.
        ...data,
      },
    });

  await auditNote(
    pipeline.id,
    `Client interview marked as arranged for ${when.toISOString().slice(0, 16).replace('T', ' ')}${name ? ` with ${name}` : ''} — coordinated manually, nothing sent`,
    actedBy
  );

  logger.info(`Client round arranged recorded: pipeline ${pipelineId}.`);
  return serialize(row);
}

/**
 * Marks "Client Feedback" — the recruiter heard back and transcribes what the
 * client said. Stored on the same row; occurrence_status 'held' is what the
 * drawer reads to show the step as done.
 *
 * @param {number} pipelineId
 * @param {object} params
 * @param {string} [params.heardAt] - ISO datetime; defaults to now
 * @param {string} params.feedback - the transcribed client verdict
 * @param {number} params.actedBy
 */
export async function recordClientRoundFeedback(pipelineId, { heardAt = null, feedback, actedBy } = {}) {
  assertManuallyCoordinated();
  const pipeline = await loadPipeline(pipelineId, 'record the client\'s feedback');

  const text = (feedback || '').trim();
  if (!text) throw new AppError('Record what the client said.', 400);

  let when = new Date();
  if (heardAt) {
    when = new Date(heardAt);
    if (Number.isNaN(when.getTime())) throw new AppError('A valid date is required.', 400);
  }

  // Feedback can only be recorded against a round that was marked as arranged —
  // otherwise there is no date for it to belong to, and the two steps would be
  // recordable out of order.
  const existing = await liveRow(pipelineId);
  if (!existing) {
    throw new AppError('Mark the round as arranged before recording the client\'s feedback.', 400);
  }

  const row = await prisma.rpa_interview_schedule.update({
    where: { id: existing.id },
    data: {
      occurrence_status: 'held',
      occurrence_source: 'manual',
      occurrence_confirmed_at: when,
      occurrence_confirmed_by: actedBy ? String(actedBy) : null,
      notes: text,
      modified_at: new Date(),
    },
  });

  await auditNote(pipeline.id, `Client feedback recorded: ${text}`, actedBy);

  logger.info(`Client round feedback recorded: pipeline ${pipelineId}.`);
  return serialize(row);
}
