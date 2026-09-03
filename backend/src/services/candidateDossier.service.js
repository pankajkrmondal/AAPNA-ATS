/**
 * candidateDossier.service.js — the "candidate complete download".
 *
 * WHAT THIS IS FOR. A recruiter opens a candidate, clicks Download, and gets one
 * file they can email to an interviewer who has no ATS account — typically a
 * one-off Technical 3/4 round run by someone outside the company. From the
 * review call (Sanghamitra Roy, 28 Aug 2026, 39:17): "Chhaya, who's a recruiter,
 * should be able to download all that Pankaj has cleared so far and should be
 * able to share with Atul on mail." The in-ATS route was explicitly rejected
 * twice (41:35, 41:48), so this produces a FILE and nothing else — no portal, no
 * invite, no login page.
 *
 * WHY THE MODEL IS SEPARATE FROM THE RENDERERS. This file assembles and redacts;
 * exports/candidateDossier.export.js turns the result into HTML, XLSX and a ZIP.
 * Splitting them is what lets the redaction rules be unit-tested with no
 * database and no Express app (see tests/unit/dossierRedaction.test.js), which
 * matters more here than in any other export: this is the one artefact designed
 * to leave the building, and its safety property has to be testable in
 * isolation.
 *
 * WHAT IS DELIBERATELY NOT HERE (Phase 1 — plan §9):
 *   - No binary attachments. Resumes and candidate documents live behind a
 *     Microsoft login and need Graph read-back (Phase 2); the pack says so
 *     honestly rather than shipping a link an outsider cannot open.
 *   - No recording share links. The pack lists which recordings exist and tells
 *     the reader to ask the recruiter (Phase 4 mints 14-day no-login links).
 * Both degrade to an explicit line in the manifest, never to silence.
 *
 * Plan: docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §5, §8.
 */
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { emailCandidates } from '../utils/emailMatch.js';
import { downloadDriveItem } from './onedrive.service.js';
import { serializeRecording } from './interviewRecording.service.js';
import { getCandidateScorecardReport } from './interviewScorecard.service.js';
import { generateZekoShareLink, getZekoReport } from './zeko.service.js';
import { parseZekoReportUrl } from '../utils/zekoShareLink.js';
import {
  assertNoForbiddenFields,
  pickCvProfile,
  redactionSummary,
} from '../utils/dossierRedaction.js';
import {
  applyAttachments, applyZekoExtras, describeIncludedCategories, describeJourneyStatus,
  extensionFor,
} from '../utils/dossierModel.js';

// Re-exported so the controller keeps a single dossier import, and so callers do
// not have to know that these are pure helpers living elsewhere. They are
// separate modules only because this file's dependency chain (the scorecard
// service pulls in email and notifications) cannot be imported from a unit test
// — see dossierModel.js's header.
export {
  applyAttachments, applyZekoExtras, describeIncludedCategories, describeJourneyStatus,
};

/**
 * rpa_cv columns fetched from the database.
 *
 * Explicitly `select`ed rather than fetching the row and filtering afterwards.
 * A `SELECT *` here would put CTC and vendor identity in this process's memory
 * one careless spread away from the renderer — the whitelist is cheaper to trust
 * when the forbidden values were never loaded at all.
 *
 * Derived from the whitelist rather than written twice, so §8.1 has exactly one
 * definition. Contact columns are always fetched (the toggle is applied at
 * projection time, in buildDossierModel) because the same model feeds both the
 * preview and the download, and the preview must be able to show a recruiter
 * what they are about to withhold.
 */
const CV_SELECT = Object.fromEntries(
  [...pickCvProfile(null, { includeContactDetails: true }).map((e) => e.field)].map((f) => [f, true]),
);

/** MRF columns the position brief may show. No budget — plan §8.2. */
const MRF_SELECT = {
  id: true,
  position_hiring_for: true,
  employment_type: true,
  total_years_of_experience: true,
  relevant_years_of_experience: true,
  desired_qualification: true,
  mandatory_skills: true,
  good_to_have_skills: true,
  roles_responsibilities: true,
  competencies_required: true,
  requirement_for_team: true,
  job_timing: true,
};

/** Plain-language labels for the position brief, in render order. */
const MRF_FIELDS = Object.freeze([
  ['position_hiring_for', 'Role'],
  ['requirement_for_team', 'Team'],
  ['employment_type', 'Employment type'],
  ['total_years_of_experience', 'Total experience required (years)'],
  ['relevant_years_of_experience', 'Relevant experience required (years)'],
  ['desired_qualification', 'Desired qualification'],
  ['mandatory_skills', 'Mandatory skills'],
  ['good_to_have_skills', 'Good to have'],
  ['competencies_required', 'Competencies'],
  ['roles_responsibilities', 'Responsibilities'],
  ['job_timing', 'Working hours'],
]);

/** BigInt/Decimal → JSON-safe. Prisma hands back both; JSON.stringify handles neither. */
const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Stages whose free text is commercial and must not travel in a dossier.
 *
 * The offer round's own notes are written by the ATS in the form "Offer recorded
 * as shared — proposed joining <date>". That is an offer term, which §8.2
 * forbids, arriving through rpa_pipeline_stage_events rather than through
 * rpa_offers — so dropping the offer RECORD is not sufficient on its own.
 *
 * Keyed by stage rather than by scanning the text for money-shaped words: a
 * word scan would fail a download because a recruiter wrote "discussed
 * package expectations" on a technical round, and would still miss a joining
 * date phrased differently. The stage is the fact that is actually known.
 */
const COMMERCIAL_STAGE_KEYS = new Set(['offer']);

/**
 * Every Zeko round's scores for a journey.
 *
 * Matched by CANDIDATE EMAIL, not by pipeline_id alone. rpa_zeko_interview_results
 * is keyed by Zeko's own interview id, which belongs to the JOB and is shared by
 * every candidate booked against it — filtering on pipeline_id alone returns
 * whichever candidate synced last. That defect reached production once already
 * (RT 2026-08-24: one candidate's round rendering another's score and report
 * link); the RCA note at pipeline.service.js:499-513 has the detail. Repeating
 * it inside a file that gets EMAILED OUTSIDE THE COMPANY would be materially
 * worse than repeating it on screen, so the same email match is applied here.
 *
 * @param {object} pipeline - rpa_candidate_pipeline row
 * @param {string|null} candidateEmail
 * @returns {Promise<Array<object>>}
 */
async function fetchZekoRounds(pipeline, candidateEmail) {
  if (!pipeline.shortlist_id) return [];

  const rounds = await prisma.rpa_zeko_candidate_pipeline.findMany({
    where: { candidate_id: pipeline.shortlist_id, status: { not: 'cancelled' } },
    orderBy: { created_at: 'asc' },
  });
  if (!rounds.length) return [];

  const out = [];
  for (const round of rounds) {
    const wanted = emailCandidates(round.candidate_email || candidateEmail);
    // No address to match on means we cannot PROVE a result row is this
    // candidate's. The round reports no score rather than guessing — the pack
    // says "not available", which is honest, instead of a stranger's number.
    const result = wanted.length
      ? await prisma.rpa_zeko_interview_results.findFirst({
        where: {
          pipeline_id: round.pipeline_id,
          OR: wanted.map((email) => ({ candidate_email: { equals: email, mode: 'insensitive' } })),
        },
        orderBy: { created_at: 'desc' },
      })
      : null;

    out.push({
      round: round.stage === 'functional' ? 'Functional screening' : 'HR screening',
      status: round.status,
      taken_at: round.completed_at || round.interview_end_at || null,
      overall_score: result ? num(result.scores_overallscore) : null,
      technical_score: result ? num(result.scores_technicalscore) : null,
      communication_score: result ? num(result.scores_communicationscore) : null,
      // The stored report URL is Zeko's RECRUITER page and needs a Zeko login,
      // so it never travels in the pack. Only the fact that a report exists does
      // — and, from Phase 3, the no-login share link minted for it (see
      // collectZekoShareLinks).
      report_available: Boolean(result?.reportlink),
      // NOT part of the model: stripped in buildDossierModel before anything is
      // rendered. It is carried here only so the share-link collector can find
      // the round's Zeko ids without repeating the email-matching above, which
      // is the part that is easy to get wrong.
      locator: parseZekoReportUrl(result?.reportlink),
    });
  }
  return out;
}

/**
 * Give a promise a wall-clock ceiling, whatever it is waiting on internally.
 *
 * The Zeko client's own fetches carry AbortSignal timeouts, but the step that
 * actually runs long is not a fetch: an invalidated dashboard cookie sends it
 * through the OTP login — request a code, poll the mailbox, verify — which
 * measured 38 seconds against staging. No signal reaches inside that, so it is
 * raced instead.
 *
 * The losing work is NOT cancelled, deliberately: the login finishes in the
 * background and stores a fresh cookie, so the download that paid the cost is
 * the only one that degrades. The timer is unref'd so a pending race can never
 * hold the process open.
 *
 * @param {Promise<*>} promise
 * @param {number} ms
 */
function withDeadline(promise, ms) {
  if (!(ms > 0)) return Promise.reject(new Error('the time budget for this step was already spent'));
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      timer.unref?.();
    }),
  ]);
}

/**
 * Fetch what the pack carries from Zeko: the screening report itself, and
 * optionally the public share link (plan §6.6, §6.7).
 *
 * WHY A SEPARATE STEP, LIKE collectAttachments(). Both of these are network
 * calls to a third party, and one of them — the share link — is a disclosure
 * decision that mints a public URL to a real person's report. Neither belongs in
 * the model builder, which also serves the PREVIEW: opening the "what will be
 * shared" dialog must not create public Zeko links, or spend Zeko round trips,
 * as a side effect of looking. So the model says a report exists, and this runs
 * only on an actual download.
 *
 * BOTH IN ONE PASS. They need the same rounds, the same ids and the same cookie,
 * and a candidate's rounds usually point at ONE report — so the rounds are read
 * once and each distinct report is fetched once, however many rounds reference
 * it, under a single time budget.
 *
 * DEGRADE, NEVER FAIL — for the same reason attachments do. A Zeko outage, an
 * expired dashboard cookie or a round whose stored link predates the current URL
 * format must cost the pack a manifest line, not the whole download.
 *
 * Reads its own rounds rather than taking them off the model, exactly as
 * collectAttachments() reads its own locators: the model is the redacted thing
 * that gets rendered, and a login-walled vendor URL has no business being on it
 * even briefly.
 *
 * @param {number|string} pipelineId
 * @param {{ includeReport?: boolean, includeShareLink?: boolean, timeoutMs?: number, budgetMs?: number }} [options]
 * @returns {Promise<{reports: Array<{index: number, round: string, detail: object}>,
 *   links: Array<{index: number, round: string, url: string}>, notes: object, degraded: boolean}>}
 */
export async function collectZekoExtras(pipelineId, options = {}) {
  const { includeReport = true, includeShareLink = false } = options;
  const reports = [];
  const links = [];
  const notes = {};
  let degraded = false;

  if (!includeReport && !includeShareLink) {
    return { reports, links, notes, degraded };
  }

  const deadline = Date.now() + (Number(options.budgetMs) > 0
    ? Number(options.budgetMs)
    : config.dossier.zekoLinkBudgetMs);

  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    select: {
      id: true,
      shortlist_id: true,
      rpa_shortlisted_candidates: { select: { candidate_email: true } },
    },
  });
  if (!pipeline) return { reports, links, notes, degraded };

  const rounds = await fetchZekoRounds(
    pipeline,
    pipeline.rpa_shortlisted_candidates?.candidate_email || null,
  );

  // Memoised per candidate+job: one candidate on one job is one report, and Zeko
  // returns the same share link id every time, so neither is worth fetching twice.
  const reportByLocator = new Map();
  const linkByLocator = new Map();

  /** Record a failure the way the pack will state it, and the way a log needs it. */
  const failed = (index, round, what, err) => {
    notes[`zeko_${index}`] = 'The AI screening report could not be retrieved — '
      + 'please ask the recruiter for it.';
    degraded = true;
    logger.warn(
      `Dossier: could not fetch the Zeko ${what} for pipeline ${pipelineId}, round ${round.round} — ${err.message}`,
    );
  };

  for (const [index, round] of rounds.entries()) {
    if (!round.report_available) continue;
    if (!round.locator) {
      notes[`zeko_${index}`] = 'The stored screening report link is in an older format, '
        + 'so the report could not be retrieved.';
      degraded = true;
      continue;
    }
    const key = `${round.locator.candidateId}|${round.locator.jobId}`;

    if (includeReport) {
      try {
        if (!reportByLocator.has(key)) {
          reportByLocator.set(key, await withDeadline(
            getZekoReport({ ...round.locator, timeoutMs: options.timeoutMs }),
            deadline - Date.now(),
          ));
        }
        const detail = reportByLocator.get(key);
        // A report with no screening evaluation is not a failure — a coding or
        // panel round genuinely has nothing of this shape to render.
        if (detail) reports.push({ index, round: round.round, detail });
      } catch (err) {
        failed(index, round, 'report', err);
      }
    }

    if (includeShareLink) {
      try {
        if (!linkByLocator.has(key)) {
          linkByLocator.set(key, await withDeadline(
            generateZekoShareLink({ ...round.locator, timeoutMs: options.timeoutMs }),
            deadline - Date.now(),
          ));
        }
        links.push({ index, round: round.round, url: linkByLocator.get(key).url });
      } catch (err) {
        failed(index, round, 'share link', err);
      }
    }
  }

  return { reports, links, notes, degraded };
}

/**
 * Evalground / assessment section scores for a journey.
 *
 * section_label_map is the import's own record of what section_1..3 meant for
 * that test, so a pack generated a year later still reads "Logical Reasoning"
 * rather than "Section 2".
 */
async function fetchAssessments(pipelineId) {
  const rows = await prisma.rpa_assessment_results.findMany({
    where: { pipeline_id: BigInt(pipelineId) },
    include: { rpa_assessment_imports: { select: { file_name: true, uploaded_at: true } } },
    orderBy: { created_at: 'asc' },
  });

  return rows.map((r) => {
    const labels = (r.section_label_map && typeof r.section_label_map === 'object') ? r.section_label_map : {};
    const sections = [1, 2, 3]
      .map((n) => ({
        label: labels[`section_${n}`] || labels[String(n)] || `Section ${n}`,
        score: num(r[`section_${n}_score`]),
      }))
      .filter((s) => s.score !== null);

    return {
      test_name: r.test_name,
      taken_note: r.match_note || null,
      sections,
      overall_percentage: num(r.overall_percentage),
      overall_marks: num(r.overall_marks_scored),
      result: r.overall_result || null,
      imported_at: r.rpa_assessment_imports?.uploaded_at || r.created_at,
    };
  });
}

/**
 * Build the redacted dossier model for one journey.
 *
 * The return value is the ONLY thing the renderers see, and it has already been
 * through assertNoForbiddenFields() by the time it is handed back. A caller
 * therefore cannot accidentally render an unredacted model — there isn't one.
 *
 * @param {number|string} pipelineId
 * @param {{ includeContactDetails?: boolean, generatedBy?: object }} [options]
 * @returns {Promise<object>} the dossier model
 * @throws {AppError} 404 when the journey does not exist
 */
export async function buildDossierModel(pipelineId, options = {}) {
  const { includeContactDetails = true, generatedBy = null } = options;
  const id = BigInt(pipelineId);

  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id },
    include: {
      rpa_shortlisted_candidates: { include: { mrf: { select: MRF_SELECT } } },
      rpa_pipeline_stage_events: {
        orderBy: { created_at: 'asc' },
        include: {
          rpa_outcome_reasons: { select: { reason_label: true } },
          rpa_users: { select: { username: true } },
        },
      },
    },
  });
  if (!pipeline) throw new AppError('Candidate journey not found.', 404);

  const shortlist = pipeline.rpa_shortlisted_candidates;
  const mrf = shortlist?.mrf || null;
  const candidateEmail = shortlist?.candidate_email || null;

  // Everything else is scoped by pipeline_id and every one of these has an index
  // (idx_interview_schedule_pipeline, idx_interview_recording_pipeline,
  // idx_assessment_results_pipeline), so the fan-out is cheap enough to run in
  // parallel rather than sequentially.
  const [cv, stageRows, schedules, recordings, scorecardReport, assessments] = await Promise.all([
    pipeline.cv_id
      ? prisma.rpa_cv.findUnique({ where: { id: pipeline.cv_id }, select: CV_SELECT })
      : Promise.resolve(null),
    prisma.rpa_pipeline_stages.findMany({ select: { stage_key: true, label: true, sort_order: true } }),
    prisma.rpa_interview_schedule.findMany({
      where: { pipeline_id: id },
      orderBy: { scheduled_start_at: 'asc' },
    }),
    prisma.rpa_interview_recording.findMany({
      where: { pipeline_id: id, kind: 'recording' },
      orderBy: [{ recorded_start_at: 'asc' }, { id: 'asc' }],
    }),
    getCandidateScorecardReport(Number(pipelineId)),
    fetchAssessments(pipelineId),
  ]);

  const labelByKey = Object.fromEntries(stageRows.map((r) => [r.stage_key, r.label]));
  const stageLabel = (key) => labelByKey[key] || key;
  // `locator` holds the ids parsed out of Zeko's login-walled report URL and is
  // dropped here, at the boundary: from this line on there is no model carrying
  // a URL an outsider cannot open. collectZekoShareLinks() re-derives it.
  const zeko = (await fetchZekoRounds(pipeline, candidateEmail))
    .map(({ locator, ...round }) => round);

  const status = describeJourneyStatus(pipeline, stageLabel(pipeline.current_stage_key));

  // ---- Section 4: progress so far -----------------------------------------
  // Only the events that record a DECISION or a note a reader can act on. The
  // raw timeline also carries email-dispatch rows and system chatter, which
  // would bury the three lines an interviewer actually wants.
  const stages = pipeline.rpa_pipeline_stage_events
    .filter((e) => ['outcome', 'advance', 'closure', 'note'].includes(e.event_type))
    .map((e) => {
      // Commercial stages keep their ROW but lose their PROSE.
      //
      // Found by the leak scan against real staging data (2026-09-02): the
      // offer stage writes notes like "Offer recorded as shared — proposed
      // joining 2026-12-01", and 26 of 66 offer notes in staging carry a
      // joining date. §8.2 forbids the offer's joining date, and dropping the
      // rpa_offers RECORD does not stop the timeline narrating the same fact in
      // free text. No other stage had a single flagged note, so this is a
      // precise exclusion rather than a blanket one — the reader still sees
      // that the journey reached Offer and what the outcome was, which
      // decision #13 requires, without the terms.
      const commercial = COMMERCIAL_STAGE_KEYS.has(e.stage_key);
      return {
        stage_label: stageLabel(e.stage_key),
        event_type: e.event_type,
        outcome: e.outcome ? e.outcome.replace(/_/g, ' ') : null,
        reason: commercial ? null : (e.rpa_outcome_reasons?.reason_label || e.reason_text || null),
        notes: commercial ? null : (e.notes || null),
        decided_by: e.rpa_users?.username || null,
        decided_at: e.created_at,
      };
    });

  // ---- Section 6: per-round scorecards -------------------------------------
  // getCandidateScorecardReport() is reused rather than re-queried so there is
  // one scoring rule in one place. Its HR rounds carry hr_current_ctc and
  // hr_expected_ctc through HR_TEXT_FIELDS (interviewScorecard.service.js:430),
  // so its output is PROJECTED here, never spread. Naive reuse of that object is
  // precisely how CTC would reach an external interviewer.
  const scorecards = (scorecardReport?.rounds || []).map((r) => ({
    stage_label: r.stage_label,
    card_type: r.card_type,
    interviewer: r.recipient_email || null,
    interviewer_role: r.recipient_role || null,
    recommendation: r.recommendation || null,
    avg_score: r.avg_score ?? null,
    communication: r.communication ?? null,
    attitude: r.attitude ?? null,
    final_rating: r.final_rating ?? null,
    comments: r.comments || null,
    submitted_at: r.submitted_at,
    skills: (r.skills || []).map((s) => ({
      label: s.label || null,
      rating: s.rating ?? null,
      remark: s.remark || null,
    })),
    // The HR round's narrative fields, minus the two compensation ones. Listed
    // positively for the same reason as everything else in this file: a field
    // added to HR_TEXT_FIELDS later stays out of the pack until someone decides
    // it belongs there.
    ...(r.card_type === 'hr' && r.hr
      ? {
        hr_round: {
          strengths: r.hr.hr_strengths || null,
          weakness: r.hr.hr_weakness || null,
          communication_comments: r.hr.hr_communication_comments || null,
          attitude_comments: r.hr.hr_attitude_comments || null,
          relocation: r.hr.hr_relocation || null,
          notice_period: r.hr.hr_notice_period || null,
          other_observation: r.hr.hr_other_observation || null,
          final_feedback: r.hr.hr_final_feedback || null,
        },
      }
      : {}),
  }));

  // ---- Section 8: interview history ----------------------------------------
  const interviews = schedules.map((s) => ({
    stage_label: stageLabel(s.stage_key),
    interviewer: s.interviewer_name || s.interviewer_email || null,
    scheduled_start_at: s.scheduled_start_at,
    scheduled_end_at: s.scheduled_end_at,
    status: s.status,
    // 'held' / 'no_show' / null. Null means nobody has confirmed it either way,
    // which is a third state and must not be rendered as "did not happen".
    occurrence: s.occurrence_status || null,
    no_show_party: s.no_show_party || null,
    cancelled_at: s.cancelled_at,
  }));

  // ---- Section 9: recordings ----------------------------------------------
  // serializeRecording() is the browser-safe projection and is reused unchanged,
  // so graph_content_url and archive_item_id are excluded by construction here
  // exactly as they are in the API. Phase 1 carries no playable link at all.
  const recordingRows = recordings.map(serializeRecording).map((r) => ({
    stage_label: stageLabel(r.stage_key),
    recorded_start_at: r.recorded_start_at,
    duration_seconds: r.duration_seconds,
    available: r.playable,
  }));

  const model = {
    generated: {
      at: new Date(),
      by: generatedBy?.username || generatedBy?.email || 'the ATS',
      by_email: generatedBy?.email || null,
      pipeline_id: Number(pipelineId),
      phase_note: 'Phase 1',
    },
    candidate: {
      name: shortlist?.candidate_name || cv?.Name || 'Unnamed candidate',
      position: mrf?.position_hiring_for || shortlist?.position_applied || null,
      mrf_ref: mrf ? `MRF-${Number(mrf.id)}` : null,
    },
    status,
    profile: pickCvProfile(cv, { includeContactDetails }),
    contact_details_included: includeContactDetails,
    position: MRF_FIELDS
      .map(([field, label]) => ({ field, label, value: mrf ? (mrf[field] ?? null) : null })),
    stages,
    consolidated_feedback: scorecardReport?.consolidated_feedback?.summary || null,
    scorecard_overall: scorecardReport?.overall
      ? {
        rounds_scored: scorecardReport.overall.count,
        average: scorecardReport.overall.average,
        outstanding: scorecardReport.overall.outstanding,
      }
      : null,
    scorecards,
    // Rounds still owed a scorecard. Included on purpose: "no feedback yet" and
    // "feedback was withheld" are different things, and only one of them is true.
    scorecards_pending: (scorecardReport?.pending_rounds || []).map((p) => ({
      stage_label: p.stage_label,
      interviewer: p.recipient_email || null,
      sent_at: p.sent_at,
      expired: p.expired,
    })),
    zeko,
    assessments,
    interviews,
    recordings: recordingRows,
    redaction: redactionSummary({ includeContactDetails }),
    // Section 10: what is in attachments/ and what could not be fetched, AND
    // WHY. Phase 1 attaches no binaries, so this is where the pack stays honest
    // about it rather than silently omitting a resume the reader expected.
    manifest: buildManifest({ cvPresent: Boolean(cv), recordings: recordingRows, assessments, zeko }),
  };

  // The belt to the whitelist's braces. Runs before the model can reach any
  // renderer, so a regression fails here — loudly, in CI or in a 500 — rather
  // than quietly, in a file already sitting in a stranger's inbox.
  //
  // Always asserted outside production regardless of the flag, so a developer
  // cannot turn the guard off locally and ship a model that would have failed.
  if (config.dossier.assertRedaction || !config.isProduction) {
    assertNoForbiddenFields(model);
  }

  return model;
}

/**
 * The attachment index (plan §3.1 §10).
 *
 * Every line states what is NOT in the pack and what to do about it. A dossier
 * that simply omits the resume is indistinguishable from one that never had a
 * resume to omit, and the reader has no way to tell which — the same failure the
 * "No records" rule guards against elsewhere.
 */
function buildManifest({ cvPresent, recordings, assessments, zeko }) {
  const entries = [
    {
      item: 'Candidate report (HTML)',
      included: true,
      note: 'Opens in any browser. Press Ctrl+P to save it as a PDF.',
    },
    {
      item: 'Summary spreadsheet (Excel)',
      included: true,
      note: 'The same information as four sheets.',
    },
    {
      // Overwritten by applyAttachments() once the fetch has been attempted —
      // this is only the fallback for a pack built without that step.
      item: 'Resume',
      included: false,
      note: cvPresent
        ? 'Not attached to this download — please ask the recruiter for it.'
        : 'No resume is on file for this candidate in the ATS.',
    },
    {
      item: 'Assessment report (Evalground)',
      included: false,
      note: assessments.length
        ? 'Section scores are included in this report. The original PDF report is not yet '
          + 'stored in the ATS — ask the recruiter if you need it.'
        : 'No assessment result has been recorded for this candidate.',
    },
    {
      // Overwritten by applyZekoShareLinks() once the share link has been
      // attempted — this is the fallback for a pack built without that step,
      // and for the preview, which deliberately mints no links.
      item: 'AI screening report (Zeko)',
      included: false,
      note: zeko.some((z) => z.report_available)
        ? 'Scores are included in this report. The full screening report is held on the '
          + 'screening platform — ask the recruiter if you need it.'
        : 'No screening report is available for this candidate.',
    },
    {
      item: 'Interview recordings',
      included: false,
      note: recordings.length
        ? `${recordings.length} recording(s) exist for this candidate. They are not included in `
          + 'this pack — please ask the recruiter if you need to watch one.'
        : 'No interview recordings exist for this candidate.',
    },
  ];
  return entries;
}

/** A filename fragment that is safe on any operating system. */
const slugFor = (s) => String(s || '')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';

/**
 * What the PACK says when a file could not be fetched.
 *
 * This string is read by someone outside the company, so it says what happened
 * and what to do — never why in technical terms. An HTTP status, a Graph error
 * code, a drive id or a request id would all be meaningless to the reader and
 * are exactly the sort of internal detail that should not leave the building.
 * The real cause is logged server-side, where whoever can act on it will look.
 *
 * @param {Error & {status?: number}} err
 * @returns {string}
 */
function attachmentFailureNote(err) {
  const ask = 'Please ask the recruiter to send it separately.';
  // Size messages are written by us and are genuinely useful to the reader.
  if (/attachment limit/i.test(err.message)) return `${err.message} ${ask}`;
  if (err.status === 404) return `The stored file could not be found. ${ask}`;
  if (err.status === 403 || err.status === 401) {
    return `The ATS was not permitted to read this file. ${ask}`;
  }
  if (err.name === 'TimeoutError' || /abort|timeout/i.test(err.message)) {
    return `The file took too long to retrieve. ${ask}`;
  }
  return `The file could not be retrieved from storage. ${ask}`;
}

/**
 * Fetch the files that travel INSIDE the pack.
 *
 * DEGRADE, NEVER FAIL. Every fetch here crosses the network to Microsoft Graph,
 * and any of them can 403, 404 or hang. None of that may fail the download: a
 * dossier without the resume is still the thing Sanghamitra asked for — the
 * scorecards, the scores, the stage history — and refusing to produce it because
 * one file was unreachable would be a worse outcome than a manifest line saying
 * "ask the recruiter". So every failure is caught, recorded against the item it
 * belongs to, and reported in the pack.
 *
 * BUDGETED. One dead file must not hang a recruiter's download, so there is a
 * per-file timeout AND an overall budget; once the budget is spent the remaining
 * files are skipped with an honest note rather than waited for.
 *
 * Reads its own locators rather than taking them off the model on purpose: the
 * model is the redacted thing that gets RENDERED, and putting an authenticated
 * SharePoint URL on it — even briefly, even unrendered — is exactly the kind of
 * accident the whitelist exists to prevent.
 *
 * @param {number|string} pipelineId
 * @param {{ includeResume?: boolean, includeDocuments?: boolean, candidateName?: string }} options
 * @returns {Promise<{files: Array<{name: string, buffer: Buffer}>, notes: object,
 *   failed: string[], degraded: boolean, documentCount: number, totalBytes: number}>}
 */
export async function collectAttachments(pipelineId, options = {}) {
  const { includeResume = true, includeDocuments = false, candidateName = '' } = options;
  const {
    maxAttachmentBytes, maxPackBytes, attachmentTimeoutMs, attachmentBudgetMs,
  } = config.dossier;

  const deadline = Date.now() + attachmentBudgetMs;
  const files = [];
  const notes = {};
  // Which notes describe a FAILURE, as opposed to an absence.
  //
  // Both kinds of note read similarly from here — "no resume is on file" and
  // "the file could not be read" are both a line in `notes` — but they mean
  // opposite things to the recruiter: one is a fact about the candidate, the
  // other is something that went wrong and might be worth retrying. Treating
  // the presence of a note as evidence of failure is what made the UI warn
  // "a file could not be attached" for candidates who simply never had a resume.
  const failed = new Set();
  let degraded = false;
  let documentCount = 0;
  let totalBytes = 0;
  const who = slugFor(candidateName);

  /** Shared fetch-and-record, so resume and documents degrade identically. */
  const fetchOne = async ({ key, itemId, webUrl, label, fileName, persist }) => {
    if (Date.now() > deadline) {
      notes[key] = 'Could not be attached in time — please ask the recruiter for it.';
      failed.add(key);
      degraded = true;
      return null;
    }
    if (!itemId && !webUrl) {
      // Absence, not failure: there is nothing stored to fetch.
      notes[key] = 'No stored file was found for this item.';
      return null;
    }
    // A row whose URL never reached OneDrive (the local-disk fallback path in
    // the uploaders) has nothing Graph can serve.
    if (!itemId && !/^https?:/i.test(String(webUrl))) {
      notes[key] = 'The file was never stored in OneDrive, so it cannot be attached.';
      failed.add(key);
      degraded = true;
      return null;
    }

    try {
      const got = await downloadDriveItem({
        itemId,
        webUrl,
        maxBytes: maxAttachmentBytes,
        timeoutMs: Math.max(1000, Math.min(attachmentTimeoutMs, deadline - Date.now())),
      });

      if (totalBytes + got.buffer.length > maxPackBytes) {
        notes[key] = 'Left out to keep the pack small enough to email — ask the recruiter for it.';
        failed.add(key);
        degraded = true;
        return null;
      }

      const ext = extensionFor({ name: got.name, url: fileName, contentType: got.contentType });
      const name = `attachments/${label}${ext}`;
      files.push({ name, buffer: got.buffer });
      totalBytes += got.buffer.length;

      // Lazy backfill: a legacy row cost us an extra round trip to resolve its
      // id, so write it back and never pay that again. Best-effort — a failed
      // backfill must not fail a download that has already succeeded.
      if (got.resolvedFromUrl && got.itemId && persist) {
        await persist(got.itemId).catch((err) => logger.warn(
          `Dossier: could not backfill the OneDrive item id for ${key} on pipeline ${pipelineId} — ${err.message}`,
        ));
      }
      return name;
    } catch (err) {
      notes[key] = attachmentFailureNote(err);
      failed.add(key);
      degraded = true;
      // The DETAIL goes to the log, never to the pack — see attachmentFailureNote.
      logger.warn(
        `Dossier attachment failed (${key}, pipeline ${pipelineId}): ${err.message} ${err.detail || ''}`.trim(),
      );
      return null;
    }
  };

  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    select: { id: true, cv_id: true },
  });

  // --- The resume ----------------------------------------------------------
  if (includeResume && pipeline?.cv_id) {
    const cv = await prisma.rpa_cv.findUnique({
      where: { id: pipeline.cv_id },
      select: { id: true, cvFileUrl: true, cv_file_item_id: true },
    });
    if (cv?.cvFileUrl || cv?.cv_file_item_id) {
      await fetchOne({
        key: 'resume',
        itemId: cv.cv_file_item_id,
        webUrl: cv.cvFileUrl,
        label: `01_Resume_${who}`,
        fileName: cv.cvFileUrl,
        persist: (id) => prisma.rpa_cv.update({ where: { id: cv.id }, data: { cv_file_item_id: id } }),
      });
    } else {
      notes.resume = 'No resume is on file for this candidate in the ATS.';
    }
  }

  // --- Candidate-submitted documents (decision #11: opt-in, and audited) ----
  if (includeDocuments) {
    const docs = await prisma.rpa_candidate_documents.findMany({
      where: { rpa_document_requests: { pipeline_id: BigInt(pipelineId) } },
      include: { rpa_document_checklist_items: { select: { label: true } } },
      orderBy: { id: 'asc' },
    });
    let n = 1;
    for (const doc of docs) {
      if (!doc.file_url && !doc.file_item_id) continue;
      const label = doc.rpa_document_checklist_items?.label || 'Document';
      const added = await fetchOne({
        key: `document_${doc.id}`,
        itemId: doc.file_item_id,
        webUrl: doc.file_url,
        label: `${String(++n).padStart(2, '0')}_${slugFor(label)}_${who}`,
        fileName: doc.original_name || doc.file_url,
        persist: (id) => prisma.rpa_candidate_documents.update({
          where: { id: doc.id }, data: { file_item_id: id },
        }),
      });
      if (added) documentCount += 1;
    }
    if (!docs.length) notes.documents = 'No documents have been collected from this candidate.';
  }

  return {
    files, notes, failed: [...failed], degraded, documentCount, totalBytes,
  };
}

/**
 * Record that a dossier left the building — twice, on purpose.
 *
 * This is bulk PII being handed, by design, to a person with no ATS account. The
 * audit is the ONLY control that survives the file: there is no expiry, no
 * recall and no way to see who it is forwarded to. So both surfaces are written:
 *
 *   - rpa_processing_log, the app's only actor-attributed audit table, matching
 *     the shape runExport.js uses for every CSV export.
 *   - a note on the journey's own stage timeline, where a recruiter opening the
 *     candidate actually sees it. That visibility is its own mild deterrent.
 *
 * The message names WHAT WAS INCLUDED, not merely that something was downloaded
 * (plan §8.4). "Someone ticked a box" is unanswerable months later; "contact
 * details and 2 recordings, by chhaya.k, on 14 Sep" is not.
 *
 * Best-effort on both writes — the same `.catch(() => {})` convention as
 * runExport.js — because a failed audit must not deny a recruiter a download
 * they are entitled to. The failure is logged loudly instead: a silent gap in an
 * audit trail is worse than a noisy one.
 *
 * @param {{ pipelineId: number|string, user: object, model: object, format: string,
 *           bytes: number, includedCategories: string[], stageKey?: string, url?: string }} args
 */
export async function logDossierDownload({
  pipelineId, user, model, format, bytes, includedCategories, stageKey, url,
}) {
  const who = user?.username || user?.email || `user ${user?.id ?? 'unknown'}`;
  const included = includedCategories.join(', ');

  await prisma.rpa_processing_log.create({
    data: {
      fileName: model?.candidate?.name ? `Dossier — ${model.candidate.name}` : null,
      source: 'DOSSIER_EXPORT',
      status: 'Success',
      logMessage: `dossier: pipeline ${pipelineId}; included=[${included}]; `
        + `redacted=[ctc, vendor, offer]; format=${format}; bytes=${bytes}`,
      actor_email: user?.email || null,
      actor_context: `${user?.role || 'unknown'} via ${String(url || '').split('?')[0]}`,
      createdAt: new Date(),
    },
  }).catch((err) => {
    logger.error(
      `AUDIT GAP: dossier for pipeline ${pipelineId} downloaded by ${who} was not written `
      + `to rpa_processing_log — ${err.message}`,
    );
  });

  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: BigInt(pipelineId),
      stage_key: stageKey,
      event_type: 'note',
      notes: `Candidate dossier downloaded by ${who} — including ${included}`,
      acted_by: user?.id || null,
    },
  }).catch((err) => {
    logger.error(
      `AUDIT GAP: dossier download by ${who} was not recorded on the timeline of `
      + `pipeline ${pipelineId} — ${err.message}`,
    );
  });
}

export default {
  buildDossierModel,
  collectAttachments,
  collectZekoExtras,
  applyAttachments,
  applyZekoExtras,
  describeJourneyStatus,
  describeIncludedCategories,
  logDossierDownload,
};
