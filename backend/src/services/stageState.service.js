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
  stageActorsFromEvents,
  redoVisitStart,
  inVisit,
} from '../utils/stageState.js';

// ── Re-do visits (L02-C) ────────────────────────────────────────────────

/**
 * When the current visit to one stage started, if it is a re-do; else null.
 * Everything that reads a stage's bookings / results / invites passes this
 * as `since`, so an earlier attempt neither locks the stage nor counts as its
 * score. First visits are never time-scoped (see redoVisitStart).
 * @param {bigint|number|string} pipelineId
 * @param {string} stageKey
 * @param {object} [client]
 * @returns {Promise<Date|null>}
 */
export async function stageVisitStart(pipelineId, stageKey, client = prisma) {
  if (!pipelineId || !stageKey) return null;
  const row = await client.rpa_pipeline_stage_state.findUnique({
    where: { pipeline_id_stage_key: { pipeline_id: BigInt(pipelineId), stage_key: stageKey } },
    select: { entered_at: true, completed_at: true },
  });
  return redoVisitStart(row);
}

/**
 * Re-do visit starts for many journeys' CURRENT stages (the board, the lock).
 * @param {{id: bigint|number, current_stage_key: string}[]} journeys
 * @returns {Promise<Map<string, Date>>} String(journey id) -> start; first visits absent
 */
export async function redoVisitStarts(journeys) {
  const out = new Map();
  if (!journeys.length) return out;
  const rows = await prisma.rpa_pipeline_stage_state.findMany({
    where: {
      pipeline_id: { in: journeys.map((j) => BigInt(j.id)) },
      completed_at: { not: null },
    },
    select: { pipeline_id: true, stage_key: true, entered_at: true, completed_at: true },
  });
  const current = new Map(journeys.map((j) => [String(j.id), j.current_stage_key]));
  for (const r of rows) {
    if (current.get(String(r.pipeline_id)) !== r.stage_key) continue;
    const start = redoVisitStart(r);
    if (start) out.set(String(r.pipeline_id), start);
  }
  return out;
}

/**
 * Every stage of one journey that is being (or was last) re-done: stage_key ->
 * when that visit started. The drawer splits each such stage's bookings,
 * scorecards and results into "this attempt" and "earlier attempt".
 * @param {bigint|number|string} pipelineId
 * @returns {Promise<Record<string, Date>>}
 */
export async function redoVisitsFor(pipelineId) {
  const rows = await prisma.rpa_pipeline_stage_state.findMany({
    where: { pipeline_id: BigInt(pipelineId), completed_at: { not: null } },
    select: { stage_key: true, entered_at: true, completed_at: true },
  });
  const out = {};
  for (const r of rows) {
    const start = redoVisitStart(r);
    if (start) out[r.stage_key] = start;
  }
  // A re-done stage that has been approved again: completed_at moved past
  // entered_at, so redoVisitStart says "no re-do". Its earlier attempt is
  // still history; the 'moved' re-do event marks when the latest attempt began.
  const redoMoves = await prisma.rpa_pipeline_stage_events.findMany({
    where: { pipeline_id: BigInt(pipelineId), event_type: 'moved', notes: { endsWith: 'to re-do it' } },
    select: { stage_key: true, created_at: true },
    orderBy: { created_at: 'desc' },
  });
  for (const m of redoMoves) {
    if (!out[m.stage_key]) out[m.stage_key] = m.created_at;
  }
  return out;
}

/**
 * The stage a re-done stage's Approve goes back to: the stage the candidate was
 * moved FROM when the re-do started. Null on a first visit.
 * @param {{id: bigint|number, current_stage_key: string}} pipeline
 */
export async function redoReturnStageKey(pipeline) {
  const since = await stageVisitStart(pipeline.id, pipeline.current_stage_key);
  if (!since) return null;
  const move = await prisma.rpa_pipeline_stage_events.findFirst({
    where: {
      pipeline_id: BigInt(pipeline.id),
      stage_key: pipeline.current_stage_key,
      event_type: 'moved',
      notes: { endsWith: 'to re-do it' },
    },
    orderBy: { created_at: 'desc' },
    select: { from_stage_key: true },
  });
  return move?.from_stage_key || null;
}

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
  // The rows are history, so they carry whoever acted on that stage then —
  // not the user whose action triggered this catch-up.
  const events = await tx.rpa_pipeline_stage_events.findMany({
    where: { pipeline_id: BigInt(pipeline.id), acted_by: { not: null } },
    select: { stage_key: true, event_type: true, outcome: true, acted_by: true, created_at: true },
  });
  const actors = stageActorsFromEvents(states, events);
  const now = new Date();
  for (const [stageKey, status] of Object.entries(states)) {
    await tx.rpa_pipeline_stage_state.create({
      data: {
        pipeline_id: BigInt(pipeline.id), stage_key: stageKey, status, ...stateRowStamps(status, now),
        updated_at: now, updated_by: actors[stageKey] ?? null,
      },
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
  // L02-C: on a re-done stage only the current attempt's activity locks it.
  const visitStarts = await redoVisitStarts(open);

  const [zekoRows, bookings, invites, results, docRequests, offers] = await Promise.all([
    zekoJourneys.length
      ? prisma.rpa_zeko_candidate_pipeline.findMany({
          where: { candidate_id: { in: zekoJourneys.map((j) => j.shortlist_id) }, status: { not: 'cancelled' } },
          select: { candidate_id: true, stage: true, link_sent_at: true, interview_start_at: true, created_at: true },
          orderBy: { created_at: 'desc' },
        })
      : [],
    allIds.length
      ? prisma.rpa_interview_schedule.findMany({
          // superseded_at: bookings of an earlier attempt of a re-done stage (L02-C).
          where: { pipeline_id: { in: allIds }, status: { not: 'cancelled' }, superseded_at: null },
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
          select: { pipeline_id: true, created_at: true },
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
  // A Zeko row belongs to the shortlist, not the journey: map it back to the
  // journey so its re-do start can be applied.
  const journeyByShortlist = new Map(zekoJourneys.map((j) => [String(j.shortlist_id), String(j.id)]));
  const sinceOf = (journeyId) => visitStarts.get(String(journeyId)) || null;
  const zekoByRound = firstBy(
    zekoRows.filter((r) => (r.link_sent_at || r.interview_start_at)
      && inVisit(r.created_at, sinceOf(journeyByShortlist.get(String(r.candidate_id))))),
    (r) => `${r.candidate_id}:${r.stage}`
  );
  const bookingByStage = firstBy(bookings, (r) => `${r.pipeline_id}:${r.stage_key}`);
  const latestInvite = firstBy(
    invites.filter((r) => inVisit(r.sent_at, sinceOf(r.pipeline_id))),
    (r) => String(r.pipeline_id),
  );
  const resultIds = new Set(results
    .filter((r) => inVisit(r.created_at, sinceOf(r.pipeline_id)))
    .map((r) => String(r.pipeline_id)));
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
