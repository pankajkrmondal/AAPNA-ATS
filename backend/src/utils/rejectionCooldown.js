/**
 * rejectionCooldown.js — how long a rejection keeps a candidate out.
 *
 * TWO WINDOWS, DELIBERATELY DIFFERENT (audited M6, 2026-08-12)
 * -----------------------------------------------------------
 * These look like the same rule at two lengths, and reconciling them to one
 * number would be wrong. They answer different questions:
 *
 *   REJECTION_COOLDOWN_DAYS (90 days) — a SEARCH filter. A recently-rejected
 *   candidate is hidden from Candidate Screening results so recruiters do not
 *   keep rediscovering and re-pitching the same person. Soft: it only affects
 *   what a search surfaces, and a recruiter who knows the candidate by name can
 *   still act on them.
 *
 *   REAPPLICATION_COOLING_OFF_MONTHS (6 months) — a POLICY gate. Creating a new
 *   pipeline journey for someone rejected at Stage 1+ inside the window is
 *   refused outright (409, createPipelineJourney). Hard: it is the re-application
 *   rule from Q11/Q23, and it applies however the candidate was found.
 *
 * So the shorter window stops accidental rediscovery; the longer one stops
 * deliberate re-entry. A candidate at month 4 is findable by name but cannot be
 * put back into the pipeline — which is the intended behaviour, not a conflict.
 *
 * Kept flat for both. Could later vary by MRF urgency (rpa_mrf.required_in).
 */

/** Search-exclusion window: how long a rejection hides a candidate from results. */
export const REJECTION_COOLDOWN_DAYS = 90;

/** Re-application policy window (Q11): how long before a new journey is allowed. */
export const REAPPLICATION_COOLING_OFF_MONTHS = 6;

/** The cutoff date for the 90-day search exclusion. */
export function getCooldownCutoff() {
  return new Date(Date.now() - REJECTION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * The cutoff date for the 6-month re-application gate.
 * @param {number} [months] - override, for callers with a per-case policy
 * @returns {Date}
 */
export function getReapplicationCutoff(months = REAPPLICATION_COOLING_OFF_MONTHS) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff;
}
