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
  LINK_OPEN_THROTTLE_MS,
  MAX_COMMENT_LENGTH,
  MAX_USER_AGENT_LENGTH,
  clampText,
  decisionWord,
  formatIst,
  looksLikeScanner,
  normalizeIp,
  parseApproverRoster,
  publicDecision,
  summarizeUserAgent,
} from '../utils/mrfApprovalRules.js';
import {
  sendMrfPersonalApprovalEmail,
  sendMrfAlreadyActionedEmail,
  sendMrfDecisionConfirmationEmail,
  sendMrfOutcomeEmail,
} from './emailNotification.service.js';

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

// ── Issuing personal links ─────────────────────────────────────────────

/**
 * Create one personal token per approver and email each their own link.
 * Called in the background at submission (and by a re-issue); never throws.
 * @returns {Promise<number>} how many approval emails were sent
 */
export async function issueApprovalRequests({ mrfRecord, frontendUrl, reason = 'submitted', actor = null }) {
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
      // Still attribute the attempt to its approver, if it was a personal link.
      const peek = jwt.decode(token);
      const expiredTokenRow = peek?.jti && /^[0-9a-f-]{36}$/i.test(peek.jti)
        ? await prisma.rpa_mrf_approval_tokens.findUnique({ where: { token_jti: peek.jti } }).catch(() => null)
        : null;
      return { error: 'expired', expiredTokenRow };
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
  if (verdict.error === 'mismatch') throw new AppError('Token verification failed: Resource ID mismatch.', 403);
  throw new AppError(
    verdict.error === 'expired'
      ? 'This approval link has expired. Please ask the HR team to send you a new one.'
      : 'Invalid or expired approval token.',
    401,
  );
}

/** Link state the page shows for a personal token. */
function linkState(tokenRow, mrf) {
  if (!tokenRow) return 'legacy';
  if (tokenRow.revoked_at && tokenRow.revoked_reason === 'reissued' && isOpenApprovalStatus(mrf.approval_status)) {
    return 'replaced';
  }
  return 'active';
}

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
  if (verdict.error) await rejectBadLink(id, verdict, client);

  const mrf = await prisma.rpa_mrf.findUnique({ where: { id: BigInt(id) } });
  if (!mrf) throw new AppError('Requisition request not found.', 404);

  const { tokenRow } = verdict;
  if (tokenRow) await trackLinkOpen(tokenRow, mrf, client);

  const {
    decided_ip: _ip, decided_by_email: _email, decision_event_id: _ev, decision_comments: comments, ...safe
  } = mrf;
  const decision = publicDecision(mrf, tokenRow?.approver_email);
  return {
    ...safe,
    id: mrf.id.toString(),
    approver: tokenRow ? { name: tokenRow.approver_name || tokenRow.approver_email } : null,
    link_state: linkState(tokenRow, mrf),
    decision: decision ? { ...decision, comments: comments || null } : null,
  };
}

// ── The decision ───────────────────────────────────────────────────────

/**
 * Approve or reject through a link. Exactly one decision per MRF can win.
 * @param {string} id
 * @param {{ token: string, action: 'approve'|'reject', comments?: string }} input
 * @param {{ ip: string|null, userAgent: string|null }} client
 */
export async function decide(id, { token, action, comments }, client) {
  const verdict = await verifyApprovalLink(id, token);
  if (verdict.error) await rejectBadLink(id, verdict, client);

  const mrf = await prisma.rpa_mrf.findUnique({ where: { id: BigInt(id) } });
  if (!mrf) throw new AppError('Requisition request not found.', 404);

  const { tokenRow } = verdict;
  const actor = tokenRow
    ? { email: tokenRow.approver_email, name: tokenRow.approver_name || tokenRow.approver_email, source: 'personal_link' }
    : { email: null, name: LEGACY_ACTOR_NAME, source: 'legacy_shared_link' };
  const comment = clampText(comments, MAX_COMMENT_LENGTH);
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
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

  // A link replaced by an HR re-issue must not decide while the MRF is open.
  if (linkState(tokenRow, mrf) === 'replaced') {
    await recordEvent({ ...base, event_type: 'token_revoked_used', prior_status: mrf.approval_status, meta: { attemptedAction: newStatus } });
    throw new AppError('This approval link was replaced by a newer one. Please use the most recent approval email.', 409);
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const attemptAfterDecision = () => tx.rpa_mrf_approval_events.create({
      data: { ...base, event_type: 'attempt_after_decision', prior_status: mrf.approval_status, meta: { attemptedAction: newStatus } },
    });
    if (!isOpenApprovalStatus(mrf.approval_status)) {
      await attemptAfterDecision();
      return { conflict: true };
    }
    // Conditional on the exact status just read: only one request can win.
    const { count } = await tx.rpa_mrf.updateMany({
      where: { id: mrf.id, approval_status: mrf.approval_status },
      data: {
        approval_status: newStatus,
        decided_by_email: actor.email,
        decided_by_name: actor.name,
        decided_at: now,
        decided_ip: client.ip,
        decision_comments: comment,
      },
    });
    if (count === 0) {
      await attemptAfterDecision();
      return { conflict: true };
    }
    const event = await tx.rpa_mrf_approval_events.create({
      data: { ...base, event_type: newStatus, prior_status: mrf.approval_status, new_status: newStatus, created_at: now },
    });
    await tx.rpa_mrf.update({ where: { id: mrf.id }, data: { decision_event_id: event.id } });

    const parentSend = await tx.rpa_mrf_jd_send.findFirst({ where: { mrf_id: Number(mrf.id) } });
    if (parentSend) {
      await tx.rpa_mrf_jd_send.update({ where: { id: parentSend.id }, data: { mrfstatus: newStatus } });
    }
    if (tokenRow) {
      await tx.rpa_mrf_approval_tokens.update({ where: { id: tokenRow.id }, data: { used_at: now } });
    }
    // Every other still-open link for this MRF closes now.
    await tx.rpa_mrf_approval_tokens.updateMany({
      where: { mrf_id: mrf.id, used_at: null, revoked_at: null, ...(tokenRow ? { id: { not: tokenRow.id } } : {}) },
      data: { revoked_at: now, revoked_reason: 'decided_by_other' },
    });
    // No reminder may follow a decision.
    await tx.rpa_email_log.updateMany({
      where: { email_type: { in: [...MRF_APPROVAL_LOG_TYPES] }, reference_id: Number(mrf.id), responded_at: null },
      data: { responded_at: now },
    });
    return { conflict: false, eventId: event.id, hmFallback: parentSend?.email || '' };
  }, { timeout: 15000, maxWait: 10000 });

  if (result.conflict) {
    const current = await prisma.rpa_mrf.findUnique({
      where: { id: mrf.id },
      select: { approval_status: true, decided_by_name: true, decided_at: true },
    });
    const by = current?.decided_by_name ? ` by ${current.decided_by_name}` : '';
    const when = current?.decided_at ? ` on ${formatIst(current.decided_at)}` : '';
    throw new AppError(`This requisition has already been ${decisionWord(current?.approval_status)}${by}${when}.`, 409);
  }

  // No token, ever. IP and browser are here too, so evidence also exists in
  // combined.log should the database be unavailable.
  logger.info(`MRF ${id} ${newStatus} via approval link by ${actor.name} at ${now.toISOString()}`, {
    mrfId: id, decision: newStatus, actorEmail: actor.email, identitySource: actor.source,
    ip: client.ip, userAgent: client.userAgent,
  });

  // After commit, in the background: the approver gets their answer now.
  notifyAfterDecision(mrf.id, { hmFallback: result.hmFallback }).catch((err) => {
    logger.error(`[MRF approval] post-decision notifications failed for MRF ${id}: ${err.message}`);
  });

  return { approval_status: newStatus, decided_by_name: actor.name, decided_at: now };
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
  if (!mrf || isOpenApprovalStatus(mrf.approval_status)) return;
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

  const already = await prisma.rpa_mrf_approval_events.findMany({
    where: { mrf_id: mrf.id, event_type: { in: ['other_approvers_notified', 'decision_confirmation_sent'] } },
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

// ── Trail (ATS screen) ─────────────────────────────────────────────────

/**
 * The full approval trail for the MRF details screen. IP address and device
 * are personal data: only admin-tier users receive them.
 */
export async function getApprovalTrail(mrfId, { includeClientData = false } = {}) {
  const id = BigInt(mrfId);
  const mrf = await prisma.rpa_mrf.findUnique({
    where: { id },
    select: {
      id: true, approval_status: true, decided_by_name: true, decided_by_email: true,
      decided_at: true, decided_ip: true, decision_comments: true, position_hiring_for: true,
    },
  });
  if (!mrf) throw new AppError('Requisition request not found.', 404);

  const [tokens, events] = await Promise.all([
    prisma.rpa_mrf_approval_tokens.findMany({ where: { mrf_id: id }, orderBy: { id: 'asc' } }),
    prisma.rpa_mrf_approval_events.findMany({ where: { mrf_id: id }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] }),
  ]);

  return {
    mrf_id: mrf.id.toString(),
    approval_status: mrf.approval_status,
    decision: mrf.decided_at ? {
      decided_by_name: mrf.decided_by_name,
      decided_by_email: mrf.decided_by_email,
      decided_at: mrf.decided_at,
      decided_at_ist: formatIst(mrf.decided_at),
      comments: mrf.decision_comments,
      ...(includeClientData ? { ip: mrf.decided_ip } : {}),
    } : null,
    approvers: tokens.map((t) => ({
      id: t.id.toString(),
      name: t.approver_name,
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
      actor_name: e.actor_name,
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
