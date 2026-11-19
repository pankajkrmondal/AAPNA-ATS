/**
 * Which "New MRF Request" row (rpa_mrf_jd_send) a hiring manager's submitted
 * MRF (rpa_mrf) belongs to. Pure — no Prisma — so node:test can load it.
 *
 * WHY (18 Nov 2026, production)
 * -----------------------------
 * The form link emailed to the hiring manager carried only ?role=&emailid=,
 * never the request id, so the server guessed the row by an exact
 * email + role + mrfstatus 'pending' match. Both fields are editable on the
 * public form: Chhaya filled one in for Hardik, the guess failed, nothing was
 * logged, and the request row stayed PENDING for good. That meant no Submitted
 * MRF Details, no Approval Trail or Approve / Reject panel, no APPROVED after
 * the approvers decided, and "please fill the MRF" reminders to someone who
 * already had.
 *
 * The link now carries ?id= (the request row). The email + role match stays
 * as the fallback for links sent before that, and scripts/relink-orphan-mrfs.mjs
 * repairs the rows the old guess missed.
 */
import { isOpenHmRequest } from '../jobs/reminderEligibility.js';

/** rpa_mrf_jd_send.id is BIGSERIAL; 18 digits stays well inside it. */
const ID_PATTERN = /^\d{1,18}$/;

const norm = (v) => String(v ?? '').trim().toLowerCase();

const isUnlinked = (row) => row?.mrf_id === null || row?.mrf_id === undefined;

/**
 * The request id the public form sent as `parent_id`, or null. Digits only:
 * the value comes from a public URL, and `BigInt('abc')` throws — which, after
 * the rpa_mrf row is already created, used to fail the submission and skip
 * the approval emails.
 * @param {unknown} raw
 * @returns {bigint|null}
 */
export function parseParentId(raw) {
  const s = String(raw ?? '').trim();
  if (!ID_PATTERN.test(s)) return null;
  const id = BigInt(s);
  return id > 0n ? id : null;
}

/**
 * Pick the request row a submission links to.
 *
 * 1. The row the link's id names, if it has no MRF linked yet. Whatever was
 *    typed into the form does not matter here, which is the point.
 * 2. Otherwise the newest row with the same HM email and role (trimmed,
 *    case-insensitive) that is still waiting for the HM — the same definition
 *    of "not submitted yet" the reminder cron uses, so blank and
 *    'pendingfromleader' count, not only 'pending'.
 *
 * A row that already has an MRF is never picked: a second submission must not
 * take over the first one's request.
 *
 * @param {{
 *   parentId?: bigint|null,
 *   byId?: { id: bigint, mrf_id: number|null }|null,
 *   candidates?: Array<{ id: bigint, email: string, role: string, mrfstatus: string|null, mrf_id: number|null }>,
 *   email?: string|null,
 *   role?: string|null,
 * }} args  `candidates` newest first.
 * @returns {{ row: object|null, via: 'id'|'email_role'|null, reason: null|'id_not_found'|'id_already_linked'|'no_match' }}
 */
export function pickParentRequest({ parentId = null, byId = null, candidates = [], email = null, role = null } = {}) {
  if (byId && isUnlinked(byId)) return { row: byId, via: 'id', reason: null };

  const e = norm(email);
  const r = norm(role);
  if (e && r) {
    const match = candidates.find((c) => norm(c.email) === e
      && norm(c.role) === r
      && isOpenHmRequest({ mrfstatus: c.mrfstatus, mrf_id: c.mrf_id }));
    if (match) return { row: match, via: 'email_role', reason: null };
  }

  let reason = 'no_match';
  if (parentId && !byId) reason = 'id_not_found';
  else if (byId) reason = 'id_already_linked';
  return { row: null, via: null, reason };
}
