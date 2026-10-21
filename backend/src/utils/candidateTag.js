/**
 * Pure rules for JD tagging (Phase 3 section B, N13). No database, no I/O, so
 * the unit tests can load them without Prisma or Redis.
 *
 * A tag says "this candidate is linked to this JD (MRF)" and how that came
 * about. The table is rpa_candidate_mrf_tags; the writers are in
 * services/candidateTag.service.js.
 */
import { isMrfClosed } from '../config/pipelineStages.js';

/** Every value the DDL's chk_candidate_mrf_tag_source allows. */
export const TAG_SOURCES = Object.freeze({
  HR_UPLOAD: 'hr_manual_upload',
  VENDOR_UPLOAD: 'vendor_portal',
  SHORTLIST: 'shortlist',
  SEARCH_CANDIDATE: 'search_candidate',
  CHANGE_JD: 'change_jd',
  MOVE: 'move',
  BACKFILL: 'backfill',
});

const ALL_SOURCES = new Set(Object.values(TAG_SOURCES));

/** Tags made by an upload: they record a fact about the upload, so Change JD keeps them. */
export const UPLOAD_TAG_SOURCES = Object.freeze([TAG_SOURCES.HR_UPLOAD, TAG_SOURCES.VENDOR_UPLOAD]);

/** @returns {boolean} whether the DDL accepts this source */
export function isTagSource(source) {
  return ALL_SOURCES.has(source);
}

/**
 * The tag source for a shortlist, from shortlistCandidates' `source` option:
 * Search Candidate's "Add to JD" (N21) is told apart; both Screening tabs are
 * a plain shortlist.
 * @param {string|null|undefined} shortlistSource 'jd' | 'keyword' | 'search_candidate' | null
 */
export function tagSourceForShortlist(shortlistSource) {
  return shortlistSource === 'search_candidate' ? TAG_SOURCES.SEARCH_CANDIDATE : TAG_SOURCES.SHORTLIST;
}

/**
 * The tag source for an upload, from runBatchParsing's `source`. Outlook
 * intake (and anything else) has no JD picker, so it never tags: null.
 * @param {string} uploadSource 'hr_manual_upload' | 'vendor_portal' | 'email_intake' | ...
 * @returns {string|null}
 */
export function tagSourceForUpload(uploadSource) {
  return UPLOAD_TAG_SOURCES.includes(uploadSource) ? uploadSource : null;
}

/**
 * A positive whole MRF id as BigInt, or null for "no JD" (blank, 0, junk).
 * Form fields arrive as strings; the keyword tab sends 0 for "no MRF".
 * @param {unknown} value
 * @returns {bigint|null}
 */
export function parseMrfId(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = BigInt(s);
  return n > 0n ? n : null;
}

/**
 * Who made the tag, as the two columns hold it.
 * @param {{ id?: number, username?: string, email?: string, name?: string }|string|null} actor
 * @returns {{ tagged_by: string|null, tagged_by_id: number|null }}
 */
export function actorColumns(actor) {
  if (!actor) return { tagged_by: null, tagged_by_id: null };
  if (typeof actor === 'string') return { tagged_by: actor.slice(0, 255) || null, tagged_by_id: null };
  const name = actor.username || actor.email || actor.name || null;
  const id = Number.isInteger(actor.id) ? actor.id : null;
  return { tagged_by: name ? String(name).slice(0, 255) : null, tagged_by_id: id };
}

/** Columns mrfCandidateBlock needs; select these when loading the MRF. */
export const MRF_OPEN_SELECT = Object.freeze({
  id: true, position_hiring_for: true, approval_status: true, approved_by_abhijit: true,
  filled_at: true, closed_at: true,
});

/**
 * Why a JD cannot take candidates (shortlist, upload tag, Change JD), or null
 * when it can. The same test as the JD picker list (getApprovedRoles): approved,
 * or completed with the CEO's approval, and not closed or filled. A paused MRF
 * is still listed there, so it is not refused here either.
 * @param {object|null} mrf a row loaded with MRF_OPEN_SELECT
 * @param {number|bigint|string} mrfId for the message when the row is missing
 * @returns {{ status: number, message: string }|null}
 */
export function mrfCandidateBlock(mrf, mrfId) {
  if (!mrf) return { status: 404, message: `MRF-${mrfId} not found.` };
  const label = `"${mrf.position_hiring_for || `MRF-${mrfId}`}" (MRF-${mrfId})`;
  // Closed first: a legacy row closed by the old lossy path also fails the
  // approval test, and "closed" is the true reason for it.
  if (isMrfClosed(mrf)) {
    return { status: 409, message: `${label} is closed, so candidates cannot be added to it.` };
  }
  const approved = mrf.approval_status === 'approved'
    || (mrf.approval_status === 'completed' && ['approved', 'true'].includes(String(mrf.approved_by_abhijit)));
  if (!approved) {
    return { status: 409, message: `${label} is not approved, so candidates cannot be added to it.` };
  }
  return null;
}
