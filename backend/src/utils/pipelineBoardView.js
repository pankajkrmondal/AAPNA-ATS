/**
 * Which journeys a Candidate Pipeline board view shows (RT, 23 Oct 2026).
 * Shared by the board (pipeline.service.js listPipeline) and its CSV export,
 * so the file never holds rows the screen hides.
 *
 * A closed journey is finished work and a paused one is parked (by a
 * recruiter, or by the idle auto-pause), so the default board is open AND
 * running; "Show closed" shows only closed ones and "Paused journey" only
 * paused open ones. If both are somehow set, closed wins (the UI makes them
 * exclusive).
 *
 * @param {{ closedOnly?: boolean, pausedOnly?: boolean }} [filters]
 * @returns {object} a Prisma where fragment on rpa_candidate_pipeline
 */
export function buildBoardViewWhere({ closedOnly, pausedOnly } = {}) {
  if (closedOnly) return { final_outcome: { not: null } };
  if (pausedOnly) return { final_outcome: null, is_paused: true };
  return { final_outcome: null, is_paused: false };
}
