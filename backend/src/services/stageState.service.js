/**
 * stageState.service.js — per-stage state and the "started" lock for the
 * flexible stage movement feature
 * (docs/phase3/pipeline/FLEXIBLE-STAGE-MOVEMENT-DRAG-DROP-PLAN.md, C1/C2).
 *
 * The rules themselves are pure and live in utils/stageState.js. This module
 * only reads and writes the tables behind them.
 */
import prisma from '../config/database.js';
import { STAGE_KEYS, isZekoStage, normalizeZekoRoundStage } from '../config/pipelineStages.js';
import {
  deriveStageStates,
  resolveStageStates,
  stateRowStamps,
  computeStageLock,
} from '../utils/stageState.js';

/**
 * The state map for one journey (stage_key -> state; not-visited omitted).
 * Falls back to the event history for a journey with no rows.
 *
 * @param {{id: bigint, current_stage_key: string, current_stage_status: string}} pipeline
 * @param {object} [client] prisma or a transaction client
 * @param {object[]} [stages] every stage row, when the caller already has them
 */
export async function loadStageStates(pipeline, client = prisma, stages = null) {
  const rows = await client.rpa_pipeline_stage_state.findMany({
    where: { pipeline_id: BigInt(pipeline.id) },
    select: { stage_key: true, status: true },
  });
  if (rows.length) return resolveStageStates(rows, null, pipeline);
  const allStages = stages || await client.rpa_pipeline_stages.findMany({ orderBy: { sort_order: 'asc' } });
  const events = await client.rpa_pipeline_stage_events.findMany({
    where: { pipeline_id: BigInt(pipeline.id), event_type: 'outcome', outcome: 'approved' },
    select: { stage_key: true, event_type: true, outcome: true },
  });
  return resolveStageStates([], () => deriveStageStates({ stages: allStages, pipeline, events }), pipeline);
}

/**
 * Upserts state rows. Call inside the transaction that moves the journey, so
 * the state can never disagree with current_stage_key.
 *
 * @param {object} tx transaction client
 * @param {bigint|number} pipelineId
 * @param {{stageKey: string, status: string}[]} changes
 * @param {number|null} actedBy
 */
export async function writeStageStates(tx, pipelineId, changes, actedBy = null) {
  const now = new Date();
  for (const { stageKey, status } of changes) {
    if (!stageKey) continue;
    const data = { status, ...stateRowStamps(status, now), updated_at: now, updated_by: actedBy || null };
    await tx.rpa_pipeline_stage_state.upsert({
      where: { pipeline_id_stage_key: { pipeline_id: BigInt(pipelineId), stage_key: stageKey } },
      create: { pipeline_id: BigInt(pipelineId), stage_key: stageKey, ...data },
      update: data,
    });
  }
}

/**
 * Makes sure a journey has its state rows before a transition writes some, so
 * a journey created before the backfill keeps its history (the derived rows
 * are written first, then the transition overwrites what changed).
 * @param {object} tx
 * @param {{id: bigint, current_stage_key: string, current_stage_status: string}} pipeline
 */
export async function ensureStageStateRows(tx, pipeline) {
  const count = await tx.rpa_pipeline_stage_state.count({ where: { pipeline_id: BigInt(pipeline.id) } });
  if (count > 0) return;
  const states = await loadStageStates(pipeline, tx);
  const now = new Date();
  for (const [stageKey, status] of Object.entries(states)) {
    await tx.rpa_pipeline_stage_state.create({
      data: { pipeline_id: BigInt(pipeline.id), stage_key: stageKey, status, ...stateRowStamps(status, now), updated_at: now },
    });
  }
}

/**
 * Lock state for many journeys at once (the board) — the SAME rule the move
 * endpoint enforces, so the two can never disagree (§7 risk 3).
 *
 * @param {{id: bigint|number, shortlist_id?: number|null, current_stage_key: string, current_stage_status: string, final_outcome?: string|null, is_paused?: boolean}[]} journeys
 * @returns {Promise<Map<string, {locked: boolean, code: string|null, reason: string|null}>>} keyed by String(id)
 */
export async function getStageLocks(journeys) {
  const out = new Map();
  if (!journeys.length) return out;
  // 'approved' stays on the row when a stage was approved with nothing left to
  // land on; its activity (a shared offer, say) must still lock the card.
  const open = journeys.filter((j) => !j.final_outcome && !j.is_paused && ['in_progress', 'approved'].includes(j.current_stage_status));
  const ids = (pred) => open.filter(pred).map((j) => BigInt(j.id));

  const zekoJourneys = open.filter((j) => isZekoStage(j.current_stage_key) && j.shortlist_id);
  const assessmentIds = ids((j) => j.current_stage_key === STAGE_KEYS.ASSESSMENT);
  const documentIds = ids((j) => j.current_stage_key === STAGE_KEYS.DOCUMENTS);
  const offerIds = ids((j) => j.current_stage_key === STAGE_KEYS.OFFER);
  const allIds = open.map((j) => BigInt(j.id));

  const [zekoRows, bookings, invites, results, docRequests, offers] = await Promise.all([
    zekoJourneys.length
      ? prisma.rpa_zeko_candidate_pipeline.findMany({
          where: { candidate_id: { in: zekoJourneys.map((j) => j.shortlist_id) }, status: { not: 'cancelled' } },
          select: { candidate_id: true, stage: true, link_sent_at: true, interview_start_at: true },
        })
      : [],
    allIds.length
      ? prisma.rpa_interview_schedule.findMany({
          where: { pipeline_id: { in: allIds }, status: { not: 'cancelled' } },
          select: { pipeline_id: true, stage_key: true, scheduled_start_at: true },
          orderBy: { scheduled_start_at: 'desc' },
        })
      : [],
    assessmentIds.length
      ? prisma.rpa_assessment_invites.findMany({
          where: { pipeline_id: { in: assessmentIds } },
          select: { pipeline_id: true, sent_at: true, withdrawn_at: true },
          orderBy: { sent_at: 'desc' },
        })
      : [],
    assessmentIds.length
      ? prisma.rpa_assessment_results.findMany({
          where: { pipeline_id: { in: assessmentIds }, status: { in: ['matched', 'score_overwritten'] } },
          select: { pipeline_id: true },
        })
      : [],
    documentIds.length
      ? prisma.rpa_document_requests.findMany({
          where: { pipeline_id: { in: documentIds }, token_status: { not: 'closed' } },
          select: { pipeline_id: true, requested_at: true },
        })
      : [],
    offerIds.length
      ? prisma.rpa_offers.findMany({
          where: { pipeline_id: { in: offerIds }, shared_at: { not: null } },
          select: { pipeline_id: true, shared_at: true },
        })
      : [],
  ]);

  const firstBy = (rows, keyFn) => {
    const m = new Map();
    for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, r); }
    return m;
  };
  const zekoByRound = firstBy(
    zekoRows.filter((r) => r.link_sent_at || r.interview_start_at),
    (r) => `${r.candidate_id}:${r.stage}`
  );
  const bookingByStage = firstBy(bookings, (r) => `${r.pipeline_id}:${r.stage_key}`);
  const latestInvite = firstBy(invites, (r) => String(r.pipeline_id));
  const resultIds = new Set(results.map((r) => String(r.pipeline_id)));
  const docById = firstBy(docRequests, (r) => String(r.pipeline_id));
  const offerById = firstBy(offers, (r) => String(r.pipeline_id));

  for (const j of journeys) {
    const id = String(j.id);
    const invite = latestInvite.get(id);
    const signals = {
      zekoInvite: isZekoStage(j.current_stage_key)
        ? zekoByRound.get(`${j.shortlist_id}:${normalizeZekoRoundStage(j.current_stage_key)}`) || null
        : null,
      interview: bookingByStage.get(`${id}:${j.current_stage_key}`) || null,
      assessmentInvite: invite && !invite.withdrawn_at ? invite : null,
      assessmentResult: resultIds.has(id),
      documentRequest: docById.get(id) || null,
      offerShared: offerById.get(id) || null,
    };
    out.set(id, computeStageLock({ pipeline: j, signals }));
  }
  return out;
}

/**
 * Lock state for one journey.
 * @param {object} pipeline journey row
 */
export async function getStageLock(pipeline) {
  return (await getStageLocks([pipeline])).get(String(pipeline.id));
}
