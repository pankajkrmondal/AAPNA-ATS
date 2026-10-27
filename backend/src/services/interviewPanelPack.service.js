/**
 * interviewPanelPack.service.js — what the interview panel receives with the
 * invite (L14): the role's JD and the candidate's CV for every round, and from
 * the second round on the "report so far" (the candidate dossier, redacted,
 * without the candidate's contact details) with no-login recording links.
 *
 * "When tech1 round done and passed, when we are about to schedule round 2,
 * all the details of round 1 score, recording and CV should be sharing to the
 * tech2 round interviewer… tech 3 or HR can get cumulative report." The dossier
 * already IS that report — every earlier round, its scorecards, the AI
 * screening and the assessments, under the dossier's redaction rules — so it is
 * reused as is rather than re-written for email.
 *
 * DEGRADE, NEVER FAIL. Nothing here may stop an invite going out: every part is
 * best-effort, and a file that cannot travel becomes a link or a line saying so.
 *
 * SIZE. Graph takes inline attachments up to ~3 MB in total
 * (JD_ATTACH_MAX_BYTES). Files are added in priority order: the report (a few
 * KB), then the JD, then the CV.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import {
  buildDossierModel, collectAttachments, collectRecordingShareLinks, logDossierDownload,
} from './candidateDossier.service.js';
import { applyRecordingShareLinks } from '../utils/dossierModel.js';
import { assertNoForbiddenFields } from '../utils/dossierRedaction.js';
import { renderDossierHtml } from '../exports/candidateDossier.export.js';
import { getMrfJdAttachment, JD_ATTACH_MAX_BYTES } from './jdAttachment.service.js';
import { buildEarlierRoundsBlock, earlierRoundLines, hasEarlierResults } from '../utils/panelPackBlock.js';
import AppError from '../utils/AppError.js';
import { resolveRecipients } from '../config/emailRecipients.js';
import { sendGraphEmail } from './emailNotification.service.js';
import { renderInterviewTemplate } from './interviewEmailRender.js';
import { INTERVIEW_EMAIL_TEMPLATE_NAMES } from './interviewEmailTemplates.js';
import { interviewerGreeting } from '../utils/emailGreeting.js';
import { fmtDateTimeIst } from '../utils/dateFormat.js';
import { parseInterviewerEmails } from './interviewSchedule.service.js';

/** Is the panel pack switched on? (INTERVIEW_PANEL_PACK_ENABLED, default on.) */
export function panelPackEnabled() {
  return config.interviewPanelPack?.enabled !== false;
}

const safeFileName = (s) => String(s || 'Candidate').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

/**
 * @param {number|string} pipelineId
 * @param {{ user?: object }} [options]
 * @returns {Promise<{attachments: Array<{name: string, contentType: string, contentBytes: string}>,
 *   blockHtml: string, summary: {report: boolean, jd: string, cv: string, rounds: number},
 *   model: object|null}>}
 */
export async function buildPanelPack(pipelineId, { user = null } = {}) {
  const attachments = [];
  let total = 0;
  const fits = (bytes) => total + bytes <= JD_ATTACH_MAX_BYTES;
  const add = (name, contentType, buffer) => {
    attachments.push({ name, contentType, contentBytes: buffer.toString('base64') });
    total += buffer.length;
  };
  const summary = { report: false, jd: 'none', cv: 'none', rounds: 0 };

  const journey = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    select: { mrf_id: true, rpa_shortlisted_candidates: { select: { candidate_name: true, mrf_id: true } } },
  });
  const candidateName = journey?.rpa_shortlisted_candidates?.candidate_name || 'Candidate';

  // 1) The report so far — only when an earlier round produced something.
  let model = null;
  let lines = [];
  try {
    model = await buildDossierModel(pipelineId, { includeContactDetails: false, generatedBy: user });
    if (hasEarlierResults(model)) {
      const links = await collectRecordingShareLinks(pipelineId, { include: true, user });
      applyRecordingShareLinks(model, links, { includeRecordingLinks: true });
      assertNoForbiddenFields(model);
      lines = earlierRoundLines(model);
      summary.rounds = lines.length;
      const html = Buffer.from(renderDossierHtml(model), 'utf8');
      if (fits(html.length)) {
        add(`${safeFileName(candidateName)} - report so far.html`, 'text/html', html);
        summary.report = true;
      }
    }
  } catch (err) {
    logger.warn(`Panel pack: the report so far could not be built for pipeline ${pipelineId}: ${err.message}`);
  }

  // 2) The role's JD (cached; never throws).
  const mrfId = journey?.mrf_id || journey?.rpa_shortlisted_candidates?.mrf_id || null;
  const jd = mrfId ? await getMrfJdAttachment(mrfId) : { attachment: null, link: null };
  if (jd.attachment && fits(jd.sizeBytes || 0)) {
    attachments.push(jd.attachment);
    total += jd.sizeBytes || 0;
    summary.jd = 'attached';
  } else if (jd.link) {
    summary.jd = 'link';
  }

  // 3) The CV, fetched the way the dossier ZIP fetches it.
  try {
    const { files } = await collectAttachments(pipelineId, { includeResume: true, includeDocuments: false, candidateName });
    const resume = files?.[0];
    if (resume) {
      if (fits(resume.buffer.length)) {
        const name = String(resume.name).replace(/^attachments\//, '');
        add(name, /\.pdf$/i.test(name) ? 'application/pdf' : 'application/octet-stream', resume.buffer);
        summary.cv = 'attached';
      } else {
        summary.cv = 'too_large';
      }
    }
  } catch (err) {
    logger.warn(`Panel pack: the CV could not be attached for pipeline ${pipelineId}: ${err.message}`);
  }

  return {
    attachments,
    blockHtml: buildEarlierRoundsBlock({ lines, summary, jdLink: jd.link || null }),
    summary,
    model,
  };
}

/**
 * Record a pack that went to a panel: the dossier audit row (it is the dossier,
 * leaving the building) and a line on the candidate's timeline. Never throws.
 */
export async function logPanelPackSent({ pipelineId, stageKey, stageLabel, user, pack, recipientCount }) {
  const parts = [
    pack.summary.jd === 'attached' ? 'JD' : null,
    pack.summary.cv === 'attached' ? 'CV' : null,
    pack.summary.report ? 'report so far' : null,
  ].filter(Boolean);
  if (pack.summary.report && pack.model) {
    await logDossierDownload({
      pipelineId,
      user,
      model: pack.model,
      format: 'panel-email',
      bytes: pack.attachments.reduce((n, a) => n + Math.floor((a.contentBytes.length * 3) / 4), 0),
      includedCategories: ['report so far (to the interview panel)'],
      stageKey,
      url: 'interview panel invite',
    }).catch(() => {});
  }
  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: BigInt(pipelineId),
      stage_key: stageKey,
      event_type: 'note',
      notes: `${parts.length ? parts.join(', ') : 'Earlier-round summary'} sent to the ${stageLabel} panel (${recipientCount} ${recipientCount === 1 ? 'person' : 'people'}).`,
      acted_by: user?.id || null,
    },
  }).catch((err) => logger.error(`AUDIT GAP: panel pack for pipeline ${pipelineId} was sent but not noted: ${err.message}`));
}

/**
 * "Send JD, CV and report so far to the panel" for a round that is already
 * booked (L14): rounds booked before this change, or a panel that should see a
 * scorecard that arrived after their invite. Sent to the booking's own panel
 * addresses, so it is OPERATOR_ADDRESSED like the invite itself.
 *
 * @param {number|string} scheduleId
 * @param {object} user - req.user
 * @returns {Promise<{sent: boolean, recipients: number, summary: object}>}
 */
export async function sendPanelPackForBooking(scheduleId, user) {
  const schedule = await prisma.rpa_interview_schedule.findUnique({
    where: { id: BigInt(scheduleId) },
    include: {
      rpa_pipeline_stages: { select: { label: true } },
      rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: { include: { mrf: { select: { position_hiring_for: true } } } } } },
    },
  });
  if (!schedule) throw new AppError('Interview booking not found.', 404);
  if (schedule.cancelled_at || schedule.superseded_at || schedule.status === 'cancelled') {
    throw new AppError('This booking is no longer live, so there is no panel to send the pack to.', 409);
  }
  const { emails } = parseInterviewerEmails(schedule.interviewer_email || '');
  if (emails.length === 0) throw new AppError('This booking has no interviewer email to send the pack to.', 409);

  const pipelineId = schedule.pipeline_id;
  const shortlist = schedule.rpa_candidate_pipeline?.rpa_shortlisted_candidates;
  const stageLabel = schedule.rpa_pipeline_stages?.label || schedule.stage_key;
  const pack = await buildPanelPack(pipelineId, { user });

  const rendered = await renderInterviewTemplate(INTERVIEW_EMAIL_TEMPLATE_NAMES.panelPack, {
    interviewer_name: interviewerGreeting(schedule.interviewer_name, schedule.interviewer_email),
    stage_label: stageLabel,
    candidate_name: shortlist?.candidate_name || 'the candidate',
    position: shortlist?.mrf?.position_hiring_for || shortlist?.position_applied || 'the role',
    interview_when: fmtDateTimeIst(schedule.scheduled_start_at),
  }, {
    earlier_rounds_block: pack.blockHtml || '<p>No earlier rounds have been completed yet.</p>',
  });

  const { to } = resolveRecipients('interviewScheduledPanel', emails.join(', '));
  await sendGraphEmail({
    sender: config.microsoft.defaultSender,
    to,
    subject: rendered.subject,
    html: rendered.html,
    // OPERATOR_ADDRESSED: the booking's own panel, typed in the Schedule modal.
    allowRealRecipients: true,
    attachments: pack.attachments,
  });
  await logPanelPackSent({ pipelineId, stageKey: schedule.stage_key, stageLabel, user, pack, recipientCount: emails.length });
  return { sent: true, recipients: emails.length, summary: pack.summary };
}

export default { buildPanelPack, logPanelPackSent, panelPackEnabled, sendPanelPackForBooking };
