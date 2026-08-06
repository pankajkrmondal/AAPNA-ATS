/**
 * notification.service.js — the recruitment team's in-app inbox.
 *
 * Replaces the header bell's in-memory list, which lived in one browser tab's
 * React state: it vanished on refresh and never reached anyone who was logged
 * out when the event fired. Rows in rpa_notifications survive both.
 *
 * Fan-out on write: notify() resolves the recipients and inserts ONE ROW EACH,
 * then pushes the row to any of them who happen to be connected. A socket push
 * is therefore an optimisation — the row is the source of truth, so a recruiter
 * who was offline still finds the notification waiting.
 *
 * NOTHING HERE MAY THROW TO ITS CALLER. Every call site hangs off a business
 * action that has already committed (an outcome recorded, a document verified,
 * an offer accepted); failing to tell someone about it must never fail the
 * thing itself. Same contract as the emitToRole() try/catch in
 * assessmentImport.service.js.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import { emitToUser } from '../socket/index.js';

/**
 * Roles that staff the pipeline. Mirrors REVIEW_ROLES in uploadJob.service.js —
 * `hr` is the legacy alias of recruiter-tier (config/roles.js). VENDORS ARE
 * DELIBERATELY ABSENT: they never receive in-app notifications, the same rule
 * that keeps them off document and offer emails (Q5).
 */
export const NOTIFY_ROLES = Object.freeze(['recruiter', 'hr', 'admin', 'superadmin']);

/** Canonical event keys. Free text in the DB, so adding one is never a migration. */
export const NOTIFICATION_TYPES = Object.freeze({
  PIPELINE_OUTCOME: 'pipeline.outcome',
  PIPELINE_CLOSURE: 'pipeline.closure',
  INTERVIEW_AWAITING_FEEDBACK: 'interview.awaiting_feedback',
  INTERVIEW_FEEDBACK_RECEIVED: 'interview.feedback_received',
  INTERVIEW_NO_SHOW: 'interview.no_show',
  INTERVIEW_CONFIRM_NEEDED: 'interview.confirm_needed',
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_ALL_VERIFIED: 'document.all_verified',
  OFFER_APPROVAL_REQUESTED: 'offer.approval_requested',
  OFFER_DECISION: 'offer.decision',
  MRF_CLOSED: 'mrf.closed',
  ASSESSMENT_IMPORT_DONE: 'assessment.import_done',
  ASSESSMENT_DEADLINE_EXPIRED: 'assessment.deadline_expired',
  REVIEW_NEW: 'review.new',
});

/** BigInt ids don't survive JSON.stringify — same helper the other services use. */
const serialize = (row) => (row ? { ...row, id: Number(row.id), pipeline_id: row.pipeline_id === null || row.pipeline_id === undefined ? null : Number(row.pipeline_id) } : null);

/** The standard deep link for a candidate journey. */
export const pipelineLink = (pipelineId) => (pipelineId ? `/pipeline?candidate=${Number(pipelineId)}` : null);

/**
 * Resolves who should receive a notification.
 *
 * Company scoping: `rpa_users.company_id` is nullable, and superadmins are
 * global (roles.js). So when a companyId is supplied we take that company's
 * staff PLUS anyone without a company (superadmins); with no companyId we take
 * all active staff.
 *
 * @param {object} params
 * @param {number|null} [params.companyId]
 * @param {string[]} [params.roles]
 * @returns {Promise<number[]>} user ids
 */
async function resolveRecipients({ companyId = null, roles = NOTIFY_ROLES } = {}) {
  const users = await prisma.rpa_users.findMany({
    where: {
      role: { in: [...roles] },
      is_active: true,
      is_approved: true,
      ...(companyId ? { OR: [{ company_id: companyId }, { company_id: null }] } : {}),
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/**
 * Writes one notification per recipient and pushes it to those online.
 *
 * @param {object} params
 * @param {string} params.type - one of NOTIFICATION_TYPES
 * @param {string} params.title - short headline, shown bold in the bell
 * @param {string} [params.description] - one supporting line
 * @param {number|bigint|null} [params.pipelineId] - the journey this is about
 * @param {string|null} [params.linkPath] - defaults to the pipeline deep link
 * @param {object|null} [params.meta]
 * @param {number|null} [params.companyId] - scopes recipients
 * @param {string[]} [params.roles]
 * @param {number|null} [params.excludeUserId] - the actor; skip telling someone
 *   about their own click (pass null to notify everyone)
 * @returns {Promise<{created: number}>} never throws
 */
export async function notify({
  type,
  title,
  description = null,
  pipelineId = null,
  linkPath,
  meta = null,
  companyId = null,
  roles = NOTIFY_ROLES,
  excludeUserId = null,
}) {
  try {
    if (!type || !title) {
      logger.warn(`notify(): ignored a call with no type/title (type=${type}).`);
      return { created: 0 };
    }

    let recipients = await resolveRecipients({ companyId, roles });
    if (excludeUserId) {
      recipients = recipients.filter((id) => id !== Number(excludeUserId));
    }
    if (recipients.length === 0) return { created: 0 };

    const link = linkPath === undefined ? pipelineLink(pipelineId) : linkPath;
    const pid = pipelineId === null || pipelineId === undefined ? null : BigInt(pipelineId);

    // createMany can't return rows, and the bell needs the real id to mark it
    // read — so create individually and push each as it lands. Recipient counts
    // are single digits, so the extra round trips are irrelevant.
    let created = 0;
    for (const userId of recipients) {
      try {
        const row = await prisma.rpa_notifications.create({
          data: { user_id: userId, type, title, description, pipeline_id: pid, link_path: link, meta },
        });
        created += 1;
        try {
          emitToUser(userId, 'notification:new', serialize(row));
        } catch {
          // Socket.io not initialised (worker process) or the user is offline —
          // the row is already saved, so they will see it on next load.
        }
      } catch (err) {
        logger.warn(`notify(): could not write "${type}" for user ${userId}: ${err.message}`);
      }
    }

    return { created };
  } catch (err) {
    // Never surface to the caller — see the file header.
    logger.error(`notify("${type}") failed entirely: ${err.message}`);
    return { created: 0 };
  }
}

/**
 * A user's inbox, newest first.
 * @param {number} userId
 * @param {object} [params]
 * @param {number} [params.limit=30]
 * @param {boolean} [params.unreadOnly=false]
 */
export async function listNotifications(userId, { limit = 30, unreadOnly = false } = {}) {
  const rows = await prisma.rpa_notifications.findMany({
    where: { user_id: Number(userId), ...(unreadOnly ? { read_at: null } : {}) },
    orderBy: { created_at: 'desc' },
    take: Math.min(100, Math.max(1, Number(limit) || 30)),
  });
  return rows.map(serialize);
}

/** Unread count for the badge. */
export async function unreadCount(userId) {
  return prisma.rpa_notifications.count({ where: { user_id: Number(userId), read_at: null } });
}

/**
 * Marks one notification read. Scoped by user_id so a caller can never mark
 * someone else's row — updateMany returns 0 rather than throwing on a miss.
 */
export async function markRead(userId, notificationId) {
  const { count } = await prisma.rpa_notifications.updateMany({
    where: { id: BigInt(notificationId), user_id: Number(userId), read_at: null },
    data: { read_at: new Date() },
  });
  return { updated: count };
}

/** Marks every unread notification for this user read. */
export async function markAllRead(userId) {
  const { count } = await prisma.rpa_notifications.updateMany({
    where: { user_id: Number(userId), read_at: null },
    data: { read_at: new Date() },
  });
  return { updated: count };
}
