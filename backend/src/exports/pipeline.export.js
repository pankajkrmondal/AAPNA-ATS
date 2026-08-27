/**
 * Candidate Pipeline CSV export.
 *
 * The board renders CARDS, not a table, so these columns are designed rather
 * than copied off a screen. The card shows name / position / source / status /
 * days / concurrency; the export adds what a recruiter actually needs offline:
 * the latest outcome, its reason, who decided it and when.
 *
 * It runs its own query rather than reusing listPipeline() because:
 *   - listPipeline takes the last event of ANY type (`take: 1`), which is
 *     usually the "entered next stage" event, not the outcome that caused it;
 *   - the export needs the acting user's name, which listPipeline never joins.
 *
 * The board's own filter semantics ARE reused exactly (see buildPipelineWhere
 * and the in-memory position/stuckDays passes below) so the CSV never contains
 * rows the board deliberately hides — in particular closed journeys, which are
 * excluded unless `include_closed` is set.
 */
import prisma from '../config/database.js';
import { finalStatusLabelFor } from '../config/pipelineStages.js';

/** Matches the chips the board renders for current_stage_status. */
const STAGE_STATUS_LABEL = {
  in_progress: 'In Progress',
  hold: 'On Hold',
  approved: 'Approved',
  rejected: 'Rejected',
  skipped: 'Skipped',
};

/** Matches SOURCE_LABEL in frontend/src/pages/Pipeline.jsx. */
const SOURCE_LABEL = {
  recruiter: 'Recruiter',
  vendor: 'Vendor',
  screening_shortlist: 'Screening Shortlist',
  bulk_excel: 'Bulk Excel',
  email_intake: 'Email Intake',
};

/**
 * Same `where` the board builds (pipeline.service.js listPipeline).
 * Closed journeys stay hidden unless explicitly requested.
 */
export function buildPipelineWhere(filters = {}) {
  const where = {};
  if (filters.source) where.source = filters.source;
  if (filters.onHoldOnly) where.current_stage_status = 'hold';
  if (filters.rejectedOnly) where.current_stage_status = 'rejected';
  if (filters.mrfId) where.mrf_id = BigInt(filters.mrfId);
  if (filters.ownedByUsername) where.rpa_shortlisted_candidates = { shortlisted_by: filters.ownedByUsername };
  if (!filters.includeClosed) where.final_outcome = null;
  return where;
}

/**
 * Text of an outcome's reason.
 *
 * THE "OTHER" RULE (03-DEVELOPMENT-PLAN.md §M1, restated in the 2026-07-14
 * meeting notes): when a recruiter picks "Other" and types their own reason,
 * every surface must show the TYPED TEXT. The literal word "Other" must never
 * appear in a timeline, an export, or a FinalStatus write-back.
 */
export function outcomeReasonText(event) {
  if (!event) return '';
  if (event.rpa_outcome_reasons?.is_other) return event.reason_text || '';
  return event.rpa_outcome_reasons?.reason_label || event.reason_text || '';
}

/** The most recent decision event, ignoring "entered stage" bookkeeping rows. */
const latestOutcome = (journey) => journey.rpa_pipeline_stage_events?.[0] || null;

export const columns = [
  { header: 'Pipeline ID', key: 'id' },
  { header: 'Candidate Name', key: 'rpa_shortlisted_candidates.candidate_name' },
  { header: 'Candidate Email', key: 'rpa_shortlisted_candidates.candidate_email' },
  {
    header: 'Position / Role',
    value: (j) => j.rpa_shortlisted_candidates?.mrf?.position_hiring_for
      || j.rpa_shortlisted_candidates?.position_applied
      || '',
  },
  { header: 'MRF ID', key: 'mrf_id' },
  { header: 'Shortlisted By', value: (j) => j.rpa_shortlisted_candidates?.shortlisted_by || '' },
  // Labels, never the raw stage_key — the CSV must read like the board. The
  // label comes from rpa_pipeline_stages, which is admin-editable, so it is
  // resolved per-fetch rather than from a hardcoded map.
  { header: 'Current Stage', value: (j) => j._stageLabel },
  {
    header: 'Stage Status',
    value: (j) => STAGE_STATUS_LABEL[j.current_stage_status] || j.current_stage_status || '',
  },
  { header: 'Latest Outcome', value: (j) => latestOutcome(j)?.status_label || '' },
  { header: 'Outcome Reason', value: (j) => outcomeReasonText(latestOutcome(j)) },
  { header: 'Outcome Notes', value: (j) => latestOutcome(j)?.notes || '' },
  { header: 'Decided By', value: (j) => latestOutcome(j)?.rpa_users?.username || '' },
  { header: 'Decided On', value: (j) => latestOutcome(j)?.created_at || null, type: 'datetime' },
  {
    header: 'Final Outcome',
    value: (j) => (j.final_outcome ? finalStatusLabelFor(j.current_stage_key, j.final_outcome) : ''),
  },
  { header: 'Closed At', key: 'closed_at', type: 'datetime' },
  {
    header: 'Source',
    value: (j) => (j.source === 'vendor'
      ? (j.vendor_email || 'Vendor')
      : (SOURCE_LABEL[j.source] || j.source || '')),
  },
  { header: 'Vendor Email', key: 'vendor_email' },
  { header: 'Days In Stage', value: (j) => j._daysInStage, numeric: true },
  { header: 'Concurrent Journeys', value: (j) => j._concurrent, numeric: true },
  { header: 'Paused', key: 'is_paused' },
  { header: 'Entered Pipeline On', key: 'created_at', type: 'datetime' },
  { header: 'Last Updated', key: 'modified_at', type: 'datetime' },
];

/** Board filters arrive as snake_case query params. */
export function parseFilters(req) {
  const {
    position, source, on_hold_only: onHoldOnly, rejected_only: rejectedOnly, stuck_days: stuckDays,
    include_closed: includeClosed, mrf_id: mrfId, owned_by: ownedBy,
  } = req.query;

  return {
    position: position || undefined,
    source: source || undefined,
    onHoldOnly: onHoldOnly === 'true' || onHoldOnly === '1',
    rejectedOnly: rejectedOnly === 'true' || rejectedOnly === '1',
    stuckDays: stuckDays ? Number(stuckDays) : undefined,
    includeClosed: includeClosed === 'true' || includeClosed === '1',
    mrfId: mrfId || undefined,
    // Same server-side resolution as listPipeline — never trust a
    // client-supplied identity for "my candidates".
    ownedByUsername: ownedBy === 'me' ? req.user?.username : undefined,
  };
}

/** @type {import('./runExport.js').ExportSpec['fetch']} */
export async function fetch({ filters, max }) {
  // Stage labels are seeded and admin-editable, so read them rather than
  // hardcoding — the board does the same.
  const stages = await prisma.rpa_pipeline_stages.findMany({
    select: { stage_key: true, label: true },
  });
  const labelByKey = Object.fromEntries(stages.map((s) => [s.stage_key, s.label]));

  const journeys = await prisma.rpa_candidate_pipeline.findMany({
    where: buildPipelineWhere(filters),
    include: {
      rpa_shortlisted_candidates: {
        select: {
          candidate_name: true,
          candidate_email: true,
          position_applied: true,
          shortlisted_by: true,
          mrf: { select: { position_hiring_for: true } },
        },
      },
      // Only decision events — 'entered'/'note' rows would hide the outcome.
      rpa_pipeline_stage_events: {
        where: { event_type: 'outcome' },
        orderBy: { created_at: 'desc' },
        take: 1,
        include: {
          rpa_outcome_reasons: { select: { reason_label: true, is_other: true } },
          rpa_users: { select: { username: true } },
        },
      },
    },
    orderBy: { modified_at: 'desc' },
    take: max,
  });

  // Concurrency badge (Q13): active journeys sharing a candidate.
  const activeByCv = new Map();
  for (const j of journeys) {
    if (j.current_stage_status === 'in_progress' || j.current_stage_status === 'hold') {
      const key = String(j.cv_id);
      activeByCv.set(key, (activeByCv.get(key) || 0) + 1);
    }
  }

  const now = Date.now();
  const rows = journeys.map((j) => {
    const lastEvent = j.rpa_pipeline_stage_events[0];
    const since = lastEvent?.created_at || j.modified_at;
    return Object.assign(j, {
      _daysInStage: Math.floor((now - new Date(since).getTime()) / (1000 * 60 * 60 * 24)),
      _concurrent: activeByCv.get(String(j.cv_id)) || 1,
      _stageLabel: labelByKey[j.current_stage_key] || j.current_stage_key || '',
    });
  });

  // The board applies these two in memory after the query — mirror it, or the
  // CSV contains rows the user filtered away.
  let filtered = filters.stuckDays
    ? rows.filter((r) => r._daysInStage >= Number(filters.stuckDays))
    : rows;

  if (filters.position) {
    filtered = filtered.filter((r) => {
      const position = r.rpa_shortlisted_candidates?.mrf?.position_hiring_for
        || r.rpa_shortlisted_candidates?.position_applied
        || null;
      return position === filters.position;
    });
  }

  return filtered;
}

export default { columns, fetch, parseFilters, buildPipelineWhere, outcomeReasonText };
