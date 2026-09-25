/**
 * Pure rules for the MRF approval audit trail — no prisma, no network — so
 * `node --test` can load them. Used by services/mrfApproval.service.js and the
 * retention sweep.
 *
 * Plan: docs/phase3/New MRF Request - Approval Request/MRF-Approval-Unified-Fix-Plan.md §6
 */

/** `typ` claim of a personal approval JWT. Stops any other JWT signed with the same secret (e.g. a login token) being accepted as an approval link. */
export const APPROVAL_TOKEN_TYP = 'mrf_approval';

export const MAX_COMMENT_LENGTH = 2000;
export const MAX_USER_AGENT_LENGTH = 512;

/** At most one link_opened event per token per this window (a page refresh is not news). */
export const LINK_OPEN_THROTTLE_MS = 5 * 60 * 1000;

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/**
 * The approvers an MRF is sent to, as [{ email, name }].
 *
 * Source of truth is the `mrf_approvers` setting (JSON array of {email, name}).
 * If it is missing or invalid, falls back to the `mrfApproval` flow-key emails
 * (comma list), using the email as the name — submission must never fail
 * because the roster is misconfigured.
 *
 * @param {string|null|undefined} settingValue  rpa_settings.mrf_approvers value
 * @param {string} fallbackEmails               comma-separated emails
 * @returns {{ approvers: {email: string, name: string}[], source: 'setting'|'fallback', error?: string }}
 */
export function parseApproverRoster(settingValue, fallbackEmails = '') {
  const fromFallback = (error) => {
    const seen = new Set();
    const approvers = String(fallbackEmails || '')
      .split(',')
      .map((e) => e.trim())
      .filter((e) => EMAIL_RE.test(e))
      .filter((e) => (seen.has(e.toLowerCase()) ? false : seen.add(e.toLowerCase())))
      .map((email) => ({ email, name: email }));
    return { approvers, source: 'fallback', ...(error ? { error } : {}) };
  };

  if (settingValue === null || settingValue === undefined || String(settingValue).trim() === '') {
    return fromFallback();
  }
  let parsed;
  try {
    parsed = JSON.parse(settingValue);
  } catch {
    return fromFallback('mrf_approvers is not valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return fromFallback('mrf_approvers must be a non-empty array');

  const seen = new Set();
  const approvers = [];
  for (const entry of parsed) {
    const email = String(entry?.email || '').trim();
    if (!EMAIL_RE.test(email)) return fromFallback(`mrf_approvers has an invalid email: "${email}"`);
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    const name = String(entry?.name || '').trim() || email;
    approvers.push({ email, name });
  }
  return { approvers, source: 'setting' };
}

/**
 * Normalise a client IP for storage in an INET column: strips the IPv4-mapped
 * IPv6 prefix and returns null for anything that is not a plain IPv4/IPv6
 * address, so a malformed header can never fail the request.
 * @param {string|null|undefined} ip
 * @returns {string|null}
 */
export function normalizeIp(ip) {
  if (!ip) return null;
  let v = String(ip).trim();
  if (v.startsWith('::ffff:') && /^::ffff:\d+\.\d+\.\d+\.\d+$/.test(v)) v = v.slice(7);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) {
    return v.split('.').every((o) => Number(o) <= 255) ? v : null;
  }
  if (/^[0-9a-fA-F:]+$/.test(v) && v.includes(':') && v.length <= 39) return v;
  return null;
}

/**
 * Retention masking: IPv4 keeps its /24 network ("49.36.12.0"), IPv6 its /48.
 * Enough to still say "same office network", not enough to identify a device.
 * @param {string|null} ip
 * @returns {string|null}
 */
export function maskIp(ip) {
  const v = normalizeIp(ip);
  if (!v) return null;
  if (v.includes('.')) {
    const [a, b, c] = v.split('.');
    return `${a}.${b}.${c}.0`;
  }
  // Expand "::" so the first three hextets are real, then keep /48.
  const [head, tail = ''] = v.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = v.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : v.split(':');
  return `${full.slice(0, 3).map((x) => x || '0').join(':')}::`;
}

/**
 * Reduce a User-Agent to "Browser on OS" — what the trail needs after the
 * retention period. Also used for the human-readable trail line.
 * @param {string|null|undefined} ua
 * @returns {string|null}
 */
export function summarizeUserAgent(ua) {
  if (!ua) return null;
  const s = String(ua);
  const browser =
    /Edg\//.test(s) ? 'Edge'
      : /OPR\/|Opera/.test(s) ? 'Opera'
        : /Chrome\//.test(s) && !/Chromium/.test(s) ? 'Chrome'
          : /Firefox\//.test(s) ? 'Firefox'
            : /Safari\//.test(s) && /Version\//.test(s) ? 'Safari'
              : /Outlook|Microsoft Office/.test(s) ? 'Outlook'
                : 'Other browser';
  const os =
    /iPhone|iPad|iPod/.test(s) ? 'iOS'
      : /Android/.test(s) ? 'Android'
        : /Windows/.test(s) ? 'Windows'
          : /Mac OS X|Macintosh/.test(s) ? 'macOS'
            : /Linux/.test(s) ? 'Linux'
              : 'unknown OS';
  return `${browser} on ${os}`;
}

const SCANNER_UA_RE = /(bot|crawl|spider|preview|scanner|safelinks|mimecast|proofpoint|barracuda|headless|python-requests|curl\/|wget|go-http-client|java\/)/i;

/**
 * Heuristic for mail-security scanners that open links before the human does
 * (Microsoft Safe Links, Mimecast, …). Such opens are kept in the trail but
 * greyed out and never counted as a person viewing the request.
 * @param {string|null} ua
 * @param {Date|string|null} issuedAt  when the link was emailed
 * @param {Date} [now]
 */
export function looksLikeScanner(ua, issuedAt, now = new Date()) {
  if (!ua) return true;
  if (SCANNER_UA_RE.test(ua)) return true;
  if (issuedAt) {
    const age = now.getTime() - new Date(issuedAt).getTime();
    if (age >= 0 && age < 15 * 1000) return true;
  }
  return false;
}

/** Trim and cap free text from the browser; empty → null. */
export function clampText(value, max) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * "23 Sep 2026, 10:43 PM IST" — every approver-facing time is shown in IST.
 * @param {Date|string|null} value
 */
export function formatIst(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  // Numeric parts only: ICU versions disagree on short month names ("Sep" vs
  // "Sept") and on the AM/PM marker, so both are formatted here instead.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h24 = get('hour');
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(get('minute')).padStart(2, '0');
  return `${get('day')} ${months[get('month') - 1]} ${get('year')}, ${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'} IST`;
}

/** "approved" / "declined" (the word the outcome email uses for a rejection). */
export function decisionWord(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'rejected') return 'declined';
  if (s === 'approved' || s === 'completed') return 'approved';
  return s || 'processed';
}

/**
 * The decision as the PUBLIC approval page may see it — name and time only,
 * never the decider's email, IP or device.
 * @param {object} mrf       rpa_mrf row (with decided_* columns)
 * @param {string|null} viewerEmail  approver whose personal link opened the page
 */
export function publicDecision(mrf, viewerEmail) {
  const status = String(mrf?.approval_status || '').trim().toLowerCase();
  if (!status || status === 'pending' || status === 'waiting') return null;
  const decidedBy = mrf.decided_by_email || null;
  return {
    status,
    word: decisionWord(status),
    decidedByName: mrf.decided_by_name || null,
    decidedAt: mrf.decided_at || null,
    decidedAtIst: mrf.decided_at ? formatIst(mrf.decided_at) : null,
    isYou: Boolean(viewerEmail && decidedBy && viewerEmail.toLowerCase() === decidedBy.toLowerCase()),
  };
}
