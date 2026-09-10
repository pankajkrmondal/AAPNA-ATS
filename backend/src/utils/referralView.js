/**
 * referralView.js — how an rpa_cv row's referral columns become API fields.
 *
 * Pure: role/row in, plain object out. No Prisma, no Express.
 *
 * Lives here rather than inline in candidate.service.js for exactly the reason
 * vendorScope.js gives for its own move: reaching a rule through the service
 * drags in Prisma, the socket layer and the whole Gemini parsing chain, which
 * makes a security-relevant function the most expensive one to test. This rule
 * decides whether a referral is disclosed, so it has to be cheap to assert.
 *
 * THE RULE IT ENCODES: absence reads as "not a referral". For a vendor caller the
 * referral columns are never SELECTed (candidate.service.js REFERRAL_COLUMNS), so
 * the row simply has no such keys — and this must turn that into `false`, not let
 * `undefined` travel onwards. Failing closed is the whole point: the one outcome
 * the feature exists to prevent is showing a referral to somebody who should not
 * see it, and a missing value must never be the thing that causes it.
 */

/**
 * Map the referral columns of an rpa_cv row to their API field names.
 *
 * @param {object|null} cv - an rpa_cv row, possibly with the referral columns omitted
 * @returns {{isReferral: boolean, referredBy: string, referralNote: string,
 *            referralSetBy: string, referralSetAt: Date|null}}
 */
export function mapReferralFields(cv) {
  return {
    isReferral: !!cv?.is_referral,
    referredBy: cv?.referred_by || '',
    referralNote: cv?.referral_note || '',
    referralSetBy: cv?.referral_set_by || '',
    referralSetAt: cv?.referral_set_at || null,
  };
}

export default { mapReferralFields };
