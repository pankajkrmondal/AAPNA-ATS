/**
 * recordingShareModel.js — the rules a recording share link is judged by, and
 * the words used to describe one, with no database and no Express in sight.
 *
 * WHY A SEPARATE MODULE. This is the decision that stands between an
 * unauthenticated URL and a video of a real person: is this link still allowed
 * to play? It must be testable exhaustively — expired, revoked, revoked AND
 * expired, valid, missing, clock-skewed — by `npm run test:unit`, without a
 * database and without spinning up a server. The service does the fetching and
 * the streaming; everything here is pure.
 *
 * THE ORDER OF THE CHECKS IS PART OF THE DESIGN. Revocation is tested before
 * expiry, so a link that was revoked and has since expired still reports as
 * revoked: a recruiter asking "did my revoke work?" months later must be able to
 * tell "we stopped it" from "it ran out on its own".
 *
 * Source: docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §6.5, §10.2a.
 */

/** The states a link can be in, in the order the checks run. */
export const SHARE_STATES = Object.freeze({
  MISSING: 'missing',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
  LIVE: 'live',
});

/**
 * Whether a string is even shaped like one of our tokens.
 *
 * The public route is the one place in this system where a hostile string is
 * expected, and `token` is a `@db.Uuid` column: handing Prisma anything that is
 * not a real UUID throws, which on an unauthenticated route turns a friendly
 * "this link is no longer available" page into a 500. A character-class check is
 * not enough — 36 dashes passes that and is not a UUID.
 *
 * @param {*} token
 * @returns {boolean}
 */
export function isShareToken(token) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(token ?? ''));
}

/**
 * Whether a share-link row may serve bytes right now.
 *
 * `now` is a parameter rather than `Date.now()` so a test can hold the clock
 * still — and so it is obvious that the server's clock is the authority. A
 * viewer changing their own clock changes nothing here, which is exactly the
 * property §10.2a item 3 asks for.
 *
 * @param {{revoked_at?: Date|string|null, expires_at?: Date|string|null}|null|undefined} link
 * @param {Date} [now]
 * @returns {'missing'|'revoked'|'expired'|'live'}
 */
export function shareLinkState(link, now = new Date()) {
  if (!link) return SHARE_STATES.MISSING;
  if (link.revoked_at) return SHARE_STATES.REVOKED;
  const expires = link.expires_at ? new Date(link.expires_at) : null;
  // A row with no expiry is treated as expired rather than as immortal: a NOT
  // NULL column means this cannot happen, and if it somehow does, failing shut
  // is the only safe reading.
  if (!expires || Number.isNaN(expires.getTime())) return SHARE_STATES.EXPIRED;
  return expires.getTime() > now.getTime() ? SHARE_STATES.LIVE : SHARE_STATES.EXPIRED;
}

/** Convenience for the guard clauses; identical rule, one place. */
export const isShareLinkLive = (link, now = new Date()) => shareLinkState(link, now) === SHARE_STATES.LIVE;

/**
 * What the person holding the link is told when it will not play.
 *
 * Deliberately the same sentence for expired, revoked and missing. The holder is
 * outside the company: telling them "this was revoked 20 minutes ago" confirms
 * that the link was real and that someone is watching, which is information a
 * leaked link's finder should not be handed. The distinction is kept in full on
 * the timeline and in the drawer, where it belongs.
 *
 * @param {string} state - from shareLinkState()
 * @returns {{status: number, title: string, message: string}}
 */
export function shareRefusal(state) {
  if (state === SHARE_STATES.LIVE) {
    throw new Error('shareRefusal() called for a live link — this is a bug in the caller.');
  }
  return {
    // 410 rather than 404: the link was real and is now gone. It is the honest
    // code, and it stops a well-meaning client from retrying forever.
    status: state === SHARE_STATES.MISSING ? 404 : 410,
    title: 'This recording link is no longer available',
    message: 'The link may have expired or been withdrawn. Please ask the recruiter who sent it '
      + 'to you for a new one.',
  };
}

/**
 * The absolute URL an external viewer opens.
 *
 * Built from the backend's own public base URL, not the frontend's: the page
 * this opens is served by the API and needs no ATS session, no SPA bundle and no
 * JavaScript build to have been deployed. `null` when no base URL is configured,
 * which the caller must treat as "no link this time" rather than emitting a
 * relative URL into a file that will be opened from someone's Downloads folder.
 *
 * @param {string} token
 * @param {string} publicBaseUrl - config.publicBaseUrl
 * @returns {string|null}
 */
export function shareUrlFor(token, publicBaseUrl) {
  if (!token || !publicBaseUrl) return null;
  return `${String(publicBaseUrl).replace(/\/+$/, '')}/api/recording-share/${encodeURIComponent(token)}`;
}

/**
 * A link's date, the way every surface that mentions it must print it.
 *
 * One helper so the drawer, the share page and the pack cannot disagree about
 * which day a link dies on — they did, while each formatted its own.
 *
 * @param {Date|string} value
 * @param {string} [timeZone] - IANA zone; omitted means the server's own
 * @returns {string}
 */
export function shareDate(value, timeZone = undefined) {
  // The empties are guarded explicitly, exactly as csvExport.js's toDate() does
  // and for the same reason: `new Date(null)` is NOT Invalid Date, it is the
  // epoch. A missing expiry would have printed "1 Jan 1970" to an external
  // viewer rather than nothing.
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', ...(timeZone ? { timeZone } : {}),
  });
}

/**
 * How a link reads in the drawer's Shared links list.
 *
 * The recruiter's question is "what is live, and should it still be?", so the
 * summary leads with the state and carries the two numbers that answer the
 * follow-up: when it dies on its own, and how often it has been opened.
 *
 * `timeZone` is a parameter rather than the server's local zone for the same
 * reason csvExport.js pins one: the drawer, the public page and the pack all
 * print this link's expiry, and a server running in UTC had them naming
 * different days for the same instant. The caller passes EXPORT_TIMEZONE; the
 * default keeps this module free of config, which is what makes it unit-testable.
 *
 * @param {object} link - a rpa_recording_share_link row
 * @param {Date} [now]
 * @param {string} [timeZone] - IANA zone the expiry date is stated in
 */
export function describeShareLink(link, now = new Date(), timeZone = undefined) {
  const state = shareLinkState(link, now);
  const views = link.view_count || 0;
  return {
    state,
    // Named rather than computed in the UI so the list, the pack and any future
    // notification all say the same thing about the same link.
    summary: state === SHARE_STATES.LIVE
      ? `Live until ${shareDate(link.expires_at, timeZone)}`
      : state === SHARE_STATES.REVOKED
        ? 'Revoked — refused immediately'
        : 'Expired',
    views,
    // A link opened many times is not one interviewer watching one interview.
    // Surfaced as a flag rather than left for someone to notice in a number.
    unusual: state !== SHARE_STATES.REVOKED && views >= 10,
  };
}

/**
 * When a link minted now should die.
 *
 * @param {number} days - config.dossier.shareLinkDays
 * @param {Date} [from]
 * @returns {Date}
 */
export function shareExpiryFrom(days, from = new Date()) {
  const d = Number(days);
  // A misconfigured 0 or a negative would mint links that are born dead, which
  // reads to a recruiter as "the feature is broken" rather than "someone typed
  // the wrong number into an env file". Fall back to the documented default.
  const safeDays = Number.isFinite(d) && d > 0 ? d : 14;
  return new Date(from.getTime() + safeDays * 24 * 60 * 60 * 1000);
}

export default {
  SHARE_STATES,
  isShareToken,
  shareLinkState,
  isShareLinkLive,
  shareRefusal,
  shareUrlFor,
  shareDate,
  describeShareLink,
  shareExpiryFrom,
};
