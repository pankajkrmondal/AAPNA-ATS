/**
 * assessmentInvite.service.js — Evalground test-invite send/tracking for the
 * Assessment pipeline stage. There is no Evalground API, so "sending an
 * invite" means either emailing the candidate a compose-modal message (the
 * recruiter pastes in a link they created manually in Evalground's own
 * dashboard) or recording that the recruiter sent it outside the app
 * entirely ("marked sent manually") — either way, this starts a deadline
 * clock (see assessmentSettings.service.js / assessmentDeadlineChecker.js).
 *
 * Re-invites are new rows, not overwrites, so every attempt stays auditable
 * and the deadline checker always keys off the latest one.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { sendAdHocCandidateEmail } from './stageNotification.service.js';
import { compileTemplate } from './emailNotification.service.js';
import { notifyVendor, VENDOR_EVENTS } from './vendorNotification.service.js';
import { getAssessmentAutomationSettings } from './assessmentSettings.service.js';
import { assessmentInviteState } from '../utils/assessmentInviteState.js';

const serializeBigInts = (obj) => JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? Number(v) : v)));

/**
 * The invite compose modal is a plain textarea (by design — see
 * AssessmentInviteModal.jsx), but the underlying send path
 * (sendAdHocCandidateEmail) treats the body as HTML. Sent verbatim, every
 * newline the recruiter typed collapses into one run-on paragraph in the
 * recipient's inbox. Converts to simple, safely-escaped HTML at send time
 * only — the plain-text version typed by the recruiter is still what's
 * stored/returned, so re-editing/re-sending sees clean text, not HTML tags.
 */
function plainTextToEmailHtml(text) {
  const escapeHtml = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const paragraphs = text.split(/\n{2,}/).map((para) => escapeHtml(para).split('\n').join('<br>'));
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111827;">${paragraphs.map((p) => `<p style="margin:0 0 14px;">${p}</p>`).join('')}</div>`;
}

/**
 * @param {number|string} pipelineId
 * @param {object} params
 * @param {'email'|'manual'} params.method
 * @param {string|null} [params.subject] - required for method='email'
 * @param {string|null} [params.body] - required for method='email'
 * @param {number|null} [params.createdBy] - rpa_users.id
 */
export async function sendAssessmentInvite(pipelineId, { method, subject = null, body = null, createdBy = null }) {
  if (!['email', 'manual'].includes(method)) {
    throw new AppError('method must be "email" or "manual".', 400);
  }

  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    include: { rpa_shortlisted_candidates: true },
  });
  if (!pipeline) {
    throw new AppError('Pipeline journey not found.', 404);
  }
  if (pipeline.current_stage_key !== 'assessment') {
    throw new AppError('Evalground invites can only be sent while the candidate is on the IQ / Tech Assessment stage.', 400);
  }

  const { deadlineDays } = await getAssessmentAutomationSettings();
  const sentAt = new Date();
  const deadlineAt = new Date(sentAt.getTime() + deadlineDays * 24 * 60 * 60 * 1000);

  let emailResult = null;
  if (method === 'email') {
    if (!subject?.trim() || !body?.trim()) {
      throw new AppError('subject and body are required to send an Evalground invite email.', 400);
    }
    emailResult = await sendAdHocCandidateEmail({
      pipelineRow: pipeline,
      candidate: {
        name: pipeline.rpa_shortlisted_candidates?.candidate_name,
        email: pipeline.rpa_shortlisted_candidates?.candidate_email,
      },
      subject,
      body: plainTextToEmailHtml(body),
    });
    if (!emailResult.sent) {
      logger.error('Failed to send the Evalground invite email:', { error: emailResult.error });
      throw new AppError('Unable to send the assessment invite email right now. Please try again later.', 502);
    }
  }

  // The vendor is told an assessment went out, not which link or what the
  // recruiter wrote around it. Fires for the manual path too — from the
  // vendor's side "their candidate has been invited to test" is the same fact
  // however the link reached them.
  await notifyVendor({
    pipelineRow: pipeline,
    candidate: { name: pipeline.rpa_shortlisted_candidates?.candidate_name },
    eventType: VENDOR_EVENTS.ASSESSMENT_INVITED,
    stageKey: pipeline.current_stage_key,
    positionLabel: pipeline.rpa_shortlisted_candidates?.position_applied || 'the role',
  });

  const invite = await prisma.rpa_assessment_invites.create({
    data: {
      pipeline_id: pipeline.id,
      method,
      subject: method === 'email' ? subject : null,
      body: method === 'email' ? body : null,
      sent_at: sentAt,
      deadline_days: deadlineDays,
      deadline_at: deadlineAt,
      created_by: createdBy || null,
    },
  });

  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: pipeline.id,
      stage_key: 'assessment',
      event_type: 'note',
      notes: method === 'email'
        ? `Evalground invite emailed to candidate — deadline in ${deadlineDays} day(s).`
        : `Evalground invite marked as sent manually (outside the app) — deadline in ${deadlineDays} day(s).`,
      email_sent: method === 'email' ? emailResult?.sent : false,
      email_error: method === 'email' ? emailResult?.error : null,
      acted_by: createdBy || null,
    },
  });

  return serializeBigInts(invite);
}

/**
 * Latest invite (or null) + overdue state, for PipelineDrawer.jsx's
 * "Invite Sent"/"Awaiting Test" rendering. A withdrawn latest invite is
 * returned with isWithdrawn so the drawer can offer "Send Evalground invite"
 * again; it is never overdue.
 * @param {number|string} pipelineId
 */
export async function getInviteState(pipelineId) {
  const latest = await prisma.rpa_assessment_invites.findFirst({
    where: { pipeline_id: BigInt(pipelineId) },
    orderBy: { sent_at: 'desc' },
  });
  if (!latest) {
    return { invite: null, isOverdue: false, hasResult: false, isWithdrawn: false };
  }

  const result = await prisma.rpa_assessment_results.findFirst({
    where: { pipeline_id: BigInt(pipelineId), status: { in: ['matched', 'score_overwritten'] } },
  });
  const { isOverdue, isWithdrawn } = assessmentInviteState(latest, !!result);

  return serializeBigInts({ invite: latest, isOverdue, hasResult: !!result, isWithdrawn });
}

/** Overridable from the Email Templates page; the inline copy below is used until then. */
export const ASSESSMENT_CANCELLED_TEMPLATE = 'Evalground Test Cancelled';

const CANCELLED_FALLBACK = Object.freeze({
  subject: 'Your assessment for {{position}} has been cancelled',
  body: `<p>Dear {{candidate_name}},</p>
<p>The online assessment we sent you for <strong>{{position}}</strong> has been cancelled, so you do not need to take it. Please ignore the earlier test link.</p>
<p>The recruitment team will be in touch about the next step.</p>`,
});

/**
 * Withdraws the latest open Evalground invite (flexible stages, C11). Evalground
 * has no API, so the recruiter must also disable the link in Evalground's own
 * dashboard; the drawer says so. The row stays (history) and is only marked.
 *
 * Unlocks the Assessment card, stops the deadline reminder (the checker skips
 * withdrawn invites), optionally emails the candidate, and tells the vendor
 * "assessment cancelled" to match the "invited" they were sent.
 *
 * @param {number|string} pipelineId
 * @param {object} params
 * @param {string} params.reason - required
 * @param {boolean} [params.notifyCandidate=true]
 * @param {number|null} [params.actedBy]
 */
export async function withdrawAssessmentInvite(pipelineId, { reason, notifyCandidate = true, actedBy = null }) {
  const why = String(reason || '').trim();
  if (!why) throw new AppError('A reason is required to withdraw an Evalground invite.', 400);

  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    include: { rpa_shortlisted_candidates: { include: { mrf: true } } },
  });
  if (!pipeline) throw new AppError('Pipeline journey not found.', 404);
  if (pipeline.final_outcome) throw new AppError('This candidate\'s record is closed. Reopen it first.', 409);

  const latest = await prisma.rpa_assessment_invites.findFirst({
    where: { pipeline_id: pipeline.id },
    orderBy: { sent_at: 'desc' },
  });
  if (!latest || latest.withdrawn_at) throw new AppError('There is no open Evalground invite to withdraw.', 400);
  const result = await prisma.rpa_assessment_results.count({
    where: { pipeline_id: pipeline.id, status: { in: ['matched', 'score_overwritten'] } },
  });
  if (result > 0) {
    throw new AppError('A result has already arrived for this test. Record the decision instead.', 409);
  }

  const claim = await prisma.rpa_assessment_invites.updateMany({
    where: { id: latest.id, withdrawn_at: null },
    data: { withdrawn_at: new Date(), withdrawn_by: actedBy || null, withdraw_reason: why, modified_at: new Date() },
  });
  if (claim.count !== 1) throw new AppError('This invite has already been withdrawn.', 400);

  const candidate = pipeline.rpa_shortlisted_candidates;
  let emailResult = { sent: false, error: 'Not sent: the recruiter chose not to email the candidate.' };
  if (notifyCandidate) {
    const tpl = await prisma.rpa_email_templates.findFirst({ where: { name: ASSESSMENT_CANCELLED_TEMPLATE, is_active: true } });
    const compiled = compileTemplate(tpl?.subject || CANCELLED_FALLBACK.subject, tpl?.body_html || CANCELLED_FALLBACK.body, {
      candidate_name: candidate?.candidate_name || 'there',
      position: candidate?.mrf?.position_hiring_for || candidate?.position_applied || 'the role',
    });
    emailResult = await sendAdHocCandidateEmail({
      pipelineRow: pipeline,
      candidate: { name: candidate?.candidate_name, email: candidate?.candidate_email },
      subject: compiled.subject,
      body: compiled.html,
    });
  }

  await notifyVendor({
    pipelineRow: pipeline,
    candidate: { name: candidate?.candidate_name },
    eventType: VENDOR_EVENTS.ASSESSMENT_CANCELLED,
    stageKey: 'assessment',
    positionLabel: candidate?.position_applied || 'the role',
  });

  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: pipeline.id,
      stage_key: 'assessment',
      event_type: 'note',
      notes: `Evalground invite withdrawn. Reason: ${why}`,
      email_sent: !!emailResult.sent,
      email_error: emailResult.sent ? null : emailResult.error,
      acted_by: actedBy || null,
    },
  });

  logger.info(`Evalground invite ${latest.id} withdrawn for pipeline ${pipelineId} (emailed=${!!emailResult.sent}).`);
  return getInviteState(pipelineId);
}
