import prisma from '../config/database.js';
import { fmtRelative } from '../utils/dateFormat.js';
import logger from '../config/logger.js';
import { mapCandidate } from './candidate.service.js';
import { Prisma } from '@prisma/client';
import { HIRED_OUTCOMES } from '../config/pipelineStages.js';
import { timeToHireFor } from './pipelineAnalytics.helpers.js';
import {
  DEFAULT_RANGE_DAYS, IST, changePct, fillDaily, istMidnight, mergeUpcoming, normaliseLabel, percentOf, periodBounds, talentTallies,
} from '../utils/dashboardMetrics.js';

/**
 * Dashboard service.
 * Provides aggregate statistics and recent-activity data for the main dashboard.
 * Correctly aligns with legacy database column names.
 */

/**
 * Who counts as what (N36) — one rule shared with Recruitment Analytics:
 *   - Shortlisted (KPI) = journeys still open in the pipeline (no final outcome).
 *   - Entered pipeline (funnel) = every journey ever started.
 *   - Hired = journeys closed with an outcome in HIRED_OUTCOMES (approved / joined),
 *     the same rule as Analytics' bucketFor().
 * The old counts read rpa_shortlisted_candidates.pipeline_status and offer
 * dates, so the dashboard and Analytics disagreed on the same word.
 */
const OPEN_JOURNEY = { final_outcome: null };
const HIRED_JOURNEY = { final_outcome: { in: [...HIRED_OUTCOMES] } };

/** "Created inside [from, to)" for rpa_cv."createdAt" (a UTC timestamp without zone). */
const cvCreatedBetween = (from, to) => Prisma.sql`("createdAt" AT TIME ZONE 'UTC') >= ${from}::timestamptz AND ("createdAt" AT TIME ZONE 'UTC') < ${to}::timestamptz`;
/** rpa_cv."createdAt" as an India-time calendar day. */
const CV_IST_DAY = Prisma.sql`(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${IST})::date`;
/** A text column lower-cased and single-spaced, to match normaliseLabel(). */
const normalisedSql = (column) => Prisma.sql`lower(regexp_replace(btrim(${Prisma.raw(column)}), '\\s+', ' ', 'g'))`;
/** Candidates whose typed "Position Applied" matches a role (the MRF link before JD tagging, N13). */
const positionMatches = (roleKey) => Prisma.sql`${normalisedSql('"PositionApplied"')} = ${roleKey}`;
/**
 * An rpa_cv row linked to the MRF: tagged to it (uploaded for / shortlisted
 * to it, N13) or, for candidates from before tagging, a matching "Position
 * Applied". Used inside a query FROM rpa_cv.
 */
const cvLinkedToMrf = (mrf) => Prisma.sql`(EXISTS (
  SELECT 1 FROM rpa_candidate_mrf_tags t WHERE t.cv_id = rpa_cv.id AND t.mrf_id = ${mrf.id}
) OR ${positionMatches(mrf.roleKey)})`;
/** A moment just past now, so rows written this second are inside [from, until). */
const justAfter = (now) => new Date(now.getTime() + 60_000);

/**
 * The MRF picked in the dashboard filter, with its role normalised for the
 * interim "Position Applied" match. Null when none is picked or it doesn't exist.
 */
async function resolveMrfFilter(mrfId) {
  if (!mrfId) return null;
  const mrf = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { id: true, position_hiring_for: true } });
  if (!mrf) return null;
  return { id: mrf.id, role: mrf.position_hiring_for || '', roleKey: normaliseLabel(mrf.position_hiring_for) };
}

/** Candidates added in [from, to), optionally only those linked to the MRF (cvLinkedToMrf). */
async function countCvAdded(from, to, mrf) {
  const roleCond = mrf ? Prisma.sql`AND ${cvLinkedToMrf(mrf)}` : Prisma.empty;
  const [row] = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM rpa_cv WHERE ${cvCreatedBetween(from, to)} ${roleCond}`;
  return row?.n || 0;
}

/**
 * Get summary statistics for the dashboard.
 *
 * Headline numbers are lifetime figures; `period` holds the figures for the
 * selected range. An MRF narrows the pipeline figures (Shortlisted, entered in
 * the period) by MRF id, and the "added" figure to candidates tagged to it (N13)
 * or, from before tagging, whose Position Applied matches. The funnel stays
 * all-roles so its stages are one population.
 *
 * @param {{ rangeDays?: number, mrfId?: bigint|null }} [params]
 * @returns {Promise<Object>} Stats object
 */
export async function getStats({ rangeDays = DEFAULT_RANGE_DAYS, mrfId = null } = {}) {
  try {
    const now = new Date();
    const { start } = periodBounds(rangeDays, now);
    const mrf = await resolveMrfFilter(mrfId);
    const mrfWhere = mrf ? { mrf_id: mrf.id } : {};

    const [
      totalCandidates,
      activeMRFs,
      pendingApprovalMRFs,
      todayUploads,
      shortlistedCount,
      aiScreenedCount,
      hiredCount,
      enteredPipelineCount,
      addedInRange,
      enteredInRange,
      hiredJourneys,
    ] = await Promise.all([
      // Total candidates in rpa_cv
      prisma.rpa_cv.count(),

      // Active MRFs (approval_status is 'pending', 'waiting', or 'approved',
      // and the requisition is still hiring). The filled_at test used to be
      // implicit — closure overwrote approval_status to 'closed', which fell
      // out of this list for free. That write was lossy, so fill state now has
      // its own column and must be excluded explicitly. closed_at (Q34, closed
      // by the business) is excluded too, as the JD dropdown does (N36).
      prisma.rpa_mrf.count({
        where: {
          approval_status: { in: ['pending', 'waiting', 'approved'] },
          filled_at: null,
          closed_at: null,
        },
      }),

      // MRFs awaiting an APPROVAL decision.
      //
      // This exists because the dashboard was deriving "pending approval" from
      // `GET /api/mrf?status=pending&limit=50` and taking the array length. That was
      // wrong twice over:
      //   1. WRONG COLUMN. buildMrfWhere() maps `status=pending` onto `mrfstatus`
      //      (the manager's *submission* state: pending / pendingfromleader), not
      //      `approval_status`.
      //   2. TRUNCATED. `.length` of a page capped at limit=50 can never exceed 50.
      // Counting it here, next to activeMRFs and with the same exclusions,
      // keeps the two consistent by construction.
      prisma.rpa_mrf.count({
        where: {
          approval_status: 'pending',
          filled_at: null,
          closed_at: null,
        },
      }),

      // CVs uploaded since India-time midnight (was the server's local midnight).
      countCvAdded(istMidnight(now), justAfter(now), null),

      prisma.rpa_candidate_pipeline.count({ where: { ...OPEN_JOURNEY, ...mrfWhere } }),

      // AI Screened: candidates with AI profile insights
      prisma.rpa_cv.count({
        where: {
          ai_profile_insights: {
            not: Prisma.DbNull,
          },
        },
      }),

      prisma.rpa_candidate_pipeline.count({ where: HIRED_JOURNEY }),
      prisma.rpa_candidate_pipeline.count(),

      countCvAdded(start, justAfter(now), mrf),
      prisma.rpa_candidate_pipeline.count({ where: { created_at: { gte: start }, ...mrfWhere } }),

      // Median time-to-hire, measured as Analytics does (timeToHireFor).
      prisma.rpa_candidate_pipeline.findMany({
        where: HIRED_JOURNEY,
        select: { created_at: true, closed_at: true, modified_at: true, final_outcome: true, current_stage_status: true },
      }),
    ]);

    return {
      totalCandidates,
      activeMRFs,
      pendingApprovalMRFs,
      todayUploads,
      shortlisted: shortlistedCount,
      hired: hiredCount,
      mrf: mrf ? { id: Number(mrf.id), role: mrf.role } : null,
      period: {
        rangeDays,
        from: start,
        added: addedInRange,
        enteredPipeline: enteredInRange,
        // Shortlist rate = entered the pipeline in the period ÷ added in the period.
        shortlistRate: percentOf(enteredInRange, addedInRange),
      },
      timeToHireDays: timeToHireFor(hiredJourneys, []).median_days,
      funnel: {
        sourced: totalCandidates,
        aiScreened: aiScreenedCount,
        // Every journey ever started: open ones alone would leave Hired
        // outside its own parent stage.
        shortlisted: enteredPipelineCount,
        hired: hiredCount,
      },
    };
  } catch (error) {
    logger.error('Dashboard stats query failed', { error: error.message });
    return {
      totalCandidates: 0,
      activeMRFs: 0,
      pendingApprovalMRFs: 0,
      todayUploads: 0,
      shortlisted: 0,
      hired: 0,
      mrf: null,
      period: { rangeDays, from: null, added: 0, enteredPipeline: 0, shortlistRate: null },
      timeToHireDays: null,
      funnel: {
        sourced: 0,
        aiScreened: 0,
        shortlisted: 0,
        hired: 0,
      },
    };
  }
}

/**
 * Daily series and talent tallies for the selected period (N36), counted in
 * SQL over every candidate — the browser used to aggregate only the newest 200.
 *
 *   - added: candidates added per India-time day (+ the period before, for the delta)
 *   - enteredPipeline: journeys started per day
 *   - mrfsRaised: requisitions raised per day
 *   - topRoles / topSkills: over candidates added in the period
 *
 * With an MRF picked, journeys are matched by MRF id; candidates and MRFs by
 * JD tag or, before tagging, role text (cvLinkedToMrf); MRFs by role text —
 * `matchedBy` says so.
 *
 * @param {{ rangeDays?: number, mrfId?: bigint|null }} [params]
 */
export async function getTrends({ rangeDays = DEFAULT_RANGE_DAYS, mrfId = null } = {}) {
  const now = new Date();
  const { start, previousStart } = periodBounds(rangeDays, now);
  const until = justAfter(now);
  const mrf = await resolveMrfFilter(mrfId);
  const roleCond = mrf ? Prisma.sql`AND ${cvLinkedToMrf(mrf)}` : Prisma.empty;
  const journeyMrfCond = mrf ? Prisma.sql`AND mrf_id = ${mrf.id}` : Prisma.empty;
  const mrfRoleCond = mrf ? Prisma.sql`AND ${normalisedSql('position_hiring_for')} = ${mrf.roleKey}` : Prisma.empty;

  const [addedRows, previousAdded, journeyRows, mrfRows, talentRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT ${CV_IST_DAY}::text AS day, COUNT(*)::int AS count
      FROM rpa_cv WHERE ${cvCreatedBetween(start, until)} ${roleCond}
      GROUP BY 1`,
    countCvAdded(previousStart, start, mrf),
    prisma.$queryRaw`
      SELECT (created_at AT TIME ZONE ${IST})::date::text AS day, COUNT(*)::int AS count
      FROM rpa_candidate_pipeline WHERE created_at >= ${start}::timestamptz ${journeyMrfCond}
      GROUP BY 1`,
    prisma.$queryRaw`
      SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${IST})::date::text AS day, COUNT(*)::int AS count
      FROM rpa_mrf WHERE (created_at AT TIME ZONE 'UTC') >= ${start}::timestamptz ${mrfRoleCond}
      GROUP BY 1`,
    prisma.$queryRaw`
      SELECT "PositionApplied", "Top5KeySkills"
      FROM rpa_cv WHERE ${cvCreatedBetween(start, until)} ${roleCond}`,
  ]);

  const added = fillDaily(addedRows, rangeDays, now);
  const enteredPipeline = fillDaily(journeyRows, rangeDays, now);
  const mrfsRaised = fillDaily(mrfRows, rangeDays, now);
  const sum = (series) => series.reduce((a, d) => a + d.count, 0);
  const addedTotal = sum(added);

  return {
    rangeDays,
    from: start,
    mrf: mrf ? { id: Number(mrf.id), role: mrf.role } : null,
    matchedBy: mrf ? 'jd_tag_or_position_applied' : null,
    added: {
      daily: added,
      total: addedTotal,
      previousTotal: previousAdded,
      deltaPct: changePct(addedTotal, previousAdded),
    },
    enteredPipeline: { daily: enteredPipeline, total: sum(enteredPipeline) },
    mrfsRaised: { daily: mrfsRaised, total: sum(mrfsRaised) },
    ...talentTallies(talentRows),
  };
}

/**
 * Zeko interview windows and Teams interviews in the next `days` days (N36).
 * The widget used to show Zeko only and opened Analytics; each row now carries
 * the ATS pipeline id so it can open that candidate on the board.
 */
export async function getUpcomingInterviews({ days = 7, limit = 20 } = {}) {
  const now = new Date();
  const horizon = new Date(now.getTime() + Math.min(Math.max(days, 1), 31) * 24 * 60 * 60 * 1000);
  const candidateSelect = { candidate_name: true, position_applied: true, mrf: { select: { position_hiring_for: true } } };

  const [zekoRows, teamsRows] = await Promise.all([
    prisma.rpa_zeko_candidate_pipeline.findMany({
      where: {
        interview_start_at: { gte: now, lte: horizon },
        status: { not: 'cancelled' },
        cancelled_at: null,
      },
      select: {
        id: true,
        stage: true,
        interview_start_at: true,
        candidate_id: true,
        rpa_shortlisted_candidates: { select: candidateSelect },
      },
      orderBy: { interview_start_at: 'asc' },
      take: limit,
    }),
    prisma.rpa_interview_schedule.findMany({
      where: {
        scheduled_start_at: { gte: now, lte: horizon },
        status: { not: 'cancelled' },
        cancelled_at: null,
      },
      select: {
        id: true,
        pipeline_id: true,
        scheduled_start_at: true,
        rpa_pipeline_stages: { select: { label: true } },
        rpa_candidate_pipeline: { select: { rpa_shortlisted_candidates: { select: candidateSelect } } },
      },
      orderBy: { scheduled_start_at: 'asc' },
      take: limit,
    }),
  ]);

  // Zeko rows are keyed by shortlist id; find each one's ATS journey (open first, then newest).
  const shortlistIds = [...new Set(zekoRows.map((z) => z.candidate_id))];
  const journeys = shortlistIds.length
    ? await prisma.rpa_candidate_pipeline.findMany({
        where: { shortlist_id: { in: shortlistIds } },
        select: { id: true, shortlist_id: true, final_outcome: true },
        orderBy: { created_at: 'desc' },
      })
    : [];
  const journeyByShortlist = new Map();
  for (const j of journeys) {
    const key = String(j.shortlist_id);
    const seen = journeyByShortlist.get(key);
    if (!seen || (seen.final_outcome && !j.final_outcome)) journeyByShortlist.set(key, j);
  }

  const roleOf = (sc) => sc?.mrf?.position_hiring_for || sc?.position_applied || null;
  return mergeUpcoming({
    zeko: zekoRows.map((z) => {
      const journey = journeyByShortlist.get(String(z.candidate_id));
      return {
        id: z.id,
        stage: z.stage,
        startAt: z.interview_start_at,
        pipelineId: journey ? Number(journey.id) : null,
        candidateName: z.rpa_shortlisted_candidates?.candidate_name,
        role: roleOf(z.rpa_shortlisted_candidates),
      };
    }),
    teams: teamsRows.map((t) => ({
      id: t.id,
      startAt: t.scheduled_start_at,
      pipelineId: Number(t.pipeline_id),
      round: t.rpa_pipeline_stages?.label,
      candidateName: t.rpa_candidate_pipeline?.rpa_shortlisted_candidates?.candidate_name,
      role: roleOf(t.rpa_candidate_pipeline?.rpa_shortlisted_candidates),
    })),
  }).slice(0, limit);
}

/**
 * Get the most recently uploaded candidates (mapped to recent uploads table).
 * @param {number} [limit=10] - Number of records to return
 * @returns {Promise<Array>} Mapped candidates
 */
export async function getRecentUploads(limit = 10) {
  try {
    const recentCandidates = await prisma.rpa_cv.findMany({
      // Undated legacy rows sort FIRST under a plain DESC in Postgres, which
      // listed them as the newest uploads (N36).
      orderBy: [{ createdAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: limit,
    });

    return recentCandidates.map(c => {
      const mapped = mapCandidate(c);
      return {
        key: mapped.id,
        name: mapped.name,
        email: mapped.email,
        position: mapped.position,
        status: mapped.status,
        score: mapped.score,
        uploadedAt: formatTimeAgo(mapped.createdAt),
      };
    });
  } catch (error) {
    logger.error('Recent uploads query failed', { error: error.message });
    return [];
  }
}

/**
 * Per-recruiter breakdown: how many candidates each recruiter ADDED (uploaded —
 * rpa_cv.last_action_by, an email) vs SHORTLISTED to a role —
 * rpa_shortlisted_candidates.shortlisted_by, a username), merged into ONE row
 * per person instead of two separate rankings. (Named "Shortlisted", not
 * "Tagged" — "Tag to Open JD" refers to picking a role during both Shortlist
 * *and* Reject, so "Tagged" would misleadingly imply rejects count too; this
 * metric excludes pipeline_status = 'rejected'. It counts everything else,
 * including the terminal closure statuses, because shortlisting someone who
 * went on to be hired is the credit this table exists to show.)
 *
 * last_action_by and shortlisted_by use different identity formats (email vs.
 * username) for what's often the same person, so each raw value is resolved
 * against rpa_users (matching email → last_action_by, username → shortlisted_by)
 * to get a real display name and a stable join key — that's what lets the two
 * counts land on the same row instead of reading as unrelated people. Values
 * that don't match any user account (e.g. "Self Applied", or a blank/legacy
 * last_action_by) fall back to that raw label as both the name and the key.
 *
 * @param {number} [limit=10]
 * @returns {Promise<Array<{ recruiter: string, added: number, shortlisted: number }>>}
 */
export async function getRecruiterBreakdown(limit = 10) {
  try {
    const [addedGrouped, shortlistedGrouped, users] = await Promise.all([
      prisma.rpa_cv.groupBy({
        by: ['last_action_by'],
        _count: { _all: true },
      }),
      prisma.rpa_shortlisted_candidates.groupBy({
        by: ['shortlisted_by'],
        // Exclude rows that only exist due to a reject() stamp — the intent has
        // always been "not a rejection", but an equality test was the wrong
        // instrument for it. From 2026-08-26 setFinalOutcome writes terminal
        // statuses here ('hired', 'withdrawn', …; audit §2.4), and under the old
        // `=== 'shortlisted'` test a recruiter's score DROPPED at the moment
        // their candidate was hired — the metric deducted credit for success.
        where: { pipeline_status: { not: 'rejected' } },
        _count: { _all: true },
      }),
      prisma.rpa_users.findMany({
        select: { id: true, username: true, email: true, first_name: true, last_name: true },
      }),
    ]);

    const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u]));
    const byUsername = new Map(users.filter((u) => u.username).map((u) => [u.username.toLowerCase(), u]));
    const displayName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username || u.email;

    const combined = new Map(); // key -> { recruiter, added, shortlisted }
    const resolve = (raw, lookup) => {
      const trimmed = (raw || '').trim();
      if (!trimmed) return { key: 'raw:Unattributed', name: 'Unattributed' };
      const user = lookup.get(trimmed.toLowerCase());
      return user ? { key: `user:${user.id}`, name: displayName(user) } : { key: `raw:${trimmed}`, name: trimmed };
    };

    for (const r of addedGrouped) {
      const { key, name } = resolve(r.last_action_by, byEmail);
      const entry = combined.get(key) || { recruiter: name, added: 0, shortlisted: 0 };
      entry.added += r._count._all;
      combined.set(key, entry);
    }
    for (const r of shortlistedGrouped) {
      const { key, name } = resolve(r.shortlisted_by, byUsername);
      const entry = combined.get(key) || { recruiter: name, added: 0, shortlisted: 0 };
      entry.shortlisted += r._count._all;
      combined.set(key, entry);
    }

    return [...combined.values()]
      .sort((a, b) => (b.added + b.shortlisted) - (a.added + a.shortlisted))
      .slice(0, limit);
  } catch (error) {
    logger.error('Dashboard recruiter breakdown query failed', { error: error.message });
    return [];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Format date to simple relative time.
 * @param {Date|string} date 
 * @returns {string}
 */
function formatTimeAgo(date) {
  return fmtRelative(date);
}
