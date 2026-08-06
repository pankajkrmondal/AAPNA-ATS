/**
 * offer.service.js — Phase 3 Module 5: the Offer round.
 *
 * RECORD-ONLY (Q3, reinforced by RT 2026-07-14): appointment/offer letters are
 * prepared and shared by HR entirely outside the ATS, from their own mailbox.
 * Nothing here generates, stores, or sends a letter — it records that one went
 * out, when, for what joining date, and what the candidate said.
 *
 * The internal approval is a SOFT gate (Q26): recordOfferShared() deliberately
 * does not require approval first, so an exceptional case is never blocked; the
 * approval is tracked and nudged daily, not enforced.
 *
 * Closure is NOT here. The 8 final statuses live on
 * rpa_candidate_pipeline.final_outcome via pipeline.service.js setFinalOutcome().
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { closeMrfIfFilled, reopenMrfIfUnfilled } from './mrfClosure.service.js';
import { assertJourneyOpen } from './pipeline.service.js';
import { notify, NOTIFICATION_TYPES } from './notification.service.js';

/** Serializes an offer row for the API (BigInt -> Number). */
function serialize(row) {
  if (!row) return null;
  return { ...row, id: Number(row.id), pipeline_id: Number(row.pipeline_id) };
}

/**
 * Loads the journey, or 404s — and refuses to touch a closed one.
 *
 * Every function in this module mutates the offer record of a live journey. A
 * closed record (joined, withdrawn, rejected) is history; re-approving or
 * re-sharing an offer on it would rewrite that history silently.
 */
async function loadPipeline(pipelineId, action = 'change this offer') {
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
      stage_key: 'offer',
      event_type: 'note',
      notes,
      acted_by: actedBy || null,
    },
  });
}

/**
 * The offer record for a journey, or null when none has been started.
 * @param {number} pipelineId
 */
export async function getOffer(pipelineId) {
  const row = await prisma.rpa_offers.findUnique({ where: { pipeline_id: BigInt(pipelineId) } });
  return serialize(row);
}

/**
 * Starts the internal approval: the recruiter asks for sign-off before the
 * offer goes out. Arms the daily nudge (jobs/offerSweep.js) by setting
 * approval_requested_at.
 *
 * @param {number} pipelineId
 * @param {object} params
 * @param {number} params.actedBy
 */
export async function requestApproval(pipelineId, { actedBy } = {}) {
  const pipeline = await loadPipeline(pipelineId);

  const existing = await prisma.rpa_offers.findUnique({ where: { pipeline_id: pipeline.id } });
  if (existing?.approval_status === 'approved') {
    throw new AppError('This offer has already been approved.', 409);
  }

  const row = await prisma.rpa_offers.upsert({
    where: { pipeline_id: pipeline.id },
    create: {
      pipeline_id: pipeline.id,
      approval_status: 'pending',
      approval_requested_at: new Date(),
    },
    update: {
      approval_status: 'pending',
      approval_requested_at: new Date(),
      // Re-requesting re-arms the nudge from scratch.
      approval_nudged_at: null,
      modified_at: new Date(),
    },
  });

  await auditNote(pipeline.id, 'Offer approval requested — daily reminder armed', actedBy);

  // Someone other than the requester has to sign this off, so it goes to the
  // team's bell as well as the daily email nudge (offerSweep.js).
  await notify({
    type: NOTIFICATION_TYPES.OFFER_APPROVAL_REQUESTED,
    title: 'Offer awaiting internal approval',
    description: `${pipeline.rpa_shortlisted_candidates?.candidate_name || 'A candidate'} — sign off before the offer goes out`,
    pipelineId: pipeline.id,
    excludeUserId: actedBy || null,
  });

  logger.info(`Offer approval requested: pipeline ${pipelineId}.`);
  return serialize(row);
}

/**
 * Records the internal sign-off. Stops the daily nudge.
 * @param {number} pipelineId
 * @param {object} params
 * @param {number} params.actedBy
 */
export async function approveOffer(pipelineId, { actedBy } = {}) {
  const pipeline = await loadPipeline(pipelineId);

  const row = await prisma.rpa_offers.upsert({
    where: { pipeline_id: pipeline.id },
    // Approving without a prior request is allowed — the request step exists to
    // chase someone, not to gate the approval itself.
    create: {
      pipeline_id: pipeline.id,
      approval_status: 'approved',
      approved_by: actedBy || null,
      approved_at: new Date(),
    },
    update: {
      approval_status: 'approved',
      approved_by: actedBy || null,
      approved_at: new Date(),
      modified_at: new Date(),
    },
  });

  await auditNote(pipeline.id, 'Offer approved internally', actedBy);
  logger.info(`Offer approved: pipeline ${pipelineId}.`);
  return serialize(row);
}

/**
 * Records that HR shared the offer with the candidate (from their own mailbox —
 * the ATS neither sends nor stores the letter).
 *
 * Soft gate (Q26): allowed even when approval was never recorded, so an
 * exceptional case is never blocked. The skipped approval is written to the
 * audit trail rather than rejected.
 *
 * @param {number} pipelineId
 * @param {object} params
 * @param {string} [params.joiningDate] - ISO date
 * @param {string} [params.remarks]
 * @param {number} params.actedBy
 */
export async function recordOfferShared(pipelineId, { joiningDate = null, remarks = null, actedBy } = {}) {
  const pipeline = await loadPipeline(pipelineId);

  let joining = null;
  if (joiningDate) {
    joining = new Date(joiningDate);
    if (Number.isNaN(joining.getTime())) throw new AppError('A valid joining date is required.', 400);
  }

  const existing = await prisma.rpa_offers.findUnique({ where: { pipeline_id: pipeline.id } });
  const skippedApproval = existing?.approval_status !== 'approved';

  const data = {
    shared_at: new Date(),
    shared_by: actedBy || null,
    joining_date: joining,
    remarks: (remarks || '').trim() || null,
  };

  // Only initialise the decision when there ISN'T one yet. Setting it
  // unconditionally meant re-recording "shared" — correcting a typo'd joining
  // date, say — silently wiped an already-recorded acceptance back to pending,
  // while decision_at kept pointing at the wiped decision.
  if (!existing || !existing.candidate_decision || existing.candidate_decision === 'pending') {
    data.candidate_decision = 'pending';
  }

  const row = await prisma.rpa_offers.upsert({
    where: { pipeline_id: pipeline.id },
    create: { pipeline_id: pipeline.id, ...data },
    update: { ...data, modified_at: new Date() },
  });

  // Legacy reporting continuity — the vendor dashboard and older reports read
  // these columns directly.
  if (pipeline.shortlist_id) {
    try {
      await prisma.rpa_shortlisted_candidates.update({
        where: { id: pipeline.shortlist_id },
        data: { offer_sent_at: row.shared_at },
      });
    } catch (err) {
      logger.error(`Offer shared: legacy offer_sent_at write-back failed for pipeline ${pipelineId}: ${err.message}`);
    }
  }

  await auditNote(
    pipeline.id,
    `Offer recorded as shared${joining ? ` — proposed joining ${joining.toISOString().slice(0, 10)}` : ''}${skippedApproval ? ' (internal approval was not recorded)' : ''}`,
    actedBy
  );
  logger.info(`Offer shared recorded: pipeline ${pipelineId} (approvalSkipped=${skippedApproval}).`);
  return serialize(row);
}

/**
 * Records the candidate's answer to the offer.
 * @param {number} pipelineId
 * @param {object} params
 * @param {'accepted'|'rejected'} params.decision
 * @param {string} [params.remarks]
 * @param {number} params.actedBy
 * @param {boolean} [params.amend=false] - explicitly overwrite a decision that
 *   was already recorded. Off by default so a double-click or a stale tab
 *   cannot flip an acceptance; the caller has to mean it.
 */
export async function recordCandidateDecision(pipelineId, { decision, remarks = null, actedBy, amend = false } = {}) {
  if (!['accepted', 'rejected'].includes(decision)) {
    throw new AppError("decision must be 'accepted' or 'rejected'.", 400);
  }
  const pipeline = await loadPipeline(pipelineId, 'record the candidate\'s decision');

  const existing = await prisma.rpa_offers.findUnique({ where: { pipeline_id: pipeline.id } });
  if (!existing?.shared_at) {
    throw new AppError('Record the offer as shared before recording the candidate\'s decision.', 400);
  }

  const previousDecision = existing.candidate_decision;
  const alreadyDecided = previousDecision === 'accepted' || previousDecision === 'rejected';
  if (alreadyDecided && !amend) {
    throw new AppError(
      `The candidate's decision is already recorded as "${previousDecision}". Amend it explicitly if it needs to change.`,
      409
    );
  }

  const decidedAt = new Date();
  const row = await prisma.rpa_offers.update({
    where: { pipeline_id: pipeline.id },
    data: {
      candidate_decision: decision,
      decision_at: decidedAt,
      remarks: (remarks || '').trim() || existing.remarks,
      modified_at: new Date(),
    },
  });

  // Legacy write-back, both directions. Only the 'accepted' half existed, so
  // amending an acceptance down to 'rejected' left offer_accepted_at set and the
  // vendor dashboard still reporting a hire that had been reversed.
  if (pipeline.shortlist_id) {
    try {
      await prisma.rpa_shortlisted_candidates.update({
        where: { id: pipeline.shortlist_id },
        data: { offer_accepted_at: decision === 'accepted' ? decidedAt : null },
      });
    } catch (err) {
      logger.error(`Offer decision: legacy offer_accepted_at write-back failed for pipeline ${pipelineId}: ${err.message}`);
    }
  }

  const reversal = alreadyDecided && previousDecision !== decision;
  await auditNote(
    pipeline.id,
    reversal
      ? `Offer decision amended: ${previousDecision} → ${decision}`
      : `Offer ${decision} by the candidate`,
    actedBy
  );

  await notify({
    type: NOTIFICATION_TYPES.OFFER_DECISION,
    title: decision === 'accepted' ? 'Offer accepted' : 'Offer declined',
    description: `${pipeline.rpa_shortlisted_candidates?.candidate_name || 'A candidate'}${decision === 'accepted' && row.joining_date ? ` · joining ${row.joining_date.toISOString().slice(0, 10)}` : ''}`,
    pipelineId: pipeline.id,
    meta: { decision },
    excludeUserId: actedBy || null,
  });

  // An acceptance fills an opening — close the requisition once they all are,
  // which drops the role out of JD filtering. Never throws, so a closure
  // problem can't undo the acceptance that was just recorded.
  //
  // The reverse matters just as much: amending an acceptance back to 'rejected'
  // frees the opening again, so a requisition auto-closed on the strength of
  // that acceptance has to come back. Without this the role stayed invisible in
  // JD filtering exactly when it needed re-filling.
  let mrfClosure = null;
  let mrfReopen = null;
  if (decision === 'accepted') {
    mrfClosure = await closeMrfIfFilled(pipeline.mrf_id);
    if (mrfClosure.closed) {
      await auditNote(
        pipeline.id,
        `Requisition closed — all ${mrfClosure.openings} opening(s) filled`,
        actedBy
      );
    }
  } else if (reversal && previousDecision === 'accepted') {
    mrfReopen = await reopenMrfIfUnfilled(pipeline.mrf_id);
    if (mrfReopen.reopened) {
      await auditNote(
        pipeline.id,
        `Requisition re-opened — ${mrfReopen.accepted}/${mrfReopen.openings} opening(s) now filled`,
        actedBy
      );
    }
  }

  logger.info(`Offer decision recorded: pipeline ${pipelineId} → ${decision}.`);
  return { ...serialize(row), mrfClosure, mrfReopen };
}
