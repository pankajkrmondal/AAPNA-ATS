/**
 * formsLinksModel.js — the pure half of Forms & Links (L08): what state each
 * kind of link is in, which tab and tiles it counts towards, what a recruiter
 * may do with it, and the ready-to-paste message for "Copy with message".
 *
 * Design: docs/Phase 3 Enhancements or Feedback/Forms & Links — design for
 * approval.html (approved 23 Oct as recommended, D1–D10).
 *
 * Import-free (tests/unit/formsLinksModel.test.js). The service reads the rows
 * and hands them here; nothing in this file sees a token except the message
 * builders, which receive the URL only when someone has clicked Copy.
 */

export const LINK_TYPES = Object.freeze({
  scorecard: { label: 'Scorecard', group: ['interviewers'] },
  meeting: { label: 'Teams meeting', group: ['interviewers', 'candidates'] },
  recording: { label: 'Recording share', group: ['interviewers'] },
  documents: { label: 'Document upload', group: ['candidates'] },
  profile: { label: 'Complete-profile form', group: ['candidates'] },
  zeko: { label: 'Zeko AI interview', group: ['candidates'] },
  evalground: { label: 'Evalground test', group: ['candidates'] },
  mrf_form: { label: 'MRF request form', group: ['hm_approvers'] },
  mrf_approval: { label: 'MRF approval', group: ['hm_approvers'] },
});

/** Link types that belong to the Candidate Pipeline (shown only with its module). */
export const PIPELINE_TYPES = Object.freeze(new Set(['scorecard', 'meeting', 'recording', 'documents', 'zeko', 'evalground']));

/** The list's four states (the Status segments). */
export const STATES = Object.freeze({ OPEN: 'open', EXPIRED: 'expired', DONE: 'done', CLOSED: 'closed' });

const H48 = 48 * 60 * 60 * 1000;
const ms = (d) => (d ? new Date(d).getTime() : NaN);

/**
 * State, status label and detail for one link.
 *
 * @param {string} type
 * @param {object} r - the adapter's row (fields per type, see the service)
 * @param {number} [now]
 * @returns {{ state: string, status: string, detail: string, notDelivered: boolean }}
 */
export function linkStatus(type, r, now = Date.now()) {
  const expired = Number.isFinite(ms(r.expiresAt)) && ms(r.expiresAt) <= now;
  switch (type) {
    case 'scorecard':
      if (r.submittedAt || r.cardStatus === 'submitted') return { state: STATES.DONE, status: 'Submitted', detail: 'feedback received', notDelivered: false };
      if (r.cardStatus === 'expired' || expired) return { state: STATES.EXPIRED, status: 'Expired', detail: r.openedAt ? 'opened, not submitted' : 'never opened', notDelivered: false };
      if (!r.sentAt) return { state: STATES.OPEN, status: 'Not delivered', detail: 'the email failed', notDelivered: true };
      if (r.openedAt) return { state: STATES.OPEN, status: 'Opened', detail: 'opened, not submitted', notDelivered: false };
      return { state: STATES.OPEN, status: 'Waiting', detail: 'not opened yet', notDelivered: false };
    case 'meeting':
      if (ms(r.endsAt) < now) return { state: STATES.DONE, status: 'Held', detail: 'meeting time has passed', notDelivered: false };
      return { state: STATES.OPEN, status: 'Upcoming', detail: 'join link works until the meeting', notDelivered: false };
    case 'recording':
      if (r.revokedAt) return { state: STATES.CLOSED, status: 'Revoked', detail: 'refused immediately', notDelivered: false };
      if (expired) return { state: STATES.EXPIRED, status: 'Expired', detail: `viewed ${r.viewCount || 0} time(s)`, notDelivered: false };
      return { state: STATES.OPEN, status: 'Live', detail: `viewed ${r.viewCount || 0} time(s)`, notDelivered: false };
    case 'documents':
      if (r.tokenStatus === 'closed') return { state: STATES.DONE, status: 'Closed', detail: `${r.verified || 0} of ${r.total || 0} verified`, notDelivered: false };
      return { state: STATES.OPEN, status: 'Waiting', detail: `${r.uploaded || 0} of ${r.total || 0} uploaded`, notDelivered: false };
    case 'profile':
      if (r.completedAt || r.tokenStatus === 'RECEIVED') return { state: STATES.DONE, status: 'Completed', detail: 'details received', notDelivered: false };
      if (r.tokenStatus === 'FAILED') return { state: STATES.OPEN, status: 'Not delivered', detail: 'the email failed', notDelivered: true };
      return { state: STATES.OPEN, status: 'Waiting', detail: 'not filled in yet', notDelivered: false };
    case 'zeko':
      if (r.completedAt || r.zekoStatus === 'completed') return { state: STATES.DONE, status: 'Completed', detail: 'interview taken', notDelivered: false };
      if (expired) return { state: STATES.EXPIRED, status: 'Window closed', detail: 'not taken', notDelivered: false };
      return { state: STATES.OPEN, status: 'Waiting', detail: 'not started yet', notDelivered: false };
    case 'evalground':
      if (r.hasResult) return { state: STATES.DONE, status: 'Result in', detail: 'test taken', notDelivered: false };
      if (expired) return { state: STATES.EXPIRED, status: 'Deadline passed', detail: 'no result', notDelivered: false };
      return { state: STATES.OPEN, status: 'Waiting', detail: 'no result yet', notDelivered: false };
    case 'mrf_form':
      if (r.submitted) return { state: STATES.DONE, status: 'Submitted', detail: 'MRF raised', notDelivered: false };
      return { state: STATES.OPEN, status: 'Waiting', detail: 'for the hiring manager', notDelivered: false };
    case 'mrf_approval':
      if (r.usedAt) return { state: STATES.DONE, status: 'Decided', detail: 'decision recorded', notDelivered: false };
      if (r.revokedAt) return { state: STATES.CLOSED, status: 'Closed', detail: r.revokedReason ? r.revokedReason.replace(/_/g, ' ') : 'link closed', notDelivered: false };
      if (expired) return { state: STATES.EXPIRED, status: 'Expired', detail: 'no decision', notDelivered: false };
      return {
        state: STATES.OPEN,
        status: r.openCount ? `Opened ×${r.openCount}` : 'Not opened yet',
        detail: 'no decision yet',
        notDelivered: false,
      };
    default:
      return { state: STATES.OPEN, status: 'Open', detail: '', notDelivered: false };
  }
}

/**
 * What a recruiter may do with a link in this state. MRF approval links are
 * never copied (D3: whoever opens one decides in the approver's name).
 * Scorecard and recording links are copy-only: opening them counts as the
 * recipient opening them.
 */
export function linkActions(type, state) {
  const open = state === STATES.OPEN;
  switch (type) {
    case 'scorecard': return open ? ['copy', 'resend'] : state === STATES.EXPIRED ? ['renew'] : [];
    case 'meeting': return open ? ['copy', 'join'] : [];
    case 'recording': return open ? ['copy', 'revoke'] : [];
    case 'documents': return open ? ['copy', 'open', 'resend'] : [];
    case 'profile': return open ? ['copy', 'open'] : [];
    case 'zeko': return open ? ['copy', 'open'] : [];
    case 'evalground': return open ? ['copy'] : [];
    case 'mrf_form': return open ? ['copy', 'open'] : [];
    case 'mrf_approval': return open || state === STATES.EXPIRED ? ['reissue'] : [];
    default: return [];
  }
}

/** Which of the four tiles a link counts towards. */
export function tileFlags(row, now = Date.now()) {
  const open = row.state === STATES.OPEN;
  const exp = ms(row.expiresAt);
  return {
    waiting: open && !row.notDelivered,
    expiring48h: open && Number.isFinite(exp) && exp > now && exp - now <= H48,
    expiredNoResponse: row.state === STATES.EXPIRED,
    notDelivered: open && row.notDelivered,
  };
}

/** Counts for the four tiles. */
export function tileCounts(rows, now = Date.now()) {
  const t = { waiting: 0, expiring48h: 0, expiredNoResponse: 0, notDelivered: 0 };
  for (const r of rows) {
    const f = tileFlags(r, now);
    for (const k of Object.keys(t)) if (f[k]) t[k] += 1;
  }
  return t;
}

const when = (d, fmt) => (d ? fmt(d) : null);

/**
 * "Copy with message" (D9): who it is for, the round or role, the link, the
 * deadline. Plain text for WhatsApp or Teams.
 *
 * @param {string} type
 * @param {object} r - the row (recipientName, candidateName, roundLabel, role, mrfRef, expiresAt, …)
 * @param {string} url
 * @param {(d: Date|string) => string} fmt - the app's date formatter
 */
export function linkMessage(type, r, url, fmt = (d) => new Date(d).toDateString()) {
  const hi = r.recipientName ? `Hi ${r.recipientName.split(' ')[0]},` : 'Hi,';
  const role = [r.role, r.mrfRef].filter(Boolean).join(', ');
  const by = when(r.expiresAt, fmt);
  const sign = 'Thank you, AAPNA Recruitment';
  switch (type) {
    case 'scorecard':
      return [`${hi} here is the scorecard for ${r.candidateName || 'the candidate'}'s ${r.roundLabel || 'interview'}${role ? ` (${role})` : ''}. No login is needed.`, url, by ? `Please submit it by ${by}.` : null, sign].filter(Boolean).join('\n');
    case 'meeting':
      return [`${r.roundLabel || 'Interview'}: ${r.candidateName || ''}${role ? ` (${role})` : ''}`.trim(), r.startsAt ? `When: ${fmt(r.startsAt)}` : null, `Join on Microsoft Teams: ${url}`,
        [r.meetingId && `Meeting ID: ${r.meetingId}`, r.passcode && `Passcode: ${r.passcode}`].filter(Boolean).join(' · ') || null].filter(Boolean).join('\n');
    case 'recording':
      return [`Interview recording: ${r.candidateName || ''} · ${r.roundLabel || ''}`.trim(), `Watch it here (no sign-in needed): ${url}`, by ? `The link works until ${by}.` : null].filter(Boolean).join('\n');
    case 'documents':
      return [`${hi} please upload your documents for ${r.role || 'your application'} here:`, url, r.missingDocs?.length ? `Still needed: ${r.missingDocs.join(', ')}.` : null, sign].filter(Boolean).join('\n');
    case 'profile':
      return [`${hi} please complete your profile details for us here:`, url, sign].join('\n');
    case 'zeko':
      return [`${hi} here is your AI interview for ${r.role || 'the role'}:`, url, by ? `Please complete it by ${by}.` : null, sign].filter(Boolean).join('\n');
    case 'evalground':
      return [`${hi} here is your online test for ${r.role || 'the role'}:`, url, by ? `Please complete it by ${by}.` : null, sign].filter(Boolean).join('\n');
    case 'mrf_form':
      return [`${hi} please fill in the Manpower Requisition Form for ${r.role || 'the role'} here:`, url, sign].join('\n');
    default:
      return url;
  }
}

/** The first http(s) URL in a block of text (an Evalground invite's body). */
export function firstUrlIn(text) {
  const m = String(text || '').match(/https?:\/\/[^\s"'<>)]+/i);
  return m ? m[0].replace(/[.,;]+$/, '') : null;
}

export default {
  LINK_TYPES, PIPELINE_TYPES, STATES, linkStatus, linkActions, tileFlags, tileCounts, linkMessage, firstUrlIn,
};
