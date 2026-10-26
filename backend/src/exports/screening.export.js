/**
 * Candidate Screening CSV exports — the JD-filtering tab, the keyword tab, and
 * the Analytics "Role Summary" table.
 *
 * The screening results are CARDS on screen, so the columns here are designed:
 * the candidate's details, then the match score and the per-dimension
 * breakdown the drawer shows, which is the whole reason to export screening
 * results rather than plain candidates.
 *
 * SECURITY: the export always RE-RUNS the search server-side and never accepts
 * a list of candidate ids from the client. Accepting ids would be an
 * exfiltration path — any authenticated user could name arbitrary rpa_cv ids
 * and receive their full profiles, bypassing every screening filter.
 *
 * The JD search is re-run with force=false so it hits the Redis cache the
 * on-screen search just wrote, which makes the CSV match the screen. If that
 * cache has expired (1h TTL) the search recomputes and the row set can shift
 * slightly — unavoidable without accepting client state, and preferable to the
 * alternative.
 */
import { groupByMrf } from '../utils/roleSummary.js';
import { parseAnalyticsRange, rangeFileTag } from '../utils/analyticsRange.js';
import { getRoleSummary } from '../services/openPositions.service.js';
import * as screeningService from '../services/screening.service.js';
import * as screeningV2 from '../services/screeningV2.service.js';
import config from '../config/index.js';

/**
 * Whichever rating object this candidate shape carries: JD rows carry
 * starRating, keyword rows carry relevanceScore. Keyword rows used to fall
 * through to {} here, which is why the keyword CSV's rating columns were blank
 * (Phase 3 N06).
 */
const rating = (c) => c.starRating || c.relevanceScore || c.rating || {};
/** One deterministic sub-score from the rating breakdown (JD uses `score`, keyword `pts`). */
const subScore = (c, key) => {
  const item = rating(c).breakdown?.[key];
  return item?.score ?? item?.pts ?? '';
};

/** Top5KeySkills is stored as JSON text or a loose comma list. */
function parseSkills(raw) {
  if (!raw) return '';
  if (Array.isArray(raw)) return raw.join('; ');
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.join('; ');
  } catch {
    // Not JSON — fall through to the loose form.
  }
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean).join('; ');
}

/** CurrentCompany is JSON ({ Name: … }) on some rows and plain text on others. */
function currentCompanyName(raw) {
  if (!raw) return '';
  if (typeof raw === 'object') return raw.Name || '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed.Name || '';
  } catch {
    // Not JSON — it is already the company name.
  }
  return String(raw);
}

/** Mandatory skills matching `predicate`, as a readable list. */
function skillsBy(candidate, predicate) {
  const mandatory = candidate.jdSkillSignals?.mandatory || [];
  return mandatory.filter(predicate).map((s) => s.skill).join('; ');
}

export const columns = [
  { header: 'Candidate ID', key: 'id' },
  { header: 'Name', key: 'Name' },
  { header: 'Email', key: 'EmailID' },
  { header: 'Contact Number', key: 'ContactNumber' },
  { header: 'Current Company', value: (c) => currentCompanyName(c.CurrentCompany) },
  { header: 'Current Location', key: 'CurrentLocation' },
  { header: 'Total Experience (Years)', key: 'TotalExperienceYears' },
  { header: 'Last Company Experience (Years)', key: 'LastCompanyExperienceYears' },
  { header: 'Current CTC (LPA)', key: 'CTC_LPA', numeric: true },
  { header: 'Expected CTC (LPA)', key: 'ExpectedCTC_LPA', numeric: true },
  { header: 'Notice Period', key: 'NoticePeriod' },
  { header: 'Highest Qualification', key: 'HighestQualification' },
  { header: 'Graduation Degree', key: 'graduationdegree' },
  { header: 'Top 5 Key Skills', value: (c) => parseSkills(c.Top5KeySkills) },

  // The match itself — the reason this export exists rather than /candidates.
  {
    header: 'Match Score',
    value: (c) => rating(c).avgScore ?? rating(c).finalScore ?? '',
    numeric: true,
  },
  { header: 'Stars', value: (c) => rating(c).stars ?? '', numeric: true },
  { header: 'Fit Verdict', value: (c) => rating(c).label || '' },
  { header: 'Scoring Mode', value: (c) => rating(c).mode || '' },
  { header: 'Score — Total Experience', value: (c) => subScore(c, 'totalExperience'), numeric: true },
  { header: 'Score — Relevant Experience', value: (c) => subScore(c, 'relevantExperience'), numeric: true },
  { header: 'Score — Job Stability', value: (c) => subScore(c, 'jobStability'), numeric: true },
  { header: 'Score — Education', value: (c) => subScore(c, 'education'), numeric: true },
  { header: 'Score — Communication', value: (c) => subScore(c, 'communication'), numeric: true },
  { header: 'Score — JD Matching', value: (c) => subScore(c, 'jdMatching'), numeric: true },
  { header: 'Score — Skill Match (Keyword)', value: (c) => subScore(c, 'skillMatch'), numeric: true },
  { header: 'Score — CTC Alignment', value: (c) => subScore(c, 'ctcAlignment'), numeric: true },
  { header: 'Score — Availability', value: (c) => subScore(c, 'availability'), numeric: true },
  {
    header: 'JD Matching Reason',
    value: (c) => rating(c).breakdown?.jdMatching?.reason || rating(c).breakdown?.skillMatch?.reason || '',
  },
  {
    header: 'Mandatory Skills Present',
    value: (c) => skillsBy(c, (s) => s.inSignals || s.inSkillsSection),
  },
  {
    header: 'Mandatory Skills Missing',
    value: (c) => skillsBy(c, (s) => s.status === 'missing'),
  },

  // L01: Active / Pending response / New applicant / Inactive, and why.
  { header: 'Activity Status', value: (c) => c.activity?.label || '' },
  { header: 'Activity Detail', value: (c) => c.activity?.detail || '' },
  { header: 'Details Requested On', key: 'details_requested_at', type: 'date' },
  { header: 'Details Submitted On', key: 'details_completed_at', type: 'date' },

  { header: 'Current Status', key: 'FinalStatus' },
  { header: 'Shortlisted By', key: 'shortlisted_by' },
  { header: 'Shortlisted On', key: 'shortlisted_at', type: 'date' },
  { header: 'Rejected By', key: 'rejected_by' },
  { header: 'Rejected On', key: 'rejected_at', type: 'date' },
  { header: 'Vendor Email', key: 'VendorEmail' },
  { header: 'Resume URL', key: 'cvFileUrl' },
];

/**
 * JD-filtering tab: re-run the role search for one MRF.
 * @param {number} mrfId
 * @param {{ addedWithinDays?: number|null, taggedOnly?: boolean }} [opts] the screen's
 *   "Added within" filter (N38) and "Tagged to this JD only" switch (N15)
 */
export function roleSpec(mrfId, { addedWithinDays = null, taggedOnly = false, activeFirst = true } = {}) {
  return {
    key: 'screening_jd',
    label: `Screening-MRF-${mrfId}`,
    columns,
    filters: { mrfId, addedWithinDays, taggedOnly, activeFirst },
    fetch: async ({ max }) => {
      // force=false: read the cache the on-screen search just populated so the
      // CSV matches what the recruiter is looking at — the same "Added within"
      // value (and "Active candidates first", L01) picks the same cache entry.
      const opts = { addedWithinDays, taggedOnly, activeFirst };
      const result = config.screening.v2
        ? await screeningV2.searchRoleCandidatesV2(mrfId, false, opts)
        : await screeningService.searchRoleCandidates(mrfId, false, opts);
      return {
        rows: (result.candidates || []).slice(0, max),
        degraded: Boolean(result.summary?.degraded),
      };
    },
  };
}

/**
 * Keyword tab: re-run the keyword search with the same filter body the screen
 * posted. This re-embeds and re-ranks through Cohere, so it can take a while
 * and can degrade to an unranked list — surfaced via X-Export-Degraded.
 * @param {object} filters - the request body from the screen
 */
export function keywordSpec(filters) {
  return {
    key: 'screening_keyword',
    label: 'Screening-Keyword-Search',
    columns,
    filters,
    fetch: async ({ max }) => {
      const result = config.screening.v2 || screeningV2.isLookupRequest(filters)
        ? await screeningV2.searchKeywordCandidatesV2(filters)
        : await screeningService.searchKeywordCandidates(filters);
      return {
        rows: (result.candidates || []).slice(0, max),
        degraded: Boolean(result.summary?.degraded),
      };
    },
  };
}

// ── L11: who a search left out, and why ───────────────────────────────

export const notShownColumns = [
  { header: 'Candidate', key: 'name' },
  { header: 'Why not shown', key: 'reasonText' },
  { header: 'Position Applied', key: 'positionApplied' },
  { header: 'Total Experience', key: 'experience' },
  { header: 'Expected CTC (LPA)', key: 'expectedCtc' },
  { header: 'Current Location', key: 'location' },
  { header: 'Notice Period', key: 'noticePeriod' },
  { header: 'Education', key: 'education' },
  { header: 'Added', key: 'createdAt', type: 'date' },
];

/**
 * The "not shown" list as a CSV, nearest misses first (the same nearest 200
 * the screen lists). Re-computed on the server from the same filter body, so
 * the file never trusts a client-sent candidate list.
 *
 * @param {'jd'|'keyword'} kind
 * @param {object} p - { mrfId, addedWithinDays, taggedOnly, reason } or { filters, reason }
 */
export function notShownSpec(kind, { mrfId = null, addedWithinDays = null, taggedOnly = false, filters = {}, reason = null } = {}) {
  return {
    key: kind === 'jd' ? 'screening_jd_not_shown' : 'screening_keyword_not_shown',
    label: kind === 'jd' ? `Screening-MRF-${mrfId}-Not-Shown` : 'Screening-Keyword-Not-Shown',
    columns: notShownColumns,
    filters: kind === 'jd' ? { mrfId, addedWithinDays, taggedOnly, reason } : { ...filters, reason },
    fetch: async ({ max }) => {
      const result = kind === 'jd'
        ? await screeningV2.notShownForRole(mrfId, { addedWithinDays, taggedOnly, reason })
        : await screeningV2.notShownForKeyword(filters, { reason });
      return {
        rows: (result.candidates || []).slice(0, max).map((c) => ({ ...c, reasonText: c.reasons.join('; ') })),
      };
    },
  };
}

// ── Analytics "Role Summary" table ────────────────────────────────────

export const roleSummaryColumns = [
  { header: 'Role', key: 'role' },
  { header: 'MRF ID', key: 'mrf_id' },
  { header: 'Status', key: 'status' },
  { header: 'Total Applied', key: 'total_applied', numeric: true },
  { header: 'Shortlisted', key: 'shortlisted', numeric: true },
  { header: 'Rejected', key: 'rejected', numeric: true },
  { header: 'On Hold', key: 'on_hold', numeric: true },
  { header: 'Future Prospect', key: 'future_prospect', numeric: true },
  { header: 'Closed', key: 'closed', numeric: true },
  { header: 'Total Screened', key: 'total', numeric: true },
  { header: 'Moved Forward', key: 'moved_forward', numeric: true },
  { header: 'Shortlist Rate (%)', key: 'shortlist_pct', numeric: true },
];

/**
 * Group shortlisted candidates per requisition — the shared classifier in
 * utils/roleSummary.js (L06: one row per MRF, no longer per role name, and no
 * longer repeated here and in the browser).
 */
export const groupByRole = (candidates = []) => groupByMrf(candidates);

/** The Role Summary CSV for the page's date range (L06). */
export function roleSummarySpec(query = {}) {
  const range = parseAnalyticsRange(query);
  return {
    key: 'screening_role_summary',
    label: `Screening-Role-Summary${rangeFileTag(range)}`,
    columns: roleSummaryColumns,
    filters: { from: range?.fromDay, to: range?.toDay },
    fetch: async () => (await getRoleSummary({ range })).rows,
  };
}

export default { columns, roleSpec, keywordSpec, roleSummarySpec, groupByRole, notShownSpec, notShownColumns };
