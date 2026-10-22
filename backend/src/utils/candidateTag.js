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

/**
 * Remove or switch one JD tag (L02-B, Harish 22 Oct 2026): a candidate with
 * one JD can only switch it, never remove it, and a JD the candidate is in
 * the pipeline for is switched through Move to another JD, never directly.
 *
 * @param {{ action: 'remove'|'switch', tags: Array<{ mrf_id: unknown }>,
 *           mrfId: unknown, openJourneyMrfIds?: Set<string> }} input
 * @returns {{ code: string, status: number, message: string } | null} null when allowed
 */
export function tagChangeBlock({ action, tags, mrfId, openJourneyMrfIds = new Set() }) {
  const key = String(mrfId);
  if (!(tags || []).some((t) => String(t.mrf_id) === key)) {
    return { code: 'not_tagged', status: 404, message: 'The candidate is not tagged to this JD.' };
  }
  if (openJourneyMrfIds.has(key)) {
    return {
      code: 'in_pipeline',
      status: 409,
      message: 'The candidate is in the pipeline for this JD. Use "Move to another JD" on their pipeline record instead.',
    };
  }
  if (action === 'remove' && tags.length <= 1) {
    return {
      code: 'only_tag',
      status: 409,
      message: 'This is the candidate\'s only JD, so it cannot be removed. Switch it to the right JD instead.',
    };
  }
  return null;
}

/**
 * What each tag chip offers: remove (×) while another tag remains and the JD
 * is not in the pipeline; otherwise switch, directly or through Move.
 * @param {Array<{ mrf_id: unknown }>} tags
 * @param {Map<string, unknown>} openJourneyByMrf mrf id -> open pipeline id
 * @returns {Array<object>} each tag with can_remove, switch_via ('tag'|'move') and open_pipeline_id
 */
export function tagActions(tags, openJourneyByMrf = new Map()) {
  return (tags || []).map((t) => {
    const openPipelineId = openJourneyByMrf.get(String(t.mrf_id)) ?? null;
    return {
      ...t,
      open_pipeline_id: openPipelineId,
      can_remove: openPipelineId == null && tags.length > 1,
      switch_via: openPipelineId == null ? 'tag' : 'move',
    };
  });
}
