import prisma from '../config/database.js';
import logger from '../config/logger.js';
import { mapCandidate } from './candidate.service.js';
import { Prisma } from '@prisma/client';

/**
 * Dashboard service.
 * Provides aggregate statistics and recent-activity data for the main dashboard.
 * Correctly aligns with legacy database column names.
 */

/**
 * Get summary statistics for the dashboard.
 * @returns {Promise<Object>} Stats object
 */
export async function getStats() {
  try {
    const [
      totalCandidates,
      activeMRFs,
      pendingApprovalMRFs,
      todayUploads,
      shortlistedCount,
      aiScreenedCount,
      hiredCount,
    ] = await Promise.all([
      // Total candidates in rpa_cv
      prisma.rpa_cv.count(),

      // Active MRFs (approval_status is 'pending', 'waiting', or 'approved',
      // and the openings are not all filled). The filled_at test used to be
      // implicit — closure overwrote approval_status to 'closed', which fell
      // out of this list for free. That write was lossy, so fill state now has
      // its own column and must be excluded explicitly.
      prisma.rpa_mrf.count({
        where: {
          approval_status: { in: ['pending', 'waiting', 'approved'] },
          filled_at: null,
        },
      }),

      // MRFs awaiting an APPROVAL decision.
      //
      // This exists because the dashboard was deriving "pending approval" from
      // `GET /api/mrf?status=pending&limit=50` and taking the array length. That was
      // wrong twice over:
      //   1. WRONG COLUMN. buildMrfWhere() maps `status=pending` onto `mrfstatus`
      //      (the manager's *submission* state: pending / pendingfromleader), not
      //      `approval_status`. So a row labelled "pending approval" was counting
      //      requisitions that had not yet been submitted. That is why the dashboard
      //      could show "Active MRFs 21" beside "50 pending approval" — the two
      //      numbers were reading different columns.
      //   2. TRUNCATED. `.length` of a page capped at limit=50 can never exceed 50,
      //      so the figure silently plateaus once there are 50+ matches.
      // Counting it here, next to activeMRFs and with the same filled_at exclusion,
      // keeps the two consistent by construction.
      prisma.rpa_mrf.count({
        where: {
          approval_status: 'pending',
          filled_at: null,
        },
      }),

      // CVs uploaded today
      prisma.rpa_cv.count({
        where: {
          createdAt: {
            gte: startOfToday(),
          },
        },
      }),

      // Total shortlisted candidates (pipeline_status matches shortlisted/selected)
      prisma.rpa_shortlisted_candidates.count({
        where: {
          pipeline_status: { 
            in: ['shortlisted', 'Shortlisted', 'selected', 'Selected'] 
          },
        },
      }),

      // AI Screened: candidates with AI profile insights
      prisma.rpa_cv.count({
        where: {
          ai_profile_insights: {
            not: Prisma.DbNull,
          },
        },
      }),

      // Hired: candidates with joined_at, offer_accepted_at or hired/joined status
      prisma.rpa_shortlisted_candidates.count({
        where: {
          OR: [
            { joined_at: { not: null } },
            { offer_accepted_at: { not: null } },
            { pipeline_status: { in: ['hired', 'Hired', 'joined', 'Joined', 'selected', 'Selected'] } }
          ],
        },
      }),
    ]);

    return {
      totalCandidates,
      activeMRFs,
      pendingApprovalMRFs,
      todayUploads,
      shortlisted: shortlistedCount, // Map to frontend expected key: 'shortlisted'
      funnel: {
        sourced: totalCandidates,
        aiScreened: aiScreenedCount,
        // ONE definition of "shortlisted" per screen.
        //
        // The funnel used to count "every shortlist row not explicitly rejected",
        // while the KPI card counted "pipeline_status is shortlisted/selected". Both
        // were labelled "Shortlisted" and rendered on the same dashboard, so the page
        // showed two different numbers for the same word (e.g. 74 in the KPI, 78 in
        // the funnel). The looser predicate also counted on-hold and in-progress rows
        // as shortlisted, which overstated the funnel.
        shortlisted: shortlistedCount,
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
 * Get the most recently uploaded candidates (mapped to recent uploads table).
 * @param {number} [limit=10] - Number of records to return
 * @returns {Promise<Array>} Mapped candidates
 */
export async function getRecentUploads(limit = 10) {
  try {
    const recentCandidates = await prisma.rpa_cv.findMany({
      orderBy: { createdAt: 'desc' },
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
 * @returns {Date} Start of the current day (00:00:00.000)
 */
function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Format date to simple relative time.
 * @param {Date|string} date 
 * @returns {string}
 */
function formatTimeAgo(date) {
  if (!date) return '';
  const now = new Date();
  const diffMs = now - new Date(date);
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'Yesterday';
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
