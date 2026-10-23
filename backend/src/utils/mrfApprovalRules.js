/**
 * Pure rules for the MRF approval audit trail — no prisma, no network — so
 * `node --test` can load them. Used by services/mrfApproval.service.js and the
 * retention sweep.
 *
 * Plan: docs/phase3/New MRF Request - Approval Request/MRF-Approval-Unified-Fix-Plan.md §6
 */

import { fmtDate, fmtDateTimeIst, IST } from './dateFormat.js';
import { canDecideOnBehalf, normalizeRole } from '../config/roles.js';

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
    // Optional job title (N16), e.g. "CEO" / "CHRO". Only carried when set, so
    // a roster without titles parses exactly as before.
    const title = String(entry?.title || '').trim().slice(0, MAX_TITLE_LENGTH);
    approvers.push(title ? { email, name, title } : { email, name });
  }
  return { approvers, source: 'setting' };
}

const MAX_TITLE_LENGTH = 60;

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * "Abhijit Roy (CEO)", or just the name when the roster has no title.
 * @param {{ name?: string, title?: string }|null} approver
 */
export function approverLabel(approver) {
  const name = String(approver?.name || '').trim();
  const title = String(approver?.title || '').trim();
  return title ? `${name} (${title})` : name;
}

/**
 * The "also sent to" sentence in a personal approval email (N32), as HTML.
 * Empty when this approver is the only one.
 * @param {{ name?: string, title?: string }[]} otherApprovers
 */
export function approverNoteHtml(otherApprovers = []) {
  const others = otherApprovers
    .filter((a) => a && String(a.name || '').trim())
    .map((a) => `<strong>${escapeHtml(approverLabel(a))}</strong>`);
  if (others.length === 0) return '';
  const list = others.length === 1
    ? others[0]
    : `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}`;
  return `This request was also sent to ${list}. The first decision is final.`;
}

/**
 * Title of whoever decided, looked up in the roster by the decider's email —
 * the email itself never leaves the server (N16).
 * @param {{ email: string, title?: string }[]} approvers
 * @param {string|null} deciderEmail
 * @returns {string|null}
 */
export function titleForApprover(approvers = [], deciderEmail) {
  if (!deciderEmail) return null;
  const hit = approvers.find((a) => a.email.toLowerCase() === String(deciderEmail).toLowerCase());
  return hit?.title || null;
}

/**
 * Current roster name for an approver, looked up by email; the stored name
 * otherwise. Names are copied onto the tokens, the audit events and the MRF
 * when a request goes out, so without this an MRF sent before a roster change
 * keeps the old names on screen for good (N32 reopened 16 Oct: "Staging
 * Approver A/B" on the MRF page). A fallback roster uses the email as the
 * name, which never beats a stored name.
 * @param {{ email: string, name?: string }[]} approvers
 * @param {string|null} email
 * @param {string|null} storedName
 * @returns {string|null}
 */
export function nameForApprover(approvers = [], email, storedName) {
  if (email) {
    const hit = approvers.find((a) => a.email.toLowerCase() === String(email).toLowerCase());
    if (hit?.name && hit.name.toLowerCase() !== hit.email.toLowerCase()) return hit.name;
  }
  return storedName || null;
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
  return fmtDateTimeIst(value);
}

/** "approved" / "declined" (the word the outcome email uses for a rejection) / "put on hold". */
export function decisionWord(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'rejected') return 'declined';
  if (s === 'approved' || s === 'completed') return 'approved';
  if (s === HELD_STATUS) return 'put on hold';
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
  if (status === HELD_STATUS) {
    // A hold is not a final decision: decided_* stay empty, the hold columns
    // say who held it and until when.
    const heldBy = mrf.held_by_email || null;
    return {
      status,
      word: decisionWord(status),
      decidedByName: mrf.held_by_name || null,
      decidedAt: mrf.held_at || null,
      decidedAtIst: mrf.held_at ? formatIst(mrf.held_at) : null,
      heldUntil: mrf.held_until ? isoDate(mrf.held_until) : null,
      heldUntilLabel: mrf.held_until ? fmtDate(mrf.held_until, { timeZone: 'UTC' }) : null,
      isYou: Boolean(viewerEmail && heldBy && viewerEmail.toLowerCase() === heldBy.toLowerCase()),
    };
  }
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

// ── Hold and decisions on behalf of absent approvers ───────────────────
// Plan: docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md
//
// Every date here is a calendar date in IST, carried as 'YYYY-MM-DD'. A hold
// "until 27 Nov" means the MRF comes back on the morning of 27 Nov in India,
// whatever timezone the server runs in.

/** approval_status of an MRF parked at the approval gate. Not an "open" status. */
export const HELD_STATUS = 'held';

/** Decisions accepted at the approval gate. */
export const DECISION_ACTIONS = Object.freeze(['approve', 'reject', 'hold']);

/** Defaults when the settings rows are missing. */
export const HOLD_DEFAULTS = Object.freeze({ defaultDays: 30, maxDays: 180, releaseTime: '09:00' });
/** Hard ceiling on the max-days setting itself. */
export const HOLD_MAX_DAYS_LIMIT = 365;

/** Settings keys (rpa_settings). */
export const HOLD_SETTING_KEYS = Object.freeze({
  defaultDays: 'mrf_hold_default_days',
  maxDays: 'mrf_hold_max_days',
  releaseTime: 'mrf_hold_release_time',
  absence: 'mrf_approver_absence',
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 'YYYY-MM-DD' of a Date. A JS Date from a DATE column is UTC midnight, so it is
 * read in UTC; anything else is read in IST.
 * @param {Date|string} value
 * @param {{ timeZone?: string }} [opts]
 */
export function isoDate(value, { timeZone = 'UTC' } = {}) {
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** Today's date in India, 'YYYY-MM-DD'. */
export function todayIst(now = new Date()) {
  return isoDate(now, { timeZone: IST });
}

/** 'YYYY-MM-DD' plus n calendar days. */
export function addDays(isoDay, n) {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b ('YYYY-MM-DD'), b - a. */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** "27 Nov 2026" for a 'YYYY-MM-DD'. */
export function dateLabel(isoDay) {
  return isoDay ? fmtDate(new Date(`${isoDay}T00:00:00Z`), { timeZone: 'UTC' }) : '';
}

/**
 * Read the hold rules from settings rows, falling back to the defaults on a
 * missing or broken value (a bad row must never block an approver).
 * @param {Record<string, string|undefined>} values  key -> raw setting value
 */
export function parseHoldRules(values = {}) {
  const int = (v, d) => {
    const n = Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? n : d;
  };
  let maxDays = int(values[HOLD_SETTING_KEYS.maxDays], HOLD_DEFAULTS.maxDays);
  if (maxDays < 1 || maxDays > HOLD_MAX_DAYS_LIMIT) maxDays = HOLD_DEFAULTS.maxDays;
  let defaultDays = int(values[HOLD_SETTING_KEYS.defaultDays], HOLD_DEFAULTS.defaultDays);
  if (defaultDays < 1) defaultDays = HOLD_DEFAULTS.defaultDays;
  if (defaultDays > maxDays) defaultDays = maxDays;
  const rt = String(values[HOLD_SETTING_KEYS.releaseTime] ?? '').trim();
  const releaseTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(rt) ? rt : HOLD_DEFAULTS.releaseTime;
  return { defaultDays, maxDays, releaseTime };
}

/**
 * Validate hold rules sent from Settings. Returns the clean rules, or the
 * first error in words.
 * @param {{ defaultDays: any, maxDays: any, releaseTime: any }} input
 * @returns {{ ok: true, rules: object } | { ok: false, error: string }}
 */
export function validateHoldRules(input = {}) {
  const defaultDays = Number(input.defaultDays);
  const maxDays = Number(input.maxDays);
  const releaseTime = String(input.releaseTime ?? '').trim();
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > HOLD_MAX_DAYS_LIMIT) {
    return { ok: false, error: `Maximum hold length must be a whole number of days from 1 to ${HOLD_MAX_DAYS_LIMIT}.` };
  }
  if (!Number.isInteger(defaultDays) || defaultDays < 1 || defaultDays > maxDays) {
    return { ok: false, error: `Default hold length must be a whole number of days from 1 to ${maxDays} (the maximum).` };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(releaseTime)) {
    return { ok: false, error: 'Release time must be HH:MM (24-hour, IST).' };
  }
  return { ok: true, rules: { defaultDays, maxDays, releaseTime } };
}

/** node-cron expression for a daily 'HH:MM' (run with timezone Asia/Kolkata). */
export function releaseTimeToCron(hhmm) {
  const [h, m] = String(hhmm || HOLD_DEFAULTS.releaseTime).split(':').map((x) => Number.parseInt(x, 10));
  return `${m} ${h} * * *`;
}

/**
 * The date choices the Hold form offers, for a given "today".
 * @param {{ defaultDays: number, maxDays: number }} rules
 */
export function holdDateBounds(rules, today = todayIst()) {
  return {
    minDate: addDays(today, 1),
    maxDate: addDays(today, rules.maxDays),
    defaultDate: addDays(today, rules.defaultDays),
    defaultDays: rules.defaultDays,
    maxDays: rules.maxDays,
  };
}

/**
 * Check a hold-until date: a real date, from tomorrow to today + maxDays (IST).
 * @param {any} value  'YYYY-MM-DD'
 * @param {{ maxDays: number, today?: string }} opts
 * @returns {{ ok: true, date: string } | { ok: false, error: string }}
 */
export function validateHoldUntil(value, { maxDays, today = todayIst() }) {
  const s = String(value ?? '').trim();
  if (!ISO_DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || isoDate(new Date(`${s}T00:00:00Z`)) !== s) {
    return { ok: false, error: 'Please choose the date the hold should end (YYYY-MM-DD).' };
  }
  if (s <= today) return { ok: false, error: 'The hold-until date must be after today.' };
  const latest = addDays(today, maxDays);
  if (s > latest) {
    return { ok: false, error: `An MRF can be held for at most ${maxDays} days (until ${dateLabel(latest)}).` };
  }
  return { ok: true, date: s };
}

/**
 * The approver-absence window from its setting value (JSON). Broken or missing
 * means "not away".
 * @returns {{ active: boolean, from: string|null, to: string|null, note: string|null, setByName?: string|null, setAt?: string|null }}
 */
export function parseAbsence(raw) {
  const off = { active: false, from: null, to: null, note: null, setByName: null, setAt: null };
  if (!raw) return off;
  let v;
  try {
    v = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return off;
  }
  if (!v || typeof v !== 'object') return off;
  const from = ISO_DATE_RE.test(String(v.from || '')) ? v.from : null;
  const to = ISO_DATE_RE.test(String(v.to || '')) ? v.to : null;
  return {
    active: Boolean(v.active) && Boolean(from) && Boolean(to) && from <= to,
    from,
    to,
    note: v.note ? String(v.note).slice(0, 500) : null,
    setByName: v.setByName || null,
    setByUserId: v.setByUserId ?? null,
    setAt: v.setAt || null,
  };
}

/**
 * Validate an absence window sent from Settings.
 * @returns {{ ok: true, absence: object } | { ok: false, error: string }}
 */
export function validateAbsence(input = {}) {
  const active = Boolean(input.active);
  const note = input.note ? String(input.note).trim().slice(0, 500) : null;
  if (!active) return { ok: true, absence: { active: false, from: input.from || null, to: input.to || null, note } };
  const from = String(input.from || '').trim();
  const to = String(input.to || '').trim();
  if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) {
    return { ok: false, error: 'Choose both the From and To dates of the absence.' };
  }
  if (from > to) return { ok: false, error: 'The absence must end on or after the day it starts.' };
  return { ok: true, absence: { active: true, from, to, note } };
}

/** True while the approvers are marked away today (inclusive of both ends, IST). */
export function isAbsenceActive(absence, today = todayIst()) {
  return Boolean(absence?.active && absence.from && absence.to && absence.from <= today && today <= absence.to);
}

/**
 * May this ATS user approve / reject / hold on behalf of the approvers right now?
 * Role HR Admin Recruiter or above, an active account, and an absence window
 * that covers today.
 * @returns {{ ok: boolean, reason: null|'role_too_low'|'inactive_user'|'no_absence_window' }}
 */
export function canDecideAsDelegate({ user, absence, today = todayIst() }) {
  if (!user || !canDecideOnBehalf(normalizeRole(user.role))) return { ok: false, reason: 'role_too_low' };
  if (user.is_active === false) return { ok: false, reason: 'inactive_user' };
  if (!isAbsenceActive(absence, today)) return { ok: false, reason: 'no_absence_window' };
  return { ok: true, reason: null };
}

/** Words for a canDecideAsDelegate() refusal. */
export function delegateRefusalMessage(reason) {
  switch (reason) {
    case 'role_too_low':
      return 'Only an HR Admin Recruiter, Admin or Super Admin can decide on behalf of the approvers.';
    case 'inactive_user':
      return 'Your account is not active.';
    case 'no_absence_window':
      return 'Deciding on behalf of the approvers is only allowed while they are marked away (Settings › MRF Approval & Hold).';
    default:
      return 'You cannot decide this MRF on behalf of the approvers.';
  }
}
