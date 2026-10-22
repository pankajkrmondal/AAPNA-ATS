/**
 * Evalground invite state for one journey (Phase 3 "Do Now", N35). Pure — no
 * Prisma — so node:test can load it.
 *
 * One rule shared by the drawer (getInviteState) and the board card
 * (listPipeline), so the card can never say "Test sent · due …" while the
 * drawer says "Deadline passed" or the reverse.
 *
 *   - no invite, or the latest one was withdrawn -> not sent
 *   - a matched result exists                     -> done (never overdue)
 *   - otherwise overdue once deadline_at is past
 */

/**
 * @param {{ sent_at?: Date|string, deadline_at?: Date|string, withdrawn_at?: Date|string|null }|null} latestInvite
 *   the journey's newest rpa_assessment_invites row (by sent_at), or null
 * @param {boolean} hasResult  a matched / score_overwritten rpa_assessment_results row exists
 * @param {Date} [now]
 * @returns {{ sent: boolean, sentAt: Date|null, dueAt: Date|null, isOverdue: boolean, isWithdrawn: boolean }}
 */
export function assessmentInviteState(latestInvite, hasResult, now = new Date()) {
  if (!latestInvite) {
    return { sent: false, sentAt: null, dueAt: null, isOverdue: false, isWithdrawn: false };
  }
  const isWithdrawn = !!latestInvite.withdrawn_at;
  const dueAt = latestInvite.deadline_at ? new Date(latestInvite.deadline_at) : null;
  const isOverdue = !hasResult && !isWithdrawn && !!dueAt && dueAt < now;
  return {
    sent: !isWithdrawn,
    sentAt: latestInvite.sent_at ? new Date(latestInvite.sent_at) : null,
    dueAt,
    isOverdue,
    isWithdrawn,
  };
}

/**
 * Newest invite per pipeline from a list already ordered by sent_at DESC.
 * @param {Array<{ pipeline_id: bigint|number|string }>} invitesNewestFirst
 * @returns {Map<string, object>} pipeline id (string) -> newest invite row
 */
export function latestInviteByPipeline(invitesNewestFirst) {
  const latest = new Map();
  for (const inv of invitesNewestFirst || []) {
    const key = String(inv.pipeline_id);
    if (!latest.has(key)) latest.set(key, inv);
  }
  return latest;
}
