// Flat cooldown for now — every rejection, regardless of MRF, stays excluded
// from that MRF's (JD tab) or any MRF's (Keyword tab) search results for the
// same number of days. Could later vary by MRF urgency (rpa_mrf.required_in)
// if needed, but kept simple for this pass.
export const REJECTION_COOLDOWN_DAYS = 90;

export function getCooldownCutoff() {
  return new Date(Date.now() - REJECTION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
}
