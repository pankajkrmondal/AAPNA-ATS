/**
 * Change JD (Phase 3 section G, G3) — the pure rule for when a shortlist's JD
 * may be replaced. No database, so node:test can load it.
 *
 * Change JD fixes a candidate shortlisted to the wrong JD from Keyword
 * filtering or Search Candidate: the saved JD is replaced and the candidate
 * stays where they are. It is refused once anything was set up under the old
 * JD — those emails, invites and seats belong to the old role — and then the
 * normal close is the way out.
 */

/** Activity under the old JD that blocks a change, in the order it is reported. */
const ACTIVITY_BLOCKS = [
  ['offer', 'an offer exists for it'],
  ['documentRequest', 'documents were requested'],
  ['interview', 'an interview is booked'],
  ['assessmentInvite', 'an assessment invite was sent'],
  ['assessmentResult', 'an assessment result was recorded'],
  ['zekoInvite', 'a Zeko interview was set up'],
];

/**
 * Why this shortlist's JD cannot be changed, or null when it can.
 * @param {{
 *   shortlist: { pipeline_status?: string|null } | null,
 *   journey: { final_outcome?: string|null, current_stage_status?: string|null, is_paused?: boolean } | null,
 *   signals: { offer?: boolean, documentRequest?: boolean, interview?: boolean,
 *              assessmentInvite?: boolean, assessmentResult?: boolean, zekoInvite?: boolean },
 * }} input
 * @returns {{ code: string, message: string } | null}
 */
export function changeJdBlock({ shortlist, journey, signals = {} }) {
  if (!shortlist) return { code: 'not_found', message: 'This shortlist no longer exists.' };
  if (shortlist.pipeline_status === 'rejected') {
    return { code: 'rejected', message: 'This candidate was rejected for this JD, so the JD cannot be changed.' };
  }
  if (journey?.final_outcome) {
    return { code: 'closed', message: 'This candidate\'s record for this JD is closed. Reopen it first.' };
  }
  if (journey?.current_stage_status === 'rejected') {
    return { code: 'stage_rejected', message: 'This candidate was rejected at the current stage. Close or reopen the record instead.' };
  }
  const found = ACTIVITY_BLOCKS.filter(([key]) => signals[key]).map(([, text]) => text);
  if (found.length > 0) {
    return {
      code: 'activity',
      message: `The JD cannot be changed because ${found.join(', ')} under the current JD. Close the record instead.`,
    };
  }
  return null;
}

/** Longest reason kept (it is shown in the journey's history). */
export const CHANGE_JD_REASON_MAX = 500;

/**
 * The reason a recruiter typed, trimmed, or null when it is missing.
 * @param {unknown} value
 * @returns {string|null}
 */
export function cleanChangeJdReason(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return text ? text.slice(0, CHANGE_JD_REASON_MAX) : null;
}

/** The history note: "JD changed from "QA" (MRF-12) to "Dev" (MRF-15). Reason: …". */
export function changeJdNote({ fromRole, fromMrfId, toRole, toMrfId, reason }) {
  const from = fromMrfId ? `"${fromRole || 'Untitled role'}" (MRF-${fromMrfId})` : 'no JD';
  return `JD changed from ${from} to "${toRole || 'Untitled role'}" (MRF-${toMrfId}). Reason: ${reason}`;
}
