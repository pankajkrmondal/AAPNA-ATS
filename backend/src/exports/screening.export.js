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
import * as screeningService from '../services/screening.service.js';

/** Whichever rating object this candidate shape carries. */
const rating = (c) => c.starRating || c.rating || {};
/** One deterministic sub-score from the rating breakdown. */
const subScore = (c, key) => rating(c).breakdown?.[key]?.score ?? '';

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
  { header: 'Score — CTC Alignment', value: (c) => subScore(c, 'ctcAlignment'), numeric: true },
  { header: 'Score — Availability', value: (c) => subScore(c, 'availability'), numeric: true },
  { header: 'JD Matching Reason', value: (c) => rating(c).breakdown?.jdMatching?.reason || '' },
  {
    header: 'Mandatory Skills Present',
    value: (c) => skillsBy(c, (s) => s.inSignals || s.inSkillsSection),
  },
  {
    header: 'Mandatory Skills Missing',
    value: (c) => skillsBy(c, (s) => s.status === 'missing'),
  },

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
 */
export function roleSpec(mrfId) {
  return {
    key: 'screening_jd',
    label: `Screening-MRF-${mrfId}`,
    columns,
    filters: { mrfId },
    fetch: async ({ max }) => {
      // force=false: read the cache the on-screen search just populated so the
      // CSV matches what the recruiter is looking at.
      const result = await screeningService.searchRoleCandidates(mrfId, false);
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
      const result = await screeningService.searchKeywordCandidates(filters);
      return {
        rows: (result.candidates || []).slice(0, max),
        degraded: Boolean(result.summary?.degraded),
      };
    },
  };
}

// ── Analytics "Role Summary" table ────────────────────────────────────

export const roleSummaryColumns = [
  { header: 'Role', key: 'role' },
  { header: 'MRF ID', key: 'mrf_id' },
  { header: 'Shortlisted', key: 'shortlisted', numeric: true },
  { header: 'Rejected', key: 'rejected', numeric: true },
  { header: 'On Hold', key: 'on_hold', numeric: true },
  { header: 'Total', key: 'total', numeric: true },
];

/**
 * Group shortlisted candidates by role.
 * Mirrors the `roleStats` memo in frontend/src/pages/Analytics.jsx — same
 * source data (getZekoPipeline), same buckets, so the CSV matches the table.
 */
export function groupByRole(candidates = []) {
  const groups = new Map();

  for (const c of candidates) {
    const role = c.mrf?.position_hiring_for || c.position_applied || 'Unknown Role';
    const status = String(c.pipeline_status || 'shortlisted').toLowerCase();

    if (!groups.has(role)) {
      groups.set(role, {
        role,
        mrf_id: c.mrf_id || (c.mrf ? Number(c.mrf.id) : null),
        shortlisted: 0,
        rejected: 0,
        on_hold: 0,
        total: 0,
      });
    }

    const entry = groups.get(role);
    entry.total += 1;
    if (status === 'shortlisted') entry.shortlisted += 1;
    else if (status === 'rejected') entry.rejected += 1;
    else if (status === 'on_hold' || status === 'on hold') entry.on_hold += 1;
  }

  return [...groups.values()];
}

export const roleSummarySpec = {
  key: 'screening_role_summary',
  label: 'Screening-Role-Summary',
  columns: roleSummaryColumns,
  fetch: async () => {
    const data = await screeningService.getZekoPipeline();
    return groupByRole(data.candidates || []);
  },
};

export default { columns, roleSpec, keywordSpec, roleSummarySpec, groupByRole };
