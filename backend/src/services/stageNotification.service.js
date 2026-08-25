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
import { wrapBrandedEmail, brandedWrapperParts } from './emailLayout.service.js';
import { v4 as uuidv4 } from 'uuid';
import { finalStatusLabelFor } from '../config/pipelineStages.js';

/**
 * stageNotification.service.js — the single email dispatcher for every stage×
 * outcome notification raised by the Phase 3 stage engine (Module 1).
 *
 * Resolution chain (03-DEVELOPMENT-PLAN.md §M1):
 *   rpa_stage_email_templates (stage_key, outcome_key) mapping
 *     -> 3 generic outcome-fallback templates (category='stage_outcome')
 *     -> hard failure (logged, never thrown — a missing template must not
 *        block the stage-outcome transaction that already committed).
 *
 * Vendor dual-notification (Q5): this dispatcher is the CANDIDATE half only.
 * The vendor half moved out to vendorNotification.service.js in M6
 * (2026-08-12), because a cc could not deliver what Q5 promised — a cc'd vendor
 * reads the whole candidate body, including anything a recruiter typed into the
 * outcome modal. Nothing here takes a vendor address any more, so no candidate
 * body can reach a vendor by any route through this file.
 *
 * Reuses the same building blocks as the legacy `updateCandidateStatus`
 * (screening.service.js ~line 2391): compileTemplate / sendGraphEmail /
 * injectTrackingPixel / resolveRecipients, and logs into the same
 * rpa_email_messages + rpa_email_tracking pair so the conversation view and
 * bounce/open tracking keep working unchanged.
 */

/**
 * Generic fallback templates, looked up by name (created once via
 * seed-email-templates.js).
 *
 * The three closure entries are keyed by outcome rather than mapped per stage
 * in rpa_stage_email_templates on purpose: a journey can be closed from ANY
 * stage — someone withdrawing at Tech 2 never reaches the offer stage — so a
 * per-stage mapping would silently miss most real closures. That miss is
 * precisely why closure emails never sent before.
 *
 * The other five closure outcomes are absent by design; see
 * SILENT_FINAL_OUTCOMES below.
 */
const GENERIC_FALLBACK_BY_OUTCOME = {
  approved: 'Stage Outcome — Approved',
  rejected: 'Stage Outcome — Rejected',
  hold: 'Stage Outcome — Hold',
  closure_approved: 'Closure — Approved',
  closure_rejected: 'Closure — Rejected',
  closure_on_hold: 'Closure — On Hold',
};

/**
 * Closure outcomes that must NEVER generate a candidate email, whatever is
 * mapped in rpa_stage_email_templates.
 *
 * These record something that already happened out in the world — the candidate
 * joined, backed out, withdrew, or never turned up. There is nothing to tell
 * them that they do not already know, and mailing them would range from odd to
 * insulting ("Congratulations" to someone who backed out — the exact failure
 * mode that got the generic-fallback mapping rejected in the first place).
 *
 * Until these were seeded this was moot: resolveTemplate() returned null for
 * every closure and the send was skipped. Seeding the three legitimate closure
 * templates changes that, so the silence has to become deliberate rather than
 * incidental — including for jobs/offerSweep.js's 90-day auto-close, which would
 * otherwise email every joined candidate months after the fact.
 *
 * The three closure outcomes NOT listed here (closure_approved,
 * closure_rejected, closure_on_hold) are real decisions the candidate is waiting
 * on, and DO send.
 */
export const SILENT_FINAL_OUTCOMES = new Set([
  'joined',
  'joined_and_left',
  'backed_out',
  'did_not_join',
  'candidate_withdrawn',
]);

/**
 * The branded-shell options for a stage-outcome email.
 *
 * The header headline IS the email subject (RT decision, 2026-07-25), matching
 * the legacy branded templates where "Application on Hold" appears in both.
 * Pass the FINAL subject — i.e. after any recruiter edit in the outcome modal —
 * so the band can never disagree with what the mail client shows.
 */
const outcomeWrapOpts = (subject) => ({ title: subject || '' });

/**
 * Resolves the template to use for a stage×outcome pair: specific mapping
 * first, then the generic per-outcome fallback.
 * @param {string} stageKey
 * @param {string} outcomeKey
 * @returns {Promise<object|null>} an rpa_email_templates row, or null if none resolves
 */
async function resolveTemplate(stageKey, outcomeKey) {
  // Deliberately silent closures short-circuit before any lookup, so an admin
  // mapping one of them to a template in the config UI still cannot send.
  if (SILENT_FINAL_OUTCOMES.has(outcomeKey)) return null;

  const mapping = await prisma.rpa_stage_email_templates.findUnique({
    where: { stage_key_outcome_key: { stage_key: stageKey, outcome_key: outcomeKey } },
    include: { rpa_email_templates: true },
  });
  if (mapping?.rpa_email_templates) {
    return mapping.rpa_email_templates;
  }

  const fallbackName = GENERIC_FALLBACK_BY_OUTCOME[outcomeKey];
  if (!fallbackName) return null;

  return prisma.rpa_email_templates.findFirst({
    where: { name: fallbackName, is_active: true },
  });
}

/**
 * Compiles (without sending) the outcome email a given stage×outcome pair
 * would produce — the same resolveTemplate + compileTemplate path
 * sendStageOutcomeEmail uses, exposed for the drawer's "preview before
 * send" step (GET /api/pipeline/:id/outcome-preview) so the recruiter edits
 * the exact text that will actually go out, not a second guess at it.
 * @param {object} params
 * @param {string} params.stageKey
 * @param {string} params.outcomeKey
 * @param {string} params.stageLabel
 * @param {{name: string}} params.candidate
 * @param {string} [params.positionLabel]
 * @returns {Promise<{ subject: string, body: string, wrapper: object, templateId: number|null, templateName: string|null }>}
 *   `body` is the editable FRAGMENT; `wrapper` carries the branded header/footer
 *   the drawer renders around it, so the popup shows the real outgoing email
 *   while the recruiter still only edits the body (plan §4).
 */
export async function previewOutcomeEmail({ stageKey, outcomeKey, stageLabel, candidate, positionLabel = 'the role' }) {
  const template = await resolveTemplate(stageKey, outcomeKey);
  if (!template) {
    return { subject: '', body: '', wrapper: brandedWrapperParts(outcomeWrapOpts('')), templateId: null, templateName: null };
  }
  const { subject, html: body } = compileTemplate(template.subject, template.body_html, {
    candidate_name: candidate?.name || 'Candidate',
    position: positionLabel,
    job_title: positionLabel,
    stage_label: stageLabel,
  });
  // Header headline = the subject, so the wrapper is built from the compiled
  // subject. The drawer re-renders it client-side as the recruiter edits the
  // subject field, so the preview stays truthful without a refetch.
  return {
    subject,
    body,
    wrapper: brandedWrapperParts(outcomeWrapOpts(subject)),
    templateId: template.id,
    templateName: template.name,
  };
}

/**
 * Sends the stage-outcome notification for one candidate pipeline event.
 * Called AFTER the pipeline/event transaction commits (03-DEVELOPMENT-PLAN.md
 * §M1: "email dispatched after commit — send failure never rolls back state,
 * result recorded on the event").
 *
 * @param {object} params
 * @param {object} params.pipelineRow - rpa_candidate_pipeline row (post-update)
 * @param {string} params.stageKey
 * @param {string} params.outcomeKey
 * @param {string} params.stageLabel - human label for {{stage_label}} interpolation
 * @param {{name: string, email: string}} params.candidate
 * @param {string} [params.positionLabel]
 * @returns {Promise<{ sent: boolean, error: string|null, messageId: number|null }>}
 */
export async function sendStageOutcomeEmail({
  pipelineRow,
  stageKey,
  outcomeKey,
  stageLabel,
  candidate,
  positionLabel = 'the role',
  subjectOverride = null,
  bodyOverride = null,
}) {
  if (!candidate?.email) {
    return { sent: false, error: 'No candidate email on file.', messageId: null };
  }

  // Checked here as well as inside resolveTemplate(), because a recruiter-edited
  // subject/body override skips template resolution entirely — the silence has
  // to hold on that path too.
  if (SILENT_FINAL_OUTCOMES.has(outcomeKey)) {
    logger.info(
      `Stage-outcome email suppressed by policy: pipeline=${pipelineRow.id} outcome=${outcomeKey} (closure outcomes are recorded, not announced).`
    );
    return { sent: false, error: null, messageId: null };
  }

  try {
    // 'stageOutcome' flow key: dynamic recipient (candidate), staging redirect honored
    // automatically via emailRecipients.js's non-production rule.
    const { to: toEmail } = resolveRecipients('stageOutcome', candidate.email);

    if (!toEmail) {
      const msg = describeEmailError('No valid recipients');
      logger.warn(`Skipping stage-outcome email for pipeline ${pipelineRow.id}: no recipient address.`);
      return { sent: false, error: msg, messageId: null };
    }

    // If the recruiter previewed+edited the email (drawer's outcome modal),
    // send that exact text — never recompile a second copy from the
    // template. Only fall back to compiling here if no override was given
    // (e.g. a caller that doesn't go through the preview step).
    let subject = subjectOverride;
    let bodyHtml = bodyOverride;
    if (subject == null || bodyHtml == null) {
      const template = await resolveTemplate(stageKey, outcomeKey);
      if (!template) {
        const msg = `No email template resolved for stage="${stageKey}" outcome="${outcomeKey}" (no specific mapping and no generic fallback).`;
        logger.warn(msg);
        return { sent: false, error: msg, messageId: null };
      }
      ({ subject, html: bodyHtml } = compileTemplate(template.subject, template.body_html, {
        candidate_name: candidate.name || 'Candidate',
        position: positionLabel,
        job_title: positionLabel,
        stage_label: stageLabel,
      }));
    }

    const trackingToken = uuidv4();
    // Brand the fragment, THEN inject the pixel: injectTrackingPixel inserts
    // before </body>, which only exists once the shell is applied. bodyHtml
    // itself stays a fragment — that is what gets stored (plan §3.3), so the
    // reminder scheduler can keep prepending its banner to it.
    const brandedHtml = wrapBrandedEmail(bodyHtml, outcomeWrapOpts(subject));
    const sendResult = await sendGraphEmail({
      sender: config.microsoft.defaultSender,
      to: toEmail,
      subject,
      html: injectTrackingPixel(brandedHtml, trackingToken),
    });

    const statusLabel = finalStatusLabelFor(stageKey, outcomeKey);
    const message = await prisma.rpa_email_messages.create({
      data: {
        graph_message_id: sendResult?.graphMessageId || null,
        conversation_id: sendResult?.conversationId || `pipeline-${pipelineRow.id}-${stageKey}-${outcomeKey}`,
        internet_msg_id: sendResult?.internetMessageId || null,
        from_email: config.microsoft.defaultSender,
        to_emails: toEmail.split(','),
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
      `Stage-outcome email sent: pipeline=${pipelineRow.id} stage=${stageKey} outcome=${outcomeKey} status_label="${statusLabel}"`
    );
    return { sent: true, error: null, messageId: message.id };
  } catch (err) {
    const errMsg = describeEmailError(err);
    logger.error(
      `Stage-outcome email failed: pipeline=${pipelineRow.id} stage=${stageKey} outcome=${outcomeKey}: ${err.message}`
    );
    return { sent: false, error: errMsg, messageId: null };
  }
}

/**
 * Ad-hoc per-candidate email override (RT ask, 2026-07-14): a one-off send
 * that either uses a template as-is or a fully recruiter-edited subject/body.
 * Uses the same dispatcher plumbing (rpa_email_log/tracking, staging redirect)
 * as sendStageOutcomeEmail. Called by pipeline.controller.js POST /:id/email.
 *
 * This is the send that made the old vendor cc indefensible: the body is
 * whatever a recruiter typed, so cc'ing a vendor here could put salary
 * negotiation or joining terms in front of them with nothing in the way. The
 * vendor now gets a generated status line from vendorNotification.service.js
 * instead, and this function has no vendor parameter at all.
 *
 * @param {object} params
 * @param {object} params.pipelineRow
 * @param {{name: string, email: string}} params.candidate
 * @param {string} params.subject
 * @param {string} params.body
 * @returns {Promise<{ sent: boolean, error: string|null, messageId: number|null }>}
 */
export async function sendAdHocCandidateEmail({ pipelineRow, candidate, subject, body }) {
  if (!candidate?.email) {
    return { sent: false, error: 'No candidate email on file.', messageId: null };
  }

  try {
    const { to: toEmail } = resolveRecipients('stageOutcome', candidate.email);
    if (!toEmail) {
      return { sent: false, error: describeEmailError('No valid recipients'), messageId: null };
    }

    const trackingToken = uuidv4();
    // Same wrap-then-pixel ordering as sendStageOutcomeEmail; `body` stays the
    // stored fragment.
    const brandedHtml = wrapBrandedEmail(body, outcomeWrapOpts(subject));
    const sendResult = await sendGraphEmail({
      sender: config.microsoft.defaultSender,
      to: toEmail,
      subject,
      html: injectTrackingPixel(brandedHtml, trackingToken),
    });

    const message = await prisma.rpa_email_messages.create({
      data: {
        graph_message_id: sendResult?.graphMessageId || null,
        conversation_id: sendResult?.conversationId || `pipeline-${pipelineRow.id}-adhoc`,
        internet_msg_id: sendResult?.internetMessageId || null,
        from_email: config.microsoft.defaultSender,
        to_emails: toEmail.split(','),
        subject,
        body_html: body,
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

    return { sent: true, error: null, messageId: message.id };
  } catch (err) {
    const errMsg = describeEmailError(err);
    logger.error(`Ad-hoc candidate email failed for pipeline ${pipelineRow.id}: ${err.message}`);
    return { sent: false, error: errMsg, messageId: null };
  }
}

export default { sendStageOutcomeEmail, sendAdHocCandidateEmail, previewOutcomeEmail };
