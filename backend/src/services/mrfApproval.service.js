/**
 * MRF approval audit trail — personal links, provable decisions, and telling
 * the other approvers.
 *
 * Why (production, 23–24 Sep 2026): both approvers got ONE shared link, the
 * first click decided, nothing recorded who clicked, and the other approver
 * met "already processed" cold. Plan:
 * docs/phase3/New MRF Request - Approval Request/MRF-Approval-Unified-Fix-Plan.md §6
 *
 * Rules that hold everywhere in this file:
 *   - The approver's identity comes from rpa_mrf_approval_tokens (found by the
 *     JWT's jti), never from anything the browser sends.
 *   - A decision and its proof are written in ONE transaction: a decision can
 *     never exist without its audit event.
 *   - Everything else (link-open tracking, notifications) is best effort and
 *     can never fail or slow the approver's request.
 *   - Only one decision per MRF (business decision D1): the status update is
 *     conditional on the status just read, so concurrent clicks cannot both win.
 */
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { describeFlowKeys } from '../config/emailRecipients.js';
import { MRF_APPROVAL_LOG_TYPES, isOpenApprovalStatus } from '../jobs/reminderEligibility.js';
import {
  APPROVAL_TOKEN_TYP,
  HELD_STATUS,
  LINK_OPEN_THROTTLE_MS,
  MAX_COMMENT_LENGTH,
  MAX_USER_AGENT_LENGTH,
  canDecideAsDelegate,
  clampText,
  dateLabel,
  decisionWord,
  delegateRefusalMessage,
  formatIst,
  holdDateBounds,
  isoDate,
  looksLikeScanner,
  normalizeIp,
  parseApproverRoster,
  publicDecision,
  summarizeUserAgent,
  titleForApprover,
  nameForApprover,
  todayIst,
  validateHoldUntil,
} from '../utils/mrfApprovalRules.js';
import { canDecideOnBehalf, roleLabel } from '../config/roles.js';
import {
  sendMrfPersonalApprovalEmail,
  sendMrfAlreadyActionedEmail,
  sendMrfDecisionConfirmationEmail,
  sendMrfDelegateDecisionNoticeEmail,
  sendMrfHoldNoticeEmail,
  sendMrfOutcomeEmail,
} from './emailNotification.service.js';
import { getAbsence, getHoldRules } from './mrfHoldSettings.service.js';

const ROSTER_SETTING_KEY = 'mrf_approvers';
const LEGACY_ACTOR_NAME = 'Unknown (shared link)';

/** { ip, userAgent } of the request, normalised for storage. */
export function clientOf(req) {
  return {
    ip: normalizeIp(req.ip),
    userAgent: clampText(req.get?.('user-agent'), MAX_USER_AGENT_LENGTH),
  };
}

/** Best-effort audit write for events OUTSIDE the decision transaction. Never throws. */
async function recordEvent(data, db = prisma) {
  try {
    return await db.rpa_mrf_approval_events.create({ data });
  } catch (err) {
    logger.warn(`[MRF approval] could not record ${data?.event_type} event for MRF ${data?.mrf_id}: ${err.message}`);
    return null;
  }
}

// ── Roster ─────────────────────────────────────────────────────────────

/**
 * Approvers an MRF goes to: the `mrf_approvers` setting, falling back to the
 * `mrfApproval` flow-key recipients so submission never fails on a bad roster.
 */
export async function getApproverRoster() {
  const row = await prisma.rpa_settings.findUnique({ where: { key: ROSTER_SETTING_KEY } });
  const flow = describeFlowKeys().find((f) => f.flowKey === 'mrfApproval');
  const { approvers, source, error } = parseApproverRoster(row?.value, flow?.to || '');
  if (error) logger.error(`[MRF approval] ${error}; falling back to the mrfApproval flow-key recipients.`);
  if (source === 'fallback' && approvers.length) {
    logger.warn(`[MRF approval] "${ROSTER_SETTING_KEY}" not set — using the mrfApproval recipients with emails as names.`);
  }
  return approvers;
}

/** The roster for display lookups only (names, titles): [] on any error. Never throws. */
async function rosterForDisplay() {
  try {
    return await getApproverRoster();
  } catch {
    return [];
  }
}

/** The MRF with its decider's name as the roster has it today (N32). */
function withRosterDeciderName(mrf, roster) {
  return mrf ? { ...mrf, decided_by_name: nameForApprover(roster, mrf.decided_by_email, mrf.decided_by_name) } : mrf;
}

// ── Issuing personal links ─────────────────────────────────────────────

/**
 * Create one personal token per approver and email each their own link.
 * Called in the background at submission (and by a re-issue); never throws.
 * @returns {Promise<number>} how many approval emails were sent
 */
export async function issueApprovalRequests({ mrfRecord, frontendUrl, reason = 'submitted', actor = null, backFromHold = null }) {
  const mrfId = BigInt(mrfRecord.id);
  const approvers = await getApproverRoster();
  if (!approvers.length) {
    logger.error(`[MRF approval] No approvers configured — MRF ${mrfRecord.id} was NOT sent for approval.`);
    return 0;
  }
  const days = config.mrfApprovalAudit.tokenDays;
  const expiresAt = new Date(Date.now() + days * 86400000);
  let sent = 0;

  for (const approver of approvers) {
    try {
      const tokenRow = await prisma.rpa_mrf_approval_tokens.create({
        data: { mrf_id: mrfId, approver_email: approver.email, approver_name: approver.name, expires_at: expiresAt },
      });
      const token = jwt.sign(
        { typ: APPROVAL_TOKEN_TYP, mrfId: String(mrfRecord.id), jti: tokenRow.token_jti },
        config.jwt.secret,
        { expiresIn: `${days}d` },
      );
      const emailLogId = await sendMrfPersonalApprovalEmail({
        mrfRecord,
        approver,
        otherApprovers: approvers.filter((a) => a.email.toLowerCase() !== approver.email.toLowerCase()),
        token,
        frontendUrl,
        backFromHold,
      });
      if (emailLogId) {
        sent += 1;
        await prisma.rpa_mrf_approval_tokens.update({ where: { id: tokenRow.id }, data: { email_log_id: emailLogId } });
      }
      await recordEvent({
        mrf_id: mrfId,
        token_id: tokenRow.id,
        event_type: 'request_sent',
        actor_email: approver.email,
        actor_name: approver.name,
        identity_source: 'system',
        meta: { reason, emailSent: Boolean(emailLogId), emailLogId, expiresAt, ...(actor ? { by: actor } : {}) },
      });
    } catch (err) {
      logger.error(`[MRF approval] Could not issue approval link to ${approver.email} for MRF ${mrfRecord.id}: ${err.message}`);
    }
  }
  logger.info(`[MRF approval] MRF ${mrfRecord.id}: ${sent}/${approvers.length} personal approval email(s) sent (${reason}).`);
  return sent;
}

// ── Verifying a link ───────────────────────────────────────────────────

// Throttle for token_invalid/token_expired events: one per IP+MRF per minute,
// in memory and size-capped, so junk requests cannot flood the audit table.
const failureSeen = new Map();
function shouldRecordFailure(key) {
  const now = Date.now();
  const last = failureSeen.get(key);
  if (last && now - last < 60 * 1000) return false;
  if (failureSeen.size > 5000) failureSeen.clear();
  failureSeen.set(key, now);
  return true;
}

/**
 * Check an approval link. Personal links (with jti) resolve to their token row;
 * links issued before the audit trail (no jti) are "legacy shared" links.
 * @returns {Promise<{tokenRow?: object, legacy?: boolean, error?: 'invalid'|'expired'|'mismatch', expiredTokenRow?: object}>}
 */
export async function verifyApprovalLink(id, token) {
  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      // Re-verify with expiry ignored: only a link WE signed, for THIS MRF,
      // may still show the decision (N16). A forged or foreign token stays a
      // plain "expired" error and reveals nothing.
      let stale = null;
      try {
        stale = jwt.verify(token, config.jwt.secret, { ignoreExpiration: true });
      } catch {
        stale = null;
      }
      const signedForThisMrf = Boolean(stale)
        && String(stale.mrfId) === String(id)
        && (!stale.jti || stale.typ === APPROVAL_TOKEN_TYP);
      // Still attribute the attempt to its approver, if it was a personal link.
      const peek = stale || jwt.decode(token);
      const expiredTokenRow = peek?.jti && /^[0-9a-f-]{36}$/i.test(peek.jti)
        ? await prisma.rpa_mrf_approval_tokens.findUnique({ where: { token_jti: peek.jti } }).catch(() => null)
        : null;
      return { error: 'expired', expiredTokenRow, signedForThisMrf };
    }
    return { error: 'invalid' };
  }
  if (String(decoded.mrfId) !== String(id)) return { error: 'mismatch' };
  if (!decoded.jti) return { legacy: true };
  if (decoded.typ !== APPROVAL_TOKEN_TYP || !/^[0-9a-f-]{36}$/i.test(decoded.jti)) return { error: 'invalid' };
  const tokenRow = await prisma.rpa_mrf_approval_tokens.findUnique({ where: { token_jti: decoded.jti } });
  if (!tokenRow || String(tokenRow.mrf_id) !== String(id)) return { error: 'invalid' };
  return { tokenRow };
}

async function rejectBadLink(id, verdict, client) {
  await recordBadLink(id, verdict, client);
  if (verdict.error === 'mismatch') throw new AppError('Token verification failed: Resource ID mismatch.', 403);
  throw new AppError(
    verdict.error === 'expired'
      ? 'This approval link has expired. Please ask the HR team to send you a new one.'
      : 'Invalid or expired approval token.',
    401,
  );
}

/**
 * An expired link that we signed for this MRF, on an MRF that is already
 * decided: the approver is shown who decided instead of "link expired" (N16).
 * @returns {Promise<object|null>} the rpa_mrf row, or null when the normal
 *   rejection applies
 */
async function decidedMrfBehindExpiredLink(id, verdict) {
  if (verdict.error !== 'expired' || !verdict.signedForThisMrf || !/^\d+$/.test(String(id))) return null;
  const mrf = await prisma.rpa_mrf.findUnique({ where: { id: BigInt(id) } });
  return mrf && publicDecision(mrf, null) ? mrf : null;
}

/** Title (e.g. "CEO") of whoever decided, from the approver roster. Never throws. */
function decidedByTitleFor(mrf, roster) {
  return mrf?.decided_by_email ? titleForApprover(roster, mrf.decided_by_email) : null;
}

/** "Already decided" message with the decider's current roster name and title. Never throws. */
async function alreadyDecidedMessageFor(mrf) {
  const roster = await rosterForDisplay();
  return alreadyDecidedMessage(withRosterDeciderName(mrf, roster), decidedByTitleFor(mrf, roster));
}

/** "This MRF has already been approved by the CEO Abhijit Roy on 9 Oct 2026, 10:43 AM IST." */
function alreadyDecidedMessage(mrf, title) {
  if (isHeld(mrf?.approval_status)) {
    const by = mrf.held_by_name ? ` by ${mrf.held_by_name}` : '';
    const until = mrf.held_until ? ` until ${dateLabel(isoDate(mrf.held_until))}` : '';
    return `This MRF was put on hold${by}${until}. A new approval email will be sent to every approver on that date.`;
  }
  const name = mrf?.decided_by_name && !String(mrf.decided_by_name).startsWith('Unknown') ? mrf.decided_by_name : null;
  const by = name ? ` by ${title ? `the ${title} ` : ''}${name}` : '';
  const when = mrf?.decided_at ? ` on ${formatIst(mrf.decided_at)}` : '';
  return `This MRF has already been ${decisionWord(mrf?.approval_status)}${by}${when}.`;
}

async function recordBadLink(id, verdict, client) {
  if (/^\d+$/.test(String(id)) && shouldRecordFailure(`${client.ip}:${id}:${verdict.error}`)) {
    const exists = await prisma.rpa_mrf.findUnique({ where: { id: BigInt(id) }, select: { id: true } }).catch(() => null);
    if (exists) {
      const row = verdict.expiredTokenRow;
      await recordEvent({
        mrf_id: BigInt(id),
        token_id: row?.id ?? null,
        event_type: verdict.error === 'expired' ? 'token_expired' : 'token_invalid',
        actor_email: row?.approver_email ?? null,
        actor_name: row?.approver_name ?? null,
        identity_source: row ? 'personal_link' : 'system',
        ip_address: client.ip,
        user_agent: client.userAgent,
        meta: { reason: verdict.error },
      });
    }
  }
}

/**
 * Revoke reasons after which an OPEN MRF has newer links: an HR re-issue, or a
 * hold (the MRF came back from hold with fresh links to every approver).
 */
const SUPERSEDED_REASONS = new Set(['reissued', HELD_STATUS]);

/** Link state the page shows for a personal token. */
function linkState(tokenRow, mrf) {
  if (!tokenRow) return 'legacy';
  if (tokenRow.revoked_at && SUPERSEDED_REASONS.has(tokenRow.revoked_reason) && isOpenApprovalStatus(mrf.approval_status)) {
    return 'replaced';
  }
  return 'active';
}

const isHeld = (status) => String(status || '').trim().toLowerCase() === HELD_STATUS;

// ── Public details (the page the approver opens) ───────────────────────

async function trackLinkOpen(tokenRow, mrf, client) {
  try {
    const now = new Date();
    await prisma.rpa_mrf_approval_tokens.update({
      where: { id: tokenRow.id },
      data: {
        first_opened_at: tokenRow.first_opened_at ?? now,
        last_opened_at: now,
        open_count: { increment: 1 },
      },
    });
    const recent = await prisma.rpa_mrf_approval_events.findFirst({
      where: { token_id: tokenRow.id, event_type: 'link_opened', created_at: { gt: new Date(now.getTime() - LINK_OPEN_THROTTLE_MS) } },
      select: { id: true },
    });
    if (recent) return;
    await recordEvent({
      mrf_id: mrf.id,
      token_id: tokenRow.id,
      event_type: 'link_opened',
      actor_email: tokenRow.approver_email,
      actor_name: tokenRow.approver_name,
      identity_source: 'personal_link',
      ip_address: client.ip,
      user_agent: client.userAgent,
      likely_scanner: looksLikeScanner(client.userAgent, tokenRow.issued_at, now),
      meta: { statusAtOpen: mrf.approval_status },
    });
  } catch (err) {
    logger.warn(`[MRF approval] link-open tracking failed for token ${tokenRow?.id}: ${err.message}`);
  }
}

/**
 * The MRF as the public approval page may see it, plus the decision (name and
 * time only) and whose personal link is open. Never exposes the decider's
 * email, IP or device.
 */
export async function getPublicDetails(id, token, client) {
  const verdict = await verifyApprovalLink(id, token);
  let expiredButDecided = null;
  if (verdict.error) {
    expiredButDecided = await decidedMrfBehindExpiredLink(id, verdict);
    if (!expiredButDecided) await rejectBadLink(id, verdict, client);
    await recordBadLink(id, verdict, client);
  }

  const mrf = expiredButDecided || await prisma.rpa_mrf.findUnique({ where: { id: BigInt(id) } });
  if (!mrf) throw new AppError('Requisition request not found.', 404);

  const tokenRow = expiredButDecided ? verdict.expiredTokenRow : verdict.tokenRow;
  if (tokenRow && !expiredButDecided) await trackLinkOpen(tokenRow, mrf, client);

  const roster = await rosterForDisplay();
  const shown = withRosterDeciderName(mrf, roster);
  const {
    decided_ip: _ip, decided_by_email: _email, decision_event_id: _ev, decision_comments: comments,
    held_by_email: _heldBy, hold_note: holdNote, ...safe
  } = shown;
  const decision = publicDecision(shown, tokenRow?.approver_email);
  // Hold is offered on personal links only, while the feature is on (plan P10).
  const holdConfig = config.mrfHold.enabled && tokenRow ? holdDateBounds(await getHoldRules()) : null;
  return {
    ...safe,
    hold_count: mrf.hold_count ?? 0,
    hold_config: holdConfig,
    id: mrf.id.toString(),
    approver: tokenRow
      ? { name: nameForApprover(roster, tokenRow.approver_email, tokenRow.approver_name) || tokenRow.approver_email }
      : null,
    link_state: expiredButDecided ? 'expired' : linkState(tokenRow, mrf),
    decision: decision
      ? {
        ...decision,
        decidedByTitle: decision.status === HELD_STATUS
          ? (mrf.held_by_email ? titleForApprover(roster, mrf.held_by_email) : null)
          : decidedByTitleFor(mrf, roster),
        comments: (decision.status === HELD_STATUS ? holdNote : comments) || null,
      }
      : null,
  };
}

// ── The decision ───────────────────────────────────────────────────────

const STATUS_FOR_ACTION = Object.freeze({ approve: 'approved', reject: 'rejected', hold: HELD_STATUS });

/**
 * The one transaction every decision goes through — an approver's link or an
 * on-behalf decision in the ATS; approve, reject or hold. Exactly one decision
 * per MRF can win: the status update is conditional on the status just read.
 *
 * Hold is not final: it parks the MRF (approval_status 'held'), closes every
 * open link (reason 'held') and every reminder, and leaves decided_* empty.
 * mrfHoldSweep brings it back to pending on the hold-until date.
 *
 * @param {object} p
 * @param {object} p.mrf          rpa_mrf row as read
 * @param {{ email: string|null, name: string, source: string }} p.actor
 * @param {'approve'|'reject'|'hold'} p.action
 * @param {string|null} p.comment
 * @param {string|null} [p.holdUntil]  'YYYY-MM-DD', validated, for hold
 * @param {object|null} [p.tokenRow]   the personal link used, if any
 * @param {{ ip: string|null, userAgent: string|null }} p.client
 * @param {'email_link'|'ats_delegate'} p.via
 * @param {object} [p.meta]           extra audit detail (on-behalf context)
 * @returns {Promise<{ conflict: boolean, eventId?: bigint, hmFallback?: string, newStatus: string, at: Date }>}
 */
async function applyDecision({ mrf, actor, action, comment, holdUntil = null, tokenRow = null, client, via, meta = {} }) {
  const newStatus = STATUS_FOR_ACTION[action];
  const now = new Date();
  const base = {
    mrf_id: mrf.id,
    token_id: tokenRow?.id ?? null,
    actor_email: actor.email,
    actor_name: actor.name,
    identity_source: actor.source,
    ip_address: client.ip,
    user_agent: client.userAgent,
    comments: comment,
  };

  const result = await prisma.$transaction(async (tx) => {
    const attemptAfterDecision = () => tx.rpa_mrf_approval_events.create({
      data: { ...base, event_type: 'attempt_after_decision', prior_status: mrf.approval_status, meta: { attemptedAction: newStatus, via, ...meta } },
    });
    if (!isOpenApprovalStatus(mrf.approval_status)) {
      await attemptAfterDecision();
      return { conflict: true };
    }

    const statusData = action === 'hold'
      ? {
        approval_status: HELD_STATUS,
        held_at: now,
        held_until: new Date(`${holdUntil}T00:00:00Z`),
        held_by_email: actor.email,
        held_by_name: actor.name,
        hold_note: comment,
        hold_count: { increment: 1 },
        hold_released_at: null,
      }
      : {
        approval_status: newStatus,
        decided_by_email: actor.email,
        decided_by_name: actor.name,
        decided_at: now,
        decided_ip: client.ip,
        decision_comments: comment,
        decided_via: via,
      };
    // Conditional on the exact status just read: only one request can win.
    const { count } = await tx.rpa_mrf.updateMany({
      where: { id: mrf.id, approval_status: mrf.approval_status },
      data: statusData,
    });
    if (count === 0) {
      await attemptAfterDecision();
      return { conflict: true };
    }

    const event = await tx.rpa_mrf_approval_events.create({
      data: {
        ...base,
        event_type: newStatus,
        prior_status: mrf.approval_status,
        new_status: newStatus,
        created_at: now,
        meta: {
          via,
          ...(action === 'hold' ? { holdUntil, holdCount: (mrf.hold_count ?? 0) + 1 } : {}),
          ...meta,
        },
      },
    });
    // Only a final decision is "the" decision of the MRF.
    if (action !== 'hold') {
      await tx.rpa_mrf.update({ where: { id: mrf.id }, data: { decision_event_id: event.id } });
    }

    // The request row's status mirrors the decision ('held' shows as ON HOLD).
    const parentSend = await tx.rpa_mrf_jd_send.findFirst({ where: { mrf_id: Number(mrf.id) } });
    if (parentSend) {
      await tx.rpa_mrf_jd_send.update({ where: { id: parentSend.id }, data: { mrfstatus: newStatus } });
    }

    if (action === 'hold') {
      // Every open link closes, the holder's too: after the hold the approvers
      // get NEW links, and an old one must report "replaced", never decide.
      if (tokenRow) {
        await tx.rpa_mrf_approval_tokens.update({ where: { id: tokenRow.id }, data: { used_at: now } });
      }
      await tx.rpa_mrf_approval_tokens.updateMany({
        where: { mrf_id: mrf.id, revoked_at: null },
        data: { revoked_at: now, revoked_reason: HELD_STATUS },
      });
    } else {
      if (tokenRow) {
        await tx.rpa_mrf_approval_tokens.update({ where: { id: tokenRow.id }, data: { used_at: now } });
      }
      // Every other still-open link for this MRF closes now.
      await tx.rpa_mrf_approval_tokens.updateMany({
        where: { mrf_id: mrf.id, used_at: null, revoked_at: null, ...(tokenRow ? { id: { not: tokenRow.id } } : {}) },
        data: { revoked_at: now, revoked_reason: via === 'ats_delegate' ? 'decided_by_delegate' : 'decided_by_other' },
      });
    }
    // No reminder may follow a decision (or a hold).
    await tx.rpa_email_log.updateMany({
      where: { email_type: { in: [...MRF_APPROVAL_LOG_TYPES] }, reference_id: Number(mrf.id), responded_at: null },
      data: { responded_at: now },
    });
    return { conflict: false, eventId: event.id, hmFallback: parentSend?.email || '' };
  }, { timeout: 15000, maxWait: 10000 });

  return { ...result, newStatus, at: now };
}

/** Throw the "already decided / on hold" 409 with the MRF's current state. */
async function throwConflict(mrfId) {
  const current = await prisma.rpa_mrf.findUnique({
    where: { id: mrfId },
    select: {
      approval_status: true, decided_by_name: true, decided_by_email: true, decided_at: true,
      held_by_name: true, held_until: true,
    },
  });
  throw new AppError(await alreadyDecidedMessageFor(current), 409);
}

/** Validate a hold request against the hold rules; returns the clean date. */
async function resolveHoldUntil(action, holdUntil, comment) {
  if (action !== 'hold') return null;
  if (!config.mrfHold.enabled) throw new AppError('Putting an MRF on hold is not switched on.', 400);
  if (!comment) throw new AppError('Please add a note saying why the MRF is being put on hold.', 400);
  const rules = await getHoldRules();
  const check = validateHoldUntil(holdUntil, { maxDays: rules.maxDays });
  if (!check.ok) throw new AppError(check.error, 400);
  return check.date;
}

/** Background notifications after a committed decision or hold. Never throws. */
function notifyInBackground(id, action, hmFallback) {
  const job = action === 'hold' ? notifyAfterHold(id, { hmFallback }) : notifyAfterDecision(id, { hmFallback });
  job.catch((err) => {
    logger.error(`[MRF approval] post-${action} notifications failed for MRF ${id}: ${err.message}`);
  });
}

/**
 * Approve, reject or hold through a link. Exactly one decision per MRF can win.
 * @param {string} id
 * @param {{ token: string, action: 'approve'|'reject'|'hold', comments?: string, holdUntil?: string }} input
 * @param {{ ip: string|null, userAgent: string|null }} client
 */
export async function decide(id, { token, action, comments, holdUntil }, client) {
  const verdict = await verifyApprovalLink(id, token);
  if (verdict.error) {
    // An expired link can never decide, but on an MRF that is already decided
    // the approver is told who decided rather than "link expired" (N16).
    const decided = await decidedMrfBehindExpiredLink(id, verdict);
    if (decided) {
      await recordBadLink(id, verdict, client);
      throw new AppError(await alreadyDecidedMessageFor(decided), 409);
    }
    await rejectBadLink(id, verdict, client);
  }

  const mrf = await prisma.rpa_mrf.findUnique({ where: { id: BigInt(id) } });
  if (!mrf) throw new AppError('Requisition request not found.', 404);

  const { tokenRow } = verdict;
  // The decider is recorded under today's roster name, not the copy on a link
  // issued before the roster changed (N32).
  const actor = tokenRow
    ? {
      email: tokenRow.approver_email,
      name: nameForApprover(await rosterForDisplay(), tokenRow.approver_email, tokenRow.approver_name) || tokenRow.approver_email,
      source: 'personal_link',
    }
    : { email: null, name: LEGACY_ACTOR_NAME, source: 'legacy_shared_link' };
  const comment = clampText(comments, MAX_COMMENT_LENGTH);
  const newStatus = STATUS_FOR_ACTION[action];

  // A link replaced by an HR re-issue (or by the links sent after a hold) must
  // not decide while the MRF is open.
  if (linkState(tokenRow, mrf) === 'replaced') {
    await recordEvent({
      mrf_id: mrf.id,
      token_id: tokenRow?.id ?? null,
      actor_email: actor.email,
      actor_name: actor.name,
      identity_source: actor.source,
      ip_address: client.ip,
      user_agent: client.userAgent,
      comments: comment,
      event_type: 'token_revoked_used',
      prior_status: mrf.approval_status,
      meta: { attemptedAction: newStatus },
    });
    throw new AppError('This approval link was replaced by a newer one. Please use the most recent approval email.', 409);
  }
  // Hold needs a known approver (to say who held it); legacy shared links have none.
  if (action === 'hold' && !tokenRow) {
    throw new AppError('This older approval link cannot put an MRF on hold. Please use the most recent approval email.', 400);
  }
  const holdDate = await resolveHoldUntil(action, holdUntil, comment);

  const result = await applyDecision({
    mrf, actor, action, comment, holdUntil: holdDate, tokenRow, client, via: 'email_link',
  });
  if (result.conflict) await throwConflict(mrf.id);

  // No token, ever. IP and browser are here too, so evidence also exists in
  // combined.log should the database be unavailable.
  logger.info(`MRF ${id} ${newStatus} via approval link by ${actor.name} at ${result.at.toISOString()}`, {
    mrfId: id, decision: newStatus, actorEmail: actor.email, identitySource: actor.source,
    ip: client.ip, userAgent: client.userAgent, ...(holdDate ? { holdUntil: holdDate } : {}),
  });

  // After commit, in the background: the approver gets their answer now.
  notifyInBackground(mrf.id, action, result.hmFallback);

  return {
    approval_status: newStatus,
    decided_by_name: actor.name,
    decided_at: result.at,
    ...(holdDate ? { held_until: holdDate, held_until_label: dateLabel(holdDate) } : {}),
  };
}

/** The ATS user as an audit actor: "First Last" (Role). */
function atsActor(user) {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || user?.email || 'ATS user';
  return { email: user?.email || null, name, source: 'ats_user' };
}

/**
 * Approve, reject or hold from the ATS on behalf of the approvers (HR Admin
 * Recruiter / Admin / Super Admin, only while the approvers are marked away).
 * A reason is always required: the approvers are emailed it.
 *
 * @param {string} id  rpa_mrf id
 * @param {{ action: 'approve'|'reject'|'hold', comments: string, holdUntil?: string }} input
 * @param {object} user  req.user
 * @param {{ ip: string|null, userAgent: string|null }} client
 */
export async function decideOnBehalf(id, { action, comments, holdUntil }, user, client) {
  if (!config.mrfHold.delegateDecisionEnabled) {
    throw new AppError('Deciding on behalf of the approvers is not switched on.', 400);
  }
  if (!config.mrfApprovalAudit.enabled) {
    throw new AppError('Personal approval links are switched off (MRF_APPROVAL_AUDIT_ENABLED=false).', 409);
  }
  const absence = await getAbsence();
  const allowed = canDecideAsDelegate({ user, absence });
  if (!allowed.ok) throw new AppError(delegateRefusalMessage(allowed.reason), 403);

  const comment = clampText(comments, MAX_COMMENT_LENGTH);
  if (!comment) throw new AppError('Please give a reason. It is emailed to the approvers.', 400);
  const holdDate = await resolveHoldUntil(action, holdUntil, comment);

  const mrf = await prisma.rpa_mrf.findUnique({ where: { id: BigInt(id) } });
  if (!mrf) throw new AppError('Requisition request not found.', 404);

  const actor = atsActor(user);
  const roster = await rosterForDisplay();
  const result = await applyDecision({
    mrf,
    actor,
    action,
    comment,
    holdUntil: holdDate,
    client,
    via: 'ats_delegate',
    meta: {
      onBehalfOf: roster.map((a) => a.email),
      actorRole: user.role,
      actorUserId: user.id ?? null,
      absence: { from: absence.from, to: absence.to, setByName: absence.setByName || null },
    },
  });
  if (result.conflict) await throwConflict(mrf.id);

  logger.info(`MRF ${id} ${result.newStatus} on behalf of the approvers by ${actor.name} (${user.role})`, {
    mrfId: id, decision: result.newStatus, actorEmail: actor.email, identitySource: 'ats_user',
    ...(holdDate ? { holdUntil: holdDate } : {}),
  });
  notifyInBackground(mrf.id, action, result.hmFallback);

  return {
    approval_status: result.newStatus,
    decided_by_name: actor.name,
    decided_at: result.at,
    ...(holdDate ? { held_until: holdDate, held_until_label: dateLabel(holdDate) } : {}),
  };
}

// ── Held MRFs: change the date, release ────────────────────────────────

/** A held MRF, or a 404 / 409 in words. */
async function loadHeldMrf(id) {
  const mrf = await prisma.rpa_mrf.findUnique({ where: { id: BigInt(id) } });
  if (!mrf) throw new AppError('Requisition request not found.', 404);
  if (!isHeld(mrf.approval_status)) {
    throw new AppError(`This requisition is not on hold (it is ${decisionWord(mrf.approval_status)}).`, 409);
  }
  return mrf;
}

/** Same gate as Settings › Held MRFs: HR Admin Recruiter and above. */
function assertMayManageHolds(user) {
  if (!canDecideOnBehalf(user?.role)) {
    throw new AppError('Only an HR Admin Recruiter, Admin or Super Admin can change or release a hold.', 403);
  }
}

/**
 * Move the hold-until date of a held MRF (no absence window needed: it does
 * not decide the MRF). Validated against today's hold rules.
 */
export async function changeHoldDate(id, { holdUntil, note }, user) {
  assertMayManageHolds(user);
  const mrf = await loadHeldMrf(id);
  const rules = await getHoldRules();
  const check = validateHoldUntil(holdUntil, { maxDays: rules.maxDays });
  if (!check.ok) throw new AppError(check.error, 400);
  const previous = mrf.held_until ? isoDate(mrf.held_until) : null;
  if (previous === check.date) throw new AppError('That is already the hold-until date.', 400);

  const actor = atsActor(user);
  const cleanNote = clampText(note, MAX_COMMENT_LENGTH);
  const { count } = await prisma.rpa_mrf.updateMany({
    where: { id: mrf.id, approval_status: HELD_STATUS },
    data: { held_until: new Date(`${check.date}T00:00:00Z`) },
  });
  if (count === 0) await throwConflict(mrf.id);
  await recordEvent({
    mrf_id: mrf.id,
    event_type: 'hold_date_changed',
    actor_email: actor.email,
    actor_name: actor.name,
    identity_source: 'ats_user',
    prior_status: HELD_STATUS,
    new_status: HELD_STATUS,
    comments: cleanNote,
    meta: { from: previous, to: check.date, actorRole: user.role },
  });
  logger.info(`MRF ${id} hold date changed ${previous} -> ${check.date} by ${actor.name}`);

  const roster = await rosterForDisplay();
  sendMrfHoldNoticeEmail({
    mrfRecord: mrf,
    hold: {
      kind: 'date_changed',
      byName: actor.name,
      atIst: formatIst(new Date()),
      untilLabel: dateLabel(check.date),
      previousUntilLabel: previous ? dateLabel(previous) : null,
      note: cleanNote,
    },
    hmEmail: mrf.submitter_email || '',
    approverEmails: roster.map((a) => a.email),
  }).catch(() => {});

  return { held_until: check.date, held_until_label: dateLabel(check.date) };
}

/**
 * Bring a held MRF back to pending and send the approval email again — to
 * every approver on today's roster, the same email as the first time with a
 * "Back from hold" banner. Used by the daily sweep (trigger 'date') and by
 * "Release now" (trigger 'manual').
 *
 * Exactly once: the conditional held -> pending update is the claim, so a
 * second process (or a double click) finds nothing to release.
 *
 * @returns {Promise<{ released: boolean, sent: number }>}
 */
export async function releaseHold(mrfId, { trigger = 'date', user = null, frontendUrl = null } = {}) {
  const id = BigInt(mrfId);
  const mrf = await prisma.rpa_mrf.findUnique({ where: { id } });
  if (!mrf || !isHeld(mrf.approval_status)) return { released: false, sent: 0 };
  const now = new Date();
  const actor = user ? atsActor(user) : { email: null, name: 'System (hold-until date reached)', source: 'system' };

  const claimed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.rpa_mrf.updateMany({
      where: { id, approval_status: HELD_STATUS },
      data: { approval_status: 'pending', hold_released_at: now },
    });
    if (count === 0) return false;
    await tx.rpa_mrf_approval_events.create({
      data: {
        mrf_id: id,
        event_type: 'hold_released',
        actor_email: actor.email,
        actor_name: actor.name,
        identity_source: actor.source,
        prior_status: HELD_STATUS,
        new_status: 'pending',
        created_at: now,
        meta: {
          trigger,
          heldUntil: mrf.held_until ? isoDate(mrf.held_until) : null,
          heldBy: mrf.held_by_name,
          holdNote: mrf.hold_note,
          holdCount: mrf.hold_count,
          ...(user ? { actorRole: user.role } : {}),
        },
      },
    });
    // Back to the status it had when it first went for approval.
    const parentSend = await tx.rpa_mrf_jd_send.findFirst({ where: { mrf_id: Number(id) } });
    if (parentSend) {
      await tx.rpa_mrf_jd_send.update({ where: { id: parentSend.id }, data: { mrfstatus: 'managersubmitted' } });
    }
    return true;
  }, { timeout: 15000, maxWait: 10000 });
  if (!claimed) return { released: false, sent: 0 };

  const fresh = await prisma.rpa_mrf.findUnique({ where: { id } });
  const sent = await issueApprovalRequests({
    mrfRecord: fresh,
    frontendUrl: frontendUrl || config.cors.frontendUrl,
    reason: 'hold_released',
    actor: user ? { id: user.id ?? null, email: actor.email, name: actor.name } : null,
    backFromHold: {
      heldByName: mrf.held_by_name,
      heldAtLabel: mrf.held_at ? formatIst(mrf.held_at) : null,
      heldUntilLabel: mrf.held_until ? dateLabel(isoDate(mrf.held_until)) : null,
      note: mrf.hold_note,
    },
  });
  if (sent === 0) {
    logger.error(`[MRF hold] MRF ${mrfId} is back to pending but NO approval email went out — use "Re-send approval links" on the MRF page.`);
  }
  logger.info(`[MRF hold] MRF ${mrfId} released from hold (${trigger}) by ${actor.name}; ${sent} approval email(s) sent.`);
  return { released: true, sent };
}

/** "Release now" from the ATS. */
export async function releaseHoldNow(id, user, { frontendUrl } = {}) {
  assertMayManageHolds(user);
  const mrf = await loadHeldMrf(id);
  if (mrf.closed_at || mrf.filled_at) {
    throw new AppError('This requisition is closed. Re-open it first, then release the hold.', 409);
  }
  const result = await releaseHold(id, { trigger: 'manual', user, frontendUrl });
  if (!result.released) await throwConflict(BigInt(id));
  return result;
}

/**
 * Every held MRF whose hold-until date (IST) is today or earlier and which is
 * still hiring (not closed / filled). Catch-up is built in: a missed day is
 * released on the next run.
 */
export async function releaseDueHolds({ today = todayIst() } = {}) {
  const due = await prisma.rpa_mrf.findMany({
    where: {
      approval_status: HELD_STATUS,
      held_until: { lte: new Date(`${today}T00:00:00Z`) },
      closed_at: null,
      filled_at: null,
    },
    select: { id: true },
    orderBy: { held_until: 'asc' },
  });
  let released = 0;
  let emails = 0;
  for (const { id } of due) {
    try {
      const r = await releaseHold(id, { trigger: 'date' });
      if (r.released) { released += 1; emails += r.sent; }
    } catch (err) {
      logger.error(`[MRF hold] could not release MRF ${id}: ${err.message}`);
    }
  }
  return { due: due.length, released, emails };
}

/** Held MRFs for Settings › Held MRFs, soonest release first. */
export async function listHeldMrfs() {
  const rows = await prisma.rpa_mrf.findMany({
    where: { approval_status: HELD_STATUS },
    select: {
      id: true, position_hiring_for: true, hiring_manager_name: true, held_at: true, held_until: true,
      held_by_name: true, hold_note: true, hold_count: true, closed_at: true,
    },
    orderBy: { held_until: 'asc' },
  });
  const today = todayIst();
  return rows.map((r) => {
    const until = r.held_until ? isoDate(r.held_until) : null;
    return {
      id: r.id.toString(),
      position: r.position_hiring_for,
      hiring_manager: r.hiring_manager_name,
      held_at: r.held_at,
      held_at_ist: r.held_at ? formatIst(r.held_at) : null,
      held_until: until,
      held_until_label: until ? dateLabel(until) : null,
      days_left: until ? Math.max(0, Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)) : null,
      held_by_name: r.held_by_name,
      hold_note: r.hold_note,
      hold_count: r.hold_count,
      closed: Boolean(r.closed_at),
    };
  });
}

// ── After the decision ─────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry a send that reports failure by returning falsy (the email helpers never throw). */
async function withRetry(label, fn, attempts = 3) {
  for (let i = 1; i <= attempts; i += 1) {
    const out = await fn();
    if (out) return out;
    if (i < attempts) {
      logger.warn(`[MRF approval] ${label} failed (attempt ${i}/${attempts}); retrying.`);
      await sleep(i * 3000);
    }
  }
  logger.error(`[MRF approval] ${label} failed after ${attempts} attempts.`);
  return null;
}

/**
 * Outcome email to HR, "already actioned" notice to every other approver, and a
 * confirmation to the one who decided. Each notice is sent at most once per
 * recipient (checked against the audit trail), so a retry or a second call can
 * never double-send.
 */
export async function notifyAfterDecision(mrfId, { hmFallback = '' } = {}) {
  const mrf = await prisma.rpa_mrf.findUnique({ where: { id: BigInt(mrfId) } });
  // A hold is not a decision: notifyAfterHold tells people about it.
  if (!mrf || isOpenApprovalStatus(mrf.approval_status) || isHeld(mrf.approval_status)) return;
  if (mrf.decided_via === 'ats_delegate') return notifyAfterDelegateDecision(mrf, { hmFallback });
  const tokens = await prisma.rpa_mrf_approval_tokens.findMany({ where: { mrf_id: mrf.id }, orderBy: { id: 'asc' } });
  const isLegacy = !mrf.decided_by_email;

  const decision = {
    word: decisionWord(mrf.approval_status),
    byName: mrf.decided_by_name || LEGACY_ACTOR_NAME,
    atIst: formatIst(mrf.decided_at || new Date()),
    comments: mrf.decision_comments,
  };

  // Everyone the request went to: token holders, or (for a legacy shared link)
  // the current roster.
  const recipients = new Map();
  for (const t of tokens) recipients.set(t.approver_email.toLowerCase(), { email: t.approver_email, name: t.approver_name || t.approver_email });
  if (isLegacy && recipients.size === 0) {
    for (const a of await getApproverRoster()) recipients.set(a.email.toLowerCase(), a);
  }

  await withRetry(`outcome email for MRF ${mrf.id}`, () => sendMrfOutcomeEmail({
    mrfRecord: mrf,
    approved: mrf.approval_status === 'approved',
    comments: mrf.decision_comments || '',
    hmEmail: mrf.submitter_email || hmFallback,
    decidedBy: { name: decision.byName, atIst: decision.atIst },
    approverEmails: [...recipients.values()].map((r) => r.email),
  }));

  // Only notices sent for THIS decision count: a hold earlier in the MRF's life
  // also sent a confirmation, and must not suppress this one.
  const already = await prisma.rpa_mrf_approval_events.findMany({
    where: {
      mrf_id: mrf.id,
      event_type: { in: ['other_approvers_notified', 'decision_confirmation_sent'] },
      ...(mrf.decided_at ? { created_at: { gte: mrf.decided_at } } : {}),
    },
    select: { event_type: true, actor_email: true },
  });
  const done = new Set(already.map((e) => `${e.event_type}:${String(e.actor_email).toLowerCase()}`));
  const deciderEmail = (mrf.decided_by_email || '').toLowerCase();

  for (const r of recipients.values()) {
    const isDecider = deciderEmail && r.email.toLowerCase() === deciderEmail;
    const eventType = isDecider ? 'decision_confirmation_sent' : 'other_approvers_notified';
    if (done.has(`${eventType}:${r.email.toLowerCase()}`)) continue;
    const logId = await withRetry(`${eventType} to ${r.email} for MRF ${mrf.id}`, () => (isDecider
      ? sendMrfDecisionConfirmationEmail({ mrfRecord: mrf, recipient: r, decision })
      : sendMrfAlreadyActionedEmail({ mrfRecord: mrf, recipient: r, decision })));
    if (logId) {
      await recordEvent({
        mrf_id: mrf.id,
        event_type: eventType,
        actor_email: r.email,
        actor_name: r.name,
        identity_source: 'system',
        meta: { emailLogId: logId, decisionEventId: mrf.decision_event_id ? String(mrf.decision_event_id) : null },
      });
    }
  }
}

/** Event types already sent per recipient, so a retry never double-sends. */
async function alreadyNotified(mrfId, types) {
  const rows = await prisma.rpa_mrf_approval_events.findMany({
    where: { mrf_id: mrfId, event_type: { in: types } },
    select: { event_type: true, actor_email: true, created_at: true },
  });
  return rows;
}

/**
 * After an on-behalf decision in the ATS: the outcome email to HR (as for any
 * decision), an "on your behalf" notice to EVERY approver, and a confirmation
 * to the person who decided. Each at most once per recipient.
 */
async function notifyAfterDelegateDecision(mrf, { hmFallback = '' } = {}) {
  const roster = await getApproverRoster();
  const decidedAt = mrf.decided_at || new Date();
  const event = mrf.decision_event_id
    ? await prisma.rpa_mrf_approval_events.findUnique({ where: { id: mrf.decision_event_id }, select: { meta: true } })
    : null;
  const meta = event?.meta || {};
  const decision = {
    word: decisionWord(mrf.approval_status),
    byName: mrf.decided_by_name || 'ATS user',
    byRoleLabel: roleLabel(meta.actorRole) || 'ATS user',
    atIst: formatIst(decidedAt),
    comments: mrf.decision_comments,
  };

  await withRetry(`outcome email for MRF ${mrf.id}`, () => sendMrfOutcomeEmail({
    mrfRecord: mrf,
    approved: mrf.approval_status === 'approved',
    comments: mrf.decision_comments || '',
    hmEmail: mrf.submitter_email || hmFallback,
    decidedBy: { name: `${decision.byName} (${decision.byRoleLabel}, on behalf of the approvers)`, atIst: decision.atIst },
    approverEmails: roster.map((a) => a.email),
  }));

  const done = new Set((await alreadyNotified(mrf.id, ['delegate_notice_sent', 'decision_confirmation_sent']))
    .filter((e) => e.created_at >= decidedAt)
    .map((e) => `${e.event_type}:${String(e.actor_email).toLowerCase()}`));
  const absence = meta.absence?.from && meta.absence?.to
    ? { from: dateLabel(meta.absence.from), to: dateLabel(meta.absence.to) }
    : null;

  for (const approver of roster) {
    if (done.has(`delegate_notice_sent:${approver.email.toLowerCase()}`)) continue;
    const logId = await withRetry(`on-behalf notice to ${approver.email} for MRF ${mrf.id}`, () => sendMrfDelegateDecisionNoticeEmail({
      mrfRecord: mrf, recipient: approver, decision, absence,
    }));
    if (logId) {
      await recordEvent({
        mrf_id: mrf.id,
        event_type: 'delegate_notice_sent',
        actor_email: approver.email,
        actor_name: approver.name,
        identity_source: 'system',
        meta: { emailLogId: logId, decisionEventId: mrf.decision_event_id ? String(mrf.decision_event_id) : null },
      });
    }
  }

  const deciderEmail = mrf.decided_by_email;
  if (deciderEmail && !done.has(`decision_confirmation_sent:${deciderEmail.toLowerCase()}`)) {
    const recipient = { email: deciderEmail, name: decision.byName };
    const logId = await withRetry(`decision confirmation to ${deciderEmail} for MRF ${mrf.id}`, () => sendMrfDecisionConfirmationEmail({ mrfRecord: mrf, recipient, decision }));
    if (logId) {
      await recordEvent({
        mrf_id: mrf.id,
        event_type: 'decision_confirmation_sent',
        actor_email: deciderEmail,
        actor_name: decision.byName,
        identity_source: 'system',
        meta: { emailLogId: logId },
      });
    }
  }
}

/**
 * After a hold: one notice to HR + the hiring manager + the approvers who did
 * not hold it (plan D4), and a confirmation to whoever held it. If the hold was
 * on behalf of the approvers, every approver also gets the on-behalf notice.
 * Each at most once per hold (checked against the trail since the hold began).
 */
export async function notifyAfterHold(mrfId, { hmFallback = '' } = {}) {
  const mrf = await prisma.rpa_mrf.findUnique({ where: { id: BigInt(mrfId) } });
  if (!mrf || !isHeld(mrf.approval_status)) return;
  const heldAt = mrf.held_at || new Date();
  const untilIso = mrf.held_until ? isoDate(mrf.held_until) : null;
  const untilLabel = untilIso ? dateLabel(untilIso) : '';
  const roster = await getApproverRoster();
  const holderEmail = (mrf.held_by_email || '').toLowerCase();
  const holdEvent = await prisma.rpa_mrf_approval_events.findFirst({
    where: { mrf_id: mrf.id, event_type: HELD_STATUS },
    orderBy: { id: 'desc' },
    select: { identity_source: true, meta: true },
  });
  const onBehalf = holdEvent?.meta?.via === 'ats_delegate';

  const sinceHold = (await alreadyNotified(mrf.id, ['hold_notice_sent', 'decision_confirmation_sent', 'delegate_notice_sent']))
    .filter((e) => e.created_at >= heldAt);
  const done = new Set(sinceHold.map((e) => `${e.event_type}:${String(e.actor_email || '').toLowerCase()}`));

  if (!done.has('hold_notice_sent:')) {
    const others = roster.filter((a) => a.email.toLowerCase() !== holderEmail).map((a) => a.email);
    const logId = await withRetry(`hold notice for MRF ${mrf.id}`, () => sendMrfHoldNoticeEmail({
      mrfRecord: mrf,
      hold: {
        kind: 'held',
        byName: onBehalf
          ? `${mrf.held_by_name} (${roleLabel(holdEvent?.meta?.actorRole)}, on behalf of the approvers)`
          : mrf.held_by_name || 'an approver',
        atIst: formatIst(heldAt),
        untilLabel,
        note: mrf.hold_note,
      },
      hmEmail: mrf.submitter_email || hmFallback,
      approverEmails: others,
    }));
    if (logId) {
      await recordEvent({
        mrf_id: mrf.id,
        event_type: 'hold_notice_sent',
        actor_email: null,
        actor_name: 'HR, hiring manager and approvers',
        identity_source: 'system',
        meta: { emailLogId: logId, heldUntil: untilIso },
      });
    }
  }

  const decision = {
    word: decisionWord(HELD_STATUS),
    byName: mrf.held_by_name || 'an approver',
    byRoleLabel: onBehalf ? roleLabel(holdEvent?.meta?.actorRole) : 'Approver',
    atIst: formatIst(heldAt),
    comments: mrf.hold_note,
    untilLabel,
  };

  if (onBehalf) {
    for (const approver of roster) {
      if (done.has(`delegate_notice_sent:${approver.email.toLowerCase()}`)) continue;
      const logId = await withRetry(`on-behalf hold notice to ${approver.email} for MRF ${mrf.id}`, () => sendMrfDelegateDecisionNoticeEmail({
        mrfRecord: mrf,
        recipient: approver,
        decision,
        absence: holdEvent?.meta?.absence?.from
          ? { from: dateLabel(holdEvent.meta.absence.from), to: dateLabel(holdEvent.meta.absence.to) }
          : null,
      }));
      if (logId) {
        await recordEvent({
          mrf_id: mrf.id,
          event_type: 'delegate_notice_sent',
          actor_email: approver.email,
          actor_name: approver.name,
          identity_source: 'system',
          meta: { emailLogId: logId, hold: true },
        });
      }
    }
  }

  if (holderEmail && !done.has(`decision_confirmation_sent:${holderEmail}`)) {
    const recipient = { email: mrf.held_by_email, name: mrf.held_by_name || mrf.held_by_email };
    const logId = await withRetry(`hold confirmation to ${holderEmail} for MRF ${mrf.id}`, () => sendMrfDecisionConfirmationEmail({ mrfRecord: mrf, recipient, decision }));
    if (logId) {
      await recordEvent({
        mrf_id: mrf.id,
        event_type: 'decision_confirmation_sent',
        actor_email: mrf.held_by_email,
        actor_name: recipient.name,
        identity_source: 'system',
        meta: { emailLogId: logId, hold: true },
      });
    }
  }
}

// ── Trail (ATS screen) ─────────────────────────────────────────────────

/**
 * The full approval trail for the MRF details screen. IP address and device
 * are personal data: only admin-tier users receive them.
 */
export async function getApprovalTrail(mrfId, { includeClientData = false, user = null } = {}) {
  const id = BigInt(mrfId);
  const mrf = await prisma.rpa_mrf.findUnique({
    where: { id },
    select: {
      id: true, approval_status: true, decided_by_name: true, decided_by_email: true,
      decided_at: true, decided_ip: true, decision_comments: true, position_hiring_for: true,
      decided_via: true, held_at: true, held_until: true, held_by_name: true, hold_note: true,
      hold_count: true, hold_released_at: true, closed_at: true, filled_at: true,
    },
  });
  if (!mrf) throw new AppError('Requisition request not found.', 404);

  const [tokens, events, roster, absence, holdRules] = await Promise.all([
    prisma.rpa_mrf_approval_tokens.findMany({ where: { mrf_id: id }, orderBy: { id: 'asc' } }),
    prisma.rpa_mrf_approval_events.findMany({ where: { mrf_id: id }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] }),
    rosterForDisplay(),
    getAbsence().catch(() => ({ active: false })),
    getHoldRules().catch(() => null),
  ]);
  const heldNow = isHeld(mrf.approval_status);
  const untilIso = mrf.held_until ? isoDate(mrf.held_until) : null;
  const onBehalf = canDecideAsDelegate({ user, absence });
  const featureOn = config.mrfHold.delegateDecisionEnabled && config.mrfApprovalAudit.enabled;
  // Names were copied when the request went out; show today's roster names
  // (N32). The stored rows, and the append-only events, stay as recorded.
  const nameFor = (email, stored) => nameForApprover(roster, email, stored);

  return {
    mrf_id: mrf.id.toString(),
    approval_status: mrf.approval_status,
    decision: mrf.decided_at ? {
      decided_by_name: nameFor(mrf.decided_by_email, mrf.decided_by_name),
      decided_by_email: mrf.decided_by_email,
      decided_at: mrf.decided_at,
      decided_at_ist: formatIst(mrf.decided_at),
      comments: mrf.decision_comments,
      decided_via: mrf.decided_via,
      ...(includeClientData ? { ip: mrf.decided_ip } : {}),
    } : null,
    hold: {
      held: heldNow,
      held_at_ist: mrf.held_at ? formatIst(mrf.held_at) : null,
      held_until: untilIso,
      held_until_label: untilIso ? dateLabel(untilIso) : null,
      days_left: heldNow && untilIso ? Math.max(0, Math.round((Date.parse(`${untilIso}T00:00:00Z`) - Date.parse(`${todayIst()}T00:00:00Z`)) / 86400000)) : null,
      held_by_name: mrf.held_by_name,
      note: mrf.hold_note,
      hold_count: mrf.hold_count ?? 0,
      released_at_ist: mrf.hold_released_at ? formatIst(mrf.hold_released_at) : null,
      closed: Boolean(mrf.closed_at || mrf.filled_at),
      can_manage: heldNow && canDecideOnBehalf(user?.role),
      enabled: config.mrfHold.enabled,
      config: holdRules ? holdDateBounds(holdRules) : null,
    },
    on_behalf: {
      // Shown only to roles that could ever use it; the reason explains a
      // disabled panel ("only while the approvers are marked away").
      visible: featureOn && canDecideOnBehalf(user?.role) && isOpenApprovalStatus(mrf.approval_status),
      can_decide: featureOn && onBehalf.ok && isOpenApprovalStatus(mrf.approval_status),
      reason: onBehalf.ok ? null : onBehalf.reason,
      message: onBehalf.ok ? null : delegateRefusalMessage(onBehalf.reason),
      absence: absence?.active ? {
        from: absence.from, to: absence.to, from_label: dateLabel(absence.from), to_label: dateLabel(absence.to),
        note: absence.note, set_by_name: absence.setByName,
      } : null,
      hold_enabled: config.mrfHold.enabled,
    },
    approvers: tokens.map((t) => ({
      id: t.id.toString(),
      name: nameFor(t.approver_email, t.approver_name),
      email: t.approver_email,
      issued_at: t.issued_at,
      expires_at: t.expires_at,
      first_opened_at: t.first_opened_at,
      open_count: t.open_count,
      used_at: t.used_at,
      revoked_at: t.revoked_at,
      revoked_reason: t.revoked_reason,
    })),
    events: events.map((e) => ({
      id: e.id.toString(),
      type: e.event_type,
      at: e.created_at,
      at_ist: formatIst(e.created_at),
      actor_name: nameFor(e.actor_email, e.actor_name),
      actor_email: e.actor_email,
      identity_source: e.identity_source,
      prior_status: e.prior_status,
      new_status: e.new_status,
      comments: e.comments,
      likely_scanner: e.likely_scanner,
      meta: e.meta,
      ...(includeClientData ? {
        ip: e.ip_address,
        device: summarizeUserAgent(e.user_agent),
        user_agent: e.user_agent,
        masked: Boolean(e.client_data_masked_at),
      } : {}),
    })),
    client_data_included: includeClientData,
  };
}

// ── Re-issue (HR) ──────────────────────────────────────────────────────

/**
 * Replace every open link for a still-pending MRF with fresh personal links —
 * for an expired link, a changed approver list, or a lost email.
 */
export async function reissueApprovalLinks(mrfId, { user, frontendUrl }) {
  const id = BigInt(mrfId);
  const mrf = await prisma.rpa_mrf.findUnique({ where: { id } });
  if (!mrf) throw new AppError('Requisition request not found.', 404);
  if (!isOpenApprovalStatus(mrf.approval_status)) {
    throw new AppError(`This requisition is already ${decisionWord(mrf.approval_status)}; there is nothing to re-send.`, 409);
  }
  const by = { id: user?.id ?? null, email: user?.email ?? null, name: [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || null };
  const now = new Date();
  const revoked = await prisma.rpa_mrf_approval_tokens.updateMany({
    where: { mrf_id: id, used_at: null, revoked_at: null },
    data: { revoked_at: now, revoked_reason: 'reissued' },
  });
  // Old emails must not be reminded any more; the new ones will be.
  await prisma.rpa_email_log.updateMany({
    where: { email_type: { in: [...MRF_APPROVAL_LOG_TYPES] }, reference_id: Number(id), responded_at: null },
    data: { responded_at: now },
  });
  await recordEvent({
    mrf_id: id,
    event_type: 'links_reissued',
    actor_email: by.email,
    actor_name: by.name,
    identity_source: 'system',
    meta: { revokedLinks: revoked.count, byUserId: by.id },
  });
  const sent = await issueApprovalRequests({ mrfRecord: mrf, frontendUrl, reason: 'reissued', actor: by });
  return { revoked: revoked.count, sent };
}
