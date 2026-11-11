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
 * SIZE. Graph takes attachments inline as base64, so each file is measured by
 * its base64 length (U02) against one email's budget, EMAIL_ATTACH_MAX_BASE64
 * (3.5 MB). Files are added in priority order: the report (a few KB), then the
 * JD, then the CV.
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
import { getMrfJdAttachment, getMrfJdPresence, base64Size, fitsEmailAttachments } from './jdAttachment.service.js';
import {
  buildEarlierRoundsBlock, buildPackNotes, earlierRoundLines, hasEarlierResults, packVariantFor,
} from '../utils/panelPackBlock.js';
import {
  buildPanelCandidateTable, panelTableRounds, showsCtc, sourceShown,
} from '../utils/panelCandidateTable.js';
import { earlierRoleHasResults, mergeEarlierRoles } from '../utils/panelEarlierRoles.js';
import AppError from '../utils/AppError.js';
import { resolveRecipients } from '../config/emailRecipients.js';
import { sendGraphEmail } from './emailNotification.service.js';
import { renderInterviewTemplate } from './interviewEmailRender.js';
import { INTERVIEW_EMAIL_TEMPLATE_NAMES } from './interviewEmailTemplates.js';
import { interviewerGreeting } from '../utils/emailGreeting.js';
import { fmtDateTimeIst } from '../utils/dateFormat.js';
import { parseInterviewerEmails } from './interviewSchedule.service.js';
import { RESUME_CONTENT_TYPES, resumeStatus as storedResumeStatus } from '../utils/resumeCheck.js';

/** Is the panel pack switched on? (INTERVIEW_PANEL_PACK_ENABLED, default on.) */
export function panelPackEnabled() {
  return config.interviewPanelPack?.enabled !== false;
}

const safeFileName = (s) => String(s || 'Candidate').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

/**
 * What `summary.cv` can say (U01). Only `attached` means a file travelled;
 * the rest say why not, and panelPackBlock.js words each one for the panel.
 */
export const PACK_CV_STATUS = Object.freeze({
  ATTACHED: 'attached',
  MISSING: 'missing',
  NOT_A_RESUME: 'not_a_resume',
  FAILED: 'failed',
  TOO_LARGE: 'too_large',
});

/** How far back a moved candidate's earlier journeys are followed (U07). */
const EARLIER_ROLE_MAX_DEPTH = 5;

/**
 * U07: the journeys this one was moved from, oldest first, by following
 * `moved_from_pipeline_id` (journeyMove.service.js). Only the same candidate's
 * journeys; a loop or a missing row ends the walk. Never throws.
 * @param {number|string} pipelineId
 * @returns {Promise<bigint[]>}
 */
export async function earlierJourneyIds(pipelineId) {
  const ids = [];
  try {
    const start = await prisma.rpa_candidate_pipeline.findUnique({
      where: { id: BigInt(pipelineId) },
      select: { cv_id: true, moved_from_pipeline_id: true },
    });
    const seen = new Set([String(pipelineId)]);
    let next = start?.moved_from_pipeline_id ?? null;
    while (next != null && ids.length < EARLIER_ROLE_MAX_DEPTH && !seen.has(String(next))) {
      seen.add(String(next));
      const row = await prisma.rpa_candidate_pipeline.findUnique({
        where: { id: BigInt(next) },
        select: { id: true, cv_id: true, moved_from_pipeline_id: true },
      });
      if (!row || (start.cv_id != null && row.cv_id != null && String(row.cv_id) !== String(start.cv_id))) break;
      ids.push(row.id);
      next = row.moved_from_pipeline_id ?? null;
    }
  } catch (err) {
    logger.warn(`Panel pack: the earlier roles of pipeline ${pipelineId} could not be read: ${err.message}`);
  }
  return ids.reverse();
}

/**
 * U07: one redacted dossier model per earlier journey that holds results, for
 * mergeEarlierRoles(). Each journey's own scorecards, assessments, Zeko (by its
 * own shortlist_id) and recordings; with `recordingLinks`, its recordings get
 * no-login share links (minted and audited per journey, as for this one). An
 * earlier journey that cannot be read is left out. Never throws.
 *
 * @param {number|string} pipelineId - the CURRENT journey
 * @param {{ user?: object, recordingLinks?: boolean, includeAssessmentDetail?: boolean }} [options]
 * @returns {Promise<Array<{role: string|null, model: object}>>} oldest first
 */
export async function loadEarlierRoleModels(pipelineId, {
  user = null, recordingLinks = false, includeAssessmentDetail = true,
} = {}) {
  const out = [];
  for (const id of await earlierJourneyIds(pipelineId)) {
    try {
      const model = await buildDossierModel(id, { includeContactDetails: false, includeAssessmentDetail, generatedBy: user });
      if (!earlierRoleHasResults(model)) continue;
      if (recordingLinks && (model.recordings || []).length) {
        const links = await collectRecordingShareLinks(id, { include: true, user });
        applyRecordingShareLinks(model, links, { includeRecordingLinks: true });
      }
      out.push({ role: model.candidate?.position || null, model });
    } catch (err) {
      logger.warn(`Panel pack: earlier journey ${id} of pipeline ${pipelineId} left out: ${err.message}`);
    }
  }
  return out;
}

/**
 * @param {number|string} pipelineId
 * @param {{ user?: object, attachProfile?: boolean, stageKey?: string|null,
 *   includeEarlierRoles?: boolean }} [options]
 *   - `attachProfile` (U01): when no resume can travel, attach the candidate
 *     profile summary (the redacted dossier as HTML) instead, even on a first round.
 *   - `stageKey` (U03): the round the panel is for; picks the report's cut
 *     (packVariantFor). Tech rounds get only the named consolidated feedback,
 *     and no report at all when there is none yet.
 *   - `includeEarlierRoles` (U07, default on): a candidate moved from another
 *     JD brings that journey's rounds (loadEarlierRoleModels), into both the
 *     report and `tableModel`, labelled "· earlier role: <title>".
 * @returns {Promise<{attachments: Array<{name: string, contentType: string, contentBytes: string}>,
 *   blockHtml: string, notesHtml: string,
 *   summary: {report: boolean, profile: boolean, jd: 'attached'|'link'|'none',
 *     cv: 'attached'|'missing'|'not_a_resume'|'failed'|'too_large', rounds: number},
 *   model: object|null, tableModel: object|null}>}
 *   `notesHtml` is what is attached (U03: it goes under the candidate table);
 *   `blockHtml` is the older "Earlier rounds" block plus the same notes.
 *   `tableModel` is the dossier model with this email's recording links, for
 *   loadPanelCandidateTable().
 */
export async function buildPanelPack(pipelineId, {
  user = null, attachProfile = false, stageKey = null, includeEarlierRoles = true,
} = {}) {
  const variant = packVariantFor(stageKey);
  const attachments = [];
  let total = 0; // base64 characters already on the email (U02)
  const fits = (bytes) => fitsEmailAttachments(total + base64Size(bytes));
  const add = (name, contentType, buffer) => {
    const contentBytes = buffer.toString('base64');
    attachments.push({ name, contentType, contentBytes });
    total += contentBytes.length;
  };
  const summary = { report: false, profile: false, jd: 'none', cv: PACK_CV_STATUS.MISSING, rounds: 0 };

  const journey = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    select: { mrf_id: true, rpa_shortlisted_candidates: { select: { candidate_name: true, mrf_id: true } } },
  });
  const candidateName = journey?.rpa_shortlisted_candidates?.candidate_name || 'Candidate';

  // 1) The report so far — only when an earlier round produced something.
  // U03: a technical round's cut is the named consolidated feedback alone, so
  // with no scorecard yet (usually Tech 1) there is no report to attach.
  let model = null;
  let lines = [];
  try {
    model = await buildDossierModel(pipelineId, { includeContactDetails: false, generatedBy: user });
    // This journey's links go on BEFORE the merge: they are matched by position.
    if (hasEarlierResults(model)) {
      const links = await collectRecordingShareLinks(pipelineId, { include: true, user });
      applyRecordingShareLinks(model, links, { includeRecordingLinks: true });
    }
    // U07: the earlier role's rounds, with their own recording links.
    if (includeEarlierRoles) {
      model = mergeEarlierRoles(model, await loadEarlierRoleModels(pipelineId, { user, recordingLinks: true }));
    }
    if (hasEarlierResults(model)) {
      assertNoForbiddenFields(model);
      lines = earlierRoundLines(model);
      summary.rounds = lines.length;
      const wantReport = variant !== 'panel_tech' || (model.consolidated_by_interviewer || []).length > 0;
      const html = wantReport ? Buffer.from(renderDossierHtml(model, { variant }), 'utf8') : null;
      if (html && fits(html.length)) {
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
  if (jd.attachment && fitsEmailAttachments(total + jd.attachment.contentBytes.length)) {
    attachments.push(jd.attachment);
    total += jd.attachment.contentBytes.length;
    summary.jd = 'attached';
  } else if (jd.link) {
    summary.jd = 'link';
  }

  // 3) The CV, fetched the way the dossier ZIP fetches it. Only a real resume
  // (pdf/doc/docx, checked on the record and on the bytes) travels (U01).
  try {
    const { files, resumeStatus } = await collectAttachments(pipelineId, { includeResume: true, includeDocuments: false, candidateName });
    const resume = (files || []).find((f) => /(^|\/)01_Resume_/.test(f.name));
    if (resume) {
      if (fits(resume.buffer.length)) {
        const name = String(resume.name).replace(/^attachments\//, '');
        const ext = (/\.[a-z0-9]+$/i.exec(name)?.[0] || '').toLowerCase();
        add(name, RESUME_CONTENT_TYPES[ext] || 'application/octet-stream', resume.buffer);
        summary.cv = PACK_CV_STATUS.ATTACHED;
      } else {
        summary.cv = PACK_CV_STATUS.TOO_LARGE;
      }
    } else {
      summary.cv = Object.values(PACK_CV_STATUS).includes(resumeStatus) ? resumeStatus : PACK_CV_STATUS.MISSING;
    }
  } catch (err) {
    summary.cv = PACK_CV_STATUS.FAILED;
    logger.warn(`Panel pack: the CV could not be attached for pipeline ${pipelineId}: ${err.message}`);
  }

  // 4) U01: no resume travelled and HR asked for the profile summary instead.
  // The report so far already IS that summary when it is attached. A panel cut
  // of it (U03) leads with the profile: the leadership one, whatever the round.
  const tableModel = model;
  if (attachProfile && summary.cv !== PACK_CV_STATUS.ATTACHED && !summary.report) {
    try {
      const profileModel = model || await buildDossierModel(pipelineId, { includeContactDetails: false, generatedBy: user });
      assertNoForbiddenFields(profileModel);
      const html = Buffer.from(renderDossierHtml(profileModel, { variant: variant === 'download' ? 'download' : 'panel_leadership' }), 'utf8');
      if (fits(html.length)) {
        add(`${safeFileName(candidateName)} - candidate profile.html`, 'text/html', html);
        summary.profile = true;
        model = profileModel;
      }
    } catch (err) {
      logger.warn(`Panel pack: the candidate profile could not be attached for pipeline ${pipelineId}: ${err.message}`);
    }
  }

  return {
    attachments,
    blockHtml: buildEarlierRoundsBlock({ lines, summary, jdLink: jd.link || null }),
    notesHtml: buildPackNotes({
      summary,
      jdLink: jd.link || null,
      recordingLinks: (tableModel?.recordings || []).some((r) => r.share_url),
      variant,
    }),
    summary,
    model,
    tableModel,
  };
}

/** The latest submitted HR scorecard's CTC (U03), or nulls. Never throws. */
async function hrScorecardCtc(pipelineId) {
  try {
    const card = await prisma.rpa_interview_scorecard.findFirst({
      where: { pipeline_id: BigInt(pipelineId), card_type: 'hr', status: 'submitted' },
      orderBy: { submitted_at: 'desc' },
      select: { hr_current_ctc: true, hr_expected_ctc: true },
    });
    return { current: card?.hr_current_ctc || null, expected: card?.hr_expected_ctc || null };
  } catch (err) {
    logger.warn(`Panel table: HR scorecard CTC unreadable for pipeline ${pipelineId}: ${err.message}`);
    return { current: null, expected: null };
  }
}

/**
 * U03: the candidate table for the panel's invite body. Never throws: a table
 * that cannot be built is an empty string, and the invite goes without it.
 *
 * The facts (email, CTC, source, notice…) are read HERE, from rpa_cv, and never
 * enter the dossier model. CTC is read only for the HR and CEO rounds (the HR
 * scorecard's figures first, else the CV's). Source shows only when asked for,
 * and never for a referral (Phase 3 rule).
 *
 * @param {number|string} pipelineId
 * @param {object} [options]
 * @param {string|null} [options.stageKey] - the round the invite is for
 * @param {boolean} [options.showSource] - the Schedule window's tick-box
 * @param {object|null} [options.model] - buildPanelPack()'s `tableModel` (with
 *   this email's recording links); built here, without links, when absent
 * @param {boolean} [options.linksPending] - preview: links are minted at send
 * @param {boolean} [options.includeEarlierRoles] - U07 (default on): add the
 *   rounds of the journeys this one was moved from. A `model` already merged by
 *   buildPanelPack() is used as is; otherwise they are read here, without links.
 * @returns {Promise<{html: string, showSource: boolean, referral: boolean}>}
 */
export async function loadPanelCandidateTable(pipelineId, {
  stageKey = null, showSource = false, model = null, linksPending = false, includeEarlierRoles = true,
} = {}) {
  try {
    const journey = await prisma.rpa_candidate_pipeline.findUnique({
      where: { id: BigInt(pipelineId) },
      select: {
        cv_id: true,
        rpa_shortlisted_candidates: {
          select: { candidate_name: true, candidate_email: true, position_applied: true, mrf: { select: { position_hiring_for: true } } },
        },
      },
    });
    if (!journey) return { html: '', showSource: false, referral: false };
    const cv = journey.cv_id
      ? await prisma.rpa_cv.findUnique({
        where: { id: journey.cv_id },
        select: {
          Name: true, EmailID: true, NoticePeriod: true, HighestQualification: true, TotalExperienceYears: true,
          CTC_LPA: true, ExpectedCTC_LPA: true, JobSource: true, is_referral: true, createdAt: true, ZekoInterviewScore: true,
        },
      })
      : null;
    const referral = Boolean(cv?.is_referral);
    const withSource = sourceShown(showSource, { referral });
    const withCtc = showsCtc(stageKey);
    const ctc = withCtc ? await hrScorecardCtc(pipelineId) : { current: null, expected: null };
    const shortlist = journey.rpa_shortlisted_candidates;
    const facts = {
      applied_at: cv?.createdAt || null,
      name: shortlist?.candidate_name || cv?.Name || null,
      role: shortlist?.mrf?.position_hiring_for || shortlist?.position_applied || null,
      source: withSource ? (cv?.JobSource || null) : null,
      notice: cv?.NoticePeriod || null,
      qualification: cv?.HighestQualification || null,
      email: cv?.EmailID || shortlist?.candidate_email || null,
      experience: cv?.TotalExperienceYears || null,
      current_ctc: withCtc ? (ctc.current || cv?.CTC_LPA || null) : null,
      expected_ctc: withCtc ? (ctc.expected || cv?.ExpectedCTC_LPA || null) : null,
      zeko_uploaded: cv?.ZekoInterviewScore ?? null,
      referral,
    };
    let dossier = model || await buildDossierModel(pipelineId, { includeContactDetails: false, includeAssessmentDetail: false });
    if (includeEarlierRoles && !Array.isArray(dossier.earlier_roles)) {
      dossier = mergeEarlierRoles(dossier, await loadEarlierRoleModels(pipelineId, { includeAssessmentDetail: false }));
    }
    const rounds = panelTableRounds(dossier, { excludeStageKey: stageKey });
    return {
      html: buildPanelCandidateTable({ facts, rounds, stageKey, showSource, linksPending }),
      showSource: withSource,
      referral,
    };
  } catch (err) {
    logger.warn(`Panel table could not be built for pipeline ${pipelineId}: ${err.message}`);
    return { html: '', showSource: false, referral: false };
  }
}

/**
 * U01: what the panel pack WILL carry, from the records alone (nothing is
 * downloaded), so the Schedule window can warn before anything is sent.
 * Never throws: an unreadable record reads as "missing".
 *
 * @param {number|string} pipelineId
 * @returns {Promise<{resume: 'ok'|'missing'|'not_a_resume', jd: 'ok'|'missing', report: boolean}>}
 */
export async function panelPackPreflight(pipelineId) {
  const out = { resume: 'missing', jd: 'missing', report: false };
  try {
    const journey = await prisma.rpa_candidate_pipeline.findUnique({
      where: { id: BigInt(pipelineId) },
      select: { cv_id: true, mrf_id: true, rpa_shortlisted_candidates: { select: { mrf_id: true } } },
    });
    if (!journey) return out;
    const cv = journey.cv_id
      ? await prisma.rpa_cv.findUnique({
        where: { id: journey.cv_id },
        select: { cvFileUrl: true, cv_file_item_id: true, missingData: true },
      })
      : null;
    out.resume = storedResumeStatus(cv);
    out.jd = await getMrfJdPresence(journey.mrf_id || journey.rpa_shortlisted_candidates?.mrf_id || null);
    const model = await buildDossierModel(pipelineId, { includeContactDetails: false });
    // U07: a moved candidate's earlier role counts too.
    out.report = hasEarlierResults(model)
      || (await loadEarlierRoleModels(pipelineId, { includeAssessmentDetail: false })).length > 0;
  } catch (err) {
    logger.warn(`Panel pack preflight failed for pipeline ${pipelineId}: ${err.message}`);
  }
  return out;
}

/** The timeline's words for a resume that did not travel (U01). */
const CV_NOT_SENT = {
  missing: 'no resume on file',
  not_a_resume: 'the file on record is not a resume',
  failed: 'the resume could not be fetched',
  too_large: 'the resume was too large to attach',
};

/**
 * Record a pack that went to a panel: the dossier audit row (it is the dossier,
 * leaving the building) and a line on the candidate's timeline. Never throws.
 */
export async function logPanelPackSent({ pipelineId, stageKey, stageLabel, user, pack, recipientCount }) {
  const parts = [
    pack.summary.jd === 'attached' ? 'JD' : null,
    pack.summary.cv === 'attached' ? 'CV' : null,
    pack.summary.report ? 'report so far' : null,
    pack.summary.profile ? 'candidate profile' : null,
  ].filter(Boolean);
  const cvNote = CV_NOT_SENT[pack.summary.cv] ? ` CV not sent: ${CV_NOT_SENT[pack.summary.cv]}.` : '';
  if ((pack.summary.report || pack.summary.profile) && pack.model) {
    await logDossierDownload({
      pipelineId,
      user,
      model: pack.model,
      format: 'panel-email',
      bytes: pack.attachments.reduce((n, a) => n + Math.floor((a.contentBytes.length * 3) / 4), 0),
      includedCategories: [pack.summary.report
        ? 'report so far (to the interview panel)'
        : 'candidate profile summary (to the interview panel, no resume on file)'],
      stageKey,
      url: 'interview panel invite',
    }).catch(() => {});
  }
  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: BigInt(pipelineId),
      stage_key: stageKey,
      event_type: 'note',
      notes: `${parts.length ? parts.join(', ') : 'Earlier-round summary'} sent to the ${stageLabel} panel (${recipientCount} ${recipientCount === 1 ? 'person' : 'people'}).${cvNote}`,
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
 * @param {{ attachProfile?: boolean, showSource?: boolean }} [options] - U01:
 *   attach the candidate profile summary when no resume can travel. U03: show
 *   the candidate's source in the table (never for a referral).
 * @returns {Promise<{sent: boolean, recipients: number, summary: object}>}
 */
export async function sendPanelPackForBooking(scheduleId, user, { attachProfile = false, showSource = false } = {}) {
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
  const pack = await buildPanelPack(pipelineId, { user, attachProfile, stageKey: schedule.stage_key });
  // U03: the candidate table, then what is attached. Placed through the
  // template's {{earlier_rounds_block}}, so a stored template keeps working.
  const table = await loadPanelCandidateTable(pipelineId, { stageKey: schedule.stage_key, showSource, model: pack.tableModel });
  const block = `${table.html}${pack.notesHtml}`;

  const rendered = await renderInterviewTemplate(INTERVIEW_EMAIL_TEMPLATE_NAMES.panelPack, {
    interviewer_name: interviewerGreeting(schedule.interviewer_name, schedule.interviewer_email),
    stage_label: stageLabel,
    candidate_name: shortlist?.candidate_name || 'the candidate',
    position: shortlist?.mrf?.position_hiring_for || shortlist?.position_applied || 'the role',
    interview_when: fmtDateTimeIst(schedule.scheduled_start_at),
  }, {
    earlier_rounds_block: block || '<p>No earlier rounds have been completed yet.</p>',
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

export default {
  buildPanelPack, earlierJourneyIds, loadEarlierRoleModels, loadPanelCandidateTable, logPanelPackSent,
  panelPackEnabled, panelPackPreflight, sendPanelPackForBooking, PACK_CV_STATUS,
};
