import prisma from '../config/database.js';
import logger from '../config/logger.js';
import { mapCandidate } from './candidate.service.js';

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
      todayUploads,
      shortlistedCount,
    ] = await Promise.all([
      // Total candidates in rpa_cv
      prisma.rpa_cv.count(),

      // Active MRFs (approval_status is 'pending', 'waiting', or 'approved')
      prisma.rpa_mrf.count({
        where: {
          approval_status: { in: ['pending', 'waiting', 'approved'] },
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
    ]);

    return {
      totalCandidates,
      activeMRFs,
      todayUploads,
      shortlisted: shortlistedCount, // Map to frontend expected key: 'shortlisted'
    };
  } catch (error) {
    logger.error('Dashboard stats query failed', { error: error.message });
    return {
      totalCandidates: 0,
      activeMRFs: 0,
      todayUploads: 0,
      shortlisted: 0,
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
