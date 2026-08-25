import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { resolveRecipients } from '../config/emailRecipients.js';
import {
  compileTemplate,
  sendGraphEmail,
  injectTrackingPixel,
  describeEmailError,
} from './emailNotification.service.js';
import { wrapBrandedEmail } from './emailLayout.service.js';
import { v4 as uuidv4 } from 'uuid';
import { STAGE_KEYS, finalStatusLabelFor } from '../config/pipelineStages.js';

/**
 * vendorNotification.service.js — the vendor half of the Q5 dual-notification
 * (Phase 3 M6, 2026-08-12).
 *
 * WHY THIS IS A SEPARATE SEND, NOT A CC
 * -------------------------------------
 * Q5 promises the vendor a STATUS-ONLY notification. Until now that was
 * implemented as a `cc` on the candidate's own email, which does not deliver
 * the promise at all — a cc'd vendor reads the entire candidate body, including
 * whatever a recruiter typed into the outcome modal or the ad-hoc email box. The
 * only reason nothing leaked is that the cc never fired: it was gated on
 * `pipeline.source === 'vendor'`, a value nothing ever wrote.
 *
 * So the vendor now gets their own message, and this module has NO subject or
 * body override parameter. Every word a vendor receives is generated here from
 * a template plus a fixed status vocabulary. A recruiter cannot put text in
 * front of a vendor even by accident, which makes "no CTC, no offer letter, no
 * document content ever reaches a vendor" a structural property rather than a
 * policy someone has to remember.
 *
 * WHO GETS MAIL
 * -------------
 * Only journeys carrying `source='vendor'` + `vendor_email`, which
 * pipeline.service.js's createPipelineJourney stamps from the candidate's live
 * 90-day ownership lock at the moment the journey is created. See
 * utils/vendorLock.js for why the lock is read once and snapshotted.
 */

/**
 * The event vocabulary. Callers pass one of these — never prose — which is what
 * keeps the outgoing wording under this module's control.
 */
export const VENDOR_EVENTS = Object.freeze({
  STAGE_OUTCOME: 'stage_outcome',
  CLOSURE: 'closure',
  INTERVIEW_SCHEDULED: 'interview_scheduled',
  INTERVIEW_RESCHEDULED: 'interview_rescheduled',
  INTERVIEW_CANCELLED: 'interview_cancelled',
  ASSESSMENT_INVITED: 'assessment_invited',
  OFFER_SHARED: 'offer_shared',
  OFFER_ACCEPTED: 'offer_accepted',
  OFFER_DECLINED: 'offer_declined',
  ADHOC_CONTACT: 'adhoc_contact',
});

/**
 * Per-stage disclosure policy (Q5, and Q29 answered 2026-08-12).
 *
 *   'never'    — no vendor message at all leaves this stage.
 *   'bare'     — a content-free line: the candidate reached a milestone, with
 *                no figures, no joining date, no remarks, no letter.
 *   'standard' — the ordinary status line naming the stage and its outcome.
 *
 * Documents is 'never' because the whole stage is the candidate's personal
 * paperwork — PAN, Aadhaar, payslips — and a vendor has no claim on any of it.
 * Offer is 'bare' because RT wanted the vendor to know their candidate got an
 * offer without learning what was in it.
 *
 * Exported so the suppression rule is testable directly, rather than only
 * observable through a send.
 */
export const VENDOR_STAGE_POLICY = Object.freeze({
  [STAGE_KEYS.DOCUMENTS]: 'never',
  [STAGE_KEYS.OFFER]: 'bare',
});

/** Disclosure policy for a stage; anything unlisted discloses normally. */
export function vendorPolicyForStage(stageKey) {
  return VENDOR_STAGE_POLICY[stageKey] || 'standard';
}

/**
 * The status line the vendor sees, assembled from the fixed vocabulary above.
 *
 * Under the 'bare' policy every branch collapses to a milestone with no detail —
 * that is the whole point, so the offer figures cannot reach a vendor through
 * an outcome label either ("Offer Rejected" is fine; a joining date is not).
 *
 * @param {object} params
 * @param {string} params.eventType - one of VENDOR_EVENTS
 * @param {string} params.stageLabel
 * @param {string} [params.outcomeLabel] - already-resolved legacy status text
 * @param {'standard'|'bare'} params.policy
 * @returns {string}
 */
function statusLineFor({ eventType, stageLabel, outcomeLabel, policy }) {
  if (policy === 'bare') {
    switch (eventType) {
      case VENDOR_EVENTS.OFFER_SHARED: return 'An offer has been extended.';
      case VENDOR_EVENTS.OFFER_ACCEPTED: return 'The candidate accepted the offer.';
      case VENDOR_EVENTS.OFFER_DECLINED: return 'The candidate declined the offer.';
      case VENDOR_EVENTS.CLOSURE: return 'The record has been closed.';
      default: return 'Reached the offer stage.';
    }
  }

  switch (eventType) {
    case VENDOR_EVENTS.INTERVIEW_SCHEDULED: return `${stageLabel} — interview scheduled.`;
    case VENDOR_EVENTS.INTERVIEW_RESCHEDULED: return `${stageLabel} — interview rescheduled.`;
    case VENDOR_EVENTS.INTERVIEW_CANCELLED: return `${stageLabel} — interview cancelled.`;
    case VENDOR_EVENTS.ASSESSMENT_INVITED: return `${stageLabel} — assessment invitation sent.`;
    case VENDOR_EVENTS.ADHOC_CONTACT: return `${stageLabel} — the recruitment team has been in touch with the candidate.`;
    case VENDOR_EVENTS.CLOSURE: return outcomeLabel ? `Closed — ${outcomeLabel}.` : 'The record has been closed.';
    default: return outcomeLabel ? `${outcomeLabel}.` : `Now at ${stageLabel}.`;
  }
}

/** Template names, seeded by prisma/seed-email-templates.js (category 'vendor_status'). */
const TEMPLATE_BY_POLICY = Object.freeze({
  standard: 'Vendor — Candidate Status Update',
  bare: 'Vendor — Candidate Milestone (No Detail)',
});

/**
 * Inline fallback, used when the template row is missing.
 *
 * Deliberate: a vendor going silent because nobody ran a seed is a support
 * ticket nobody traces back to a seed. The same call was made for the document
 * templates on 2026-07-30. The fallback carries no more information than the
 * template it stands in for.
 */
const FALLBACK = Object.freeze({
  subject: 'Candidate update — {{candidate_name}}',
  body: `<p>Hello {{vendor_name}},</p>
<p>An update on the candidate you submitted:</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">
  <tr><td style="color:#666">Candidate</td><td><strong>{{candidate_name}}</strong></td></tr>
  <tr><td style="color:#666">Position</td><td>{{position}}</td></tr>
  <tr><td style="color:#666">Status</td><td><strong>{{status_line}}</strong></td></tr>
  <tr><td style="color:#666">Date</td><td>{{event_date}}</td></tr>
</table>
<p style="color:#666;font-size:12.5px">This is a status update only. For anything further, please contact the recruitment team.</p>`,
});

/** Resolves the vendor-facing template for a policy, or null to use FALLBACK. */
async function resolveVendorTemplate(policy) {
  const name = TEMPLATE_BY_POLICY[policy];
  if (!name) return null;
  return prisma.rpa_email_templates.findFirst({ where: { name, is_active: true } });
}

/**
 * The vendor a journey belongs to, or null.
 *
 * Requires `source === 'vendor'`, which createPipelineJourney only sets when the
 * candidate's 90-day lock was live at journey creation. Checking the column
 * alone would revive the 2026-07-22 leak, where a lapsed attribution still
 * pulled a vendor onto a keyword-search shortlist.
 *
 * @param {{ source?: string, vendor_email?: string|null }} pipelineRow
 * @returns {string|null}
 */
export function vendorForJourney(pipelineRow) {
  if (pipelineRow?.source !== 'vendor') return null;
  return (pipelineRow.vendor_email || '').trim() || null;
}

/**
 * Sends the vendor their status-only notification for one pipeline event.
 *
 * Best-effort by contract: every caller invokes this AFTER its own transaction
 * has committed, and a failure here must never disturb the recruiter's action.
 * Never throws — returns a result the caller may log.
 *
 * @param {object} params
 * @param {object} params.pipelineRow - rpa_candidate_pipeline row
 * @param {{name?: string}} params.candidate
 * @param {string} params.eventType - one of VENDOR_EVENTS
 * @param {string} [params.stageKey] - defaults to the journey's current stage
 * @param {string} [params.stageLabel]
 * @param {string|null} [params.outcomeKey] - resolved to legacy status text
 * @param {string} [params.positionLabel]
 * @returns {Promise<{ sent: boolean, skipped: string|null, error: string|null, messageId: number|null }>}
 */
export async function notifyVendor({
  pipelineRow,
  candidate,
  eventType,
  stageKey = null,
  stageLabel = null,
  outcomeKey = null,
  positionLabel = 'the role',
}) {
  const skip = (reason) => ({ sent: false, skipped: reason, error: null, messageId: null });

  const vendorEmail = vendorForJourney(pipelineRow);
  if (!vendorEmail) return skip('not a vendor-sourced journey');

  const effectiveStageKey = stageKey || pipelineRow.current_stage_key;
  const policy = vendorPolicyForStage(effectiveStageKey);
  if (policy === 'never') {
    logger.info(
      `Vendor notification suppressed by stage policy: pipeline=${pipelineRow.id} stage=${effectiveStageKey} (Q5 — this stage never reaches a vendor).`
    );
    return skip(`stage "${effectiveStageKey}" never notifies vendors`);
  }

  try {
    const { to } = resolveRecipients('vendorStatus', vendorEmail);
    if (!to) return skip('no recipient address');

    // Callers that already loaded the stage row pass its label; the rest get it
    // looked up here rather than leaking a raw key like "zeko_hr" to a vendor.
    let resolvedStageLabel = stageLabel;
    if (!resolvedStageLabel) {
      const stageRow = await prisma.rpa_pipeline_stages
        .findUnique({ where: { stage_key: effectiveStageKey }, select: { label: true } })
        .catch(() => null);
      resolvedStageLabel = stageRow?.label || effectiveStageKey;
    }
    const outcomeLabel = outcomeKey ? finalStatusLabelFor(effectiveStageKey, outcomeKey) : null;
    const statusLine = statusLineFor({ eventType, stageLabel: resolvedStageLabel, outcomeLabel, policy });

    // rpa_candidate_pipeline has no vendor_name column — only vendor_email — so
    // the real name has to come from the CV row the journey was created from.
    // Falls back to the same "Vendor Partner" phrase emailNotification.service.js
    // already uses for an unnamed vendor, rather than a bare lowercase "partner".
    const cvRow = pipelineRow.cv_id
      ? await prisma.rpa_cv.findUnique({ where: { id: pipelineRow.cv_id }, select: { vendorName: true } }).catch(() => null)
      : null;
    const vendorDisplayName = cvRow?.vendorName || 'Vendor Partner';

    const template = await resolveVendorTemplate(policy);
    const { subject, html: bodyHtml } = compileTemplate(
      template?.subject || FALLBACK.subject,
      template?.body_html || FALLBACK.body,
      {
        candidate_name: candidate?.name || 'the candidate',
        vendor_name: vendorDisplayName,
        position: positionLabel,
        job_title: positionLabel,
        stage_label: resolvedStageLabel,
        status_line: statusLine,
        event_date: new Date().toISOString().slice(0, 10),
      }
    );

    const trackingToken = uuidv4();
    const brandedHtml = wrapBrandedEmail(bodyHtml, { title: subject || '', subtitle: 'AAPNA Infotech — Vendor Update' });
    const sendResult = await sendGraphEmail({
      sender: config.microsoft.defaultSender,
      to,
      subject,
      html: injectTrackingPixel(brandedHtml, trackingToken),
    });

    // Logged like every other outbound send so Email Delivery monitoring counts
    // it and the conversation view shows what the vendor was told.
    const message = await prisma.rpa_email_messages.create({
      data: {
        graph_message_id: sendResult?.graphMessageId || null,
        conversation_id: sendResult?.conversationId || `vendor-${pipelineRow.id}-${eventType}`,
        internet_msg_id: sendResult?.internetMessageId || null,
        from_email: config.microsoft.defaultSender,
        to_emails: to.split(','),
        subject,
        body_html: bodyHtml,
        direction: 'outbound',
        candidate_id: pipelineRow.cv_id ? BigInt(pipelineRow.cv_id) : null,
        mrf_id: pipelineRow.mrf_id ? BigInt(pipelineRow.mrf_id) : null,
        shortlist_id: pipelineRow.shortlist_id || null,
        sent_at: new Date(),
      },
    });

    await prisma.rpa_email_tracking.create({
      data: {
        message_id: message.id,
        tracking_token: trackingToken,
        delivered: true,
        delivered_at: new Date(),
      },
    });

    logger.info(
      `Vendor notification sent: pipeline=${pipelineRow.id} vendor=${vendorEmail} event=${eventType} policy=${policy}`
    );
    return { sent: true, skipped: null, error: null, messageId: message.id };
  } catch (err) {
    // Swallowed on purpose — the recruiter's action already committed.
    logger.error(`Vendor notification failed: pipeline=${pipelineRow.id} event=${eventType}: ${err.message}`);
    return { sent: false, skipped: null, error: describeEmailError(err), messageId: null };
  }
}

export default { notifyVendor, vendorForJourney, vendorPolicyForStage, VENDOR_EVENTS, VENDOR_STAGE_POLICY };
