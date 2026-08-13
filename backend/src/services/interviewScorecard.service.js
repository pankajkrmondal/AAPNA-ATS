/**
 * interviewScorecard.service.js — the interviewer scorecard for the human
 * interview rounds (Tech1..CEO), filled in via an emailed no-login link.
 *
 * Gate: a scorecard link is created + emailed ONLY once the interview is
 * confirmed to have happened (rpa_interview_schedule.occurrence_status='held').
 * markInterviewOccurrence() in interviewSchedule.service.js is what calls
 * dispatchScorecards() — never a raw end-time sweep. See
 * docs/phase3/INTERVIEWER-SCORECARD-PLAN.md.
 *
 * The token is a single-use DB row (rpa_interview_scorecard.token, uuid): it
 * opens the form once, expires after submit, and records who submitted + when.
 * Interviewers are free-text mailboxes, not ATS users, which is why the link
 * needs no login.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { resolveRecipients } from '../config/emailRecipients.js';
import { sendGraphEmail, compileTemplate } from './emailNotification.service.js';
import { wrapBrandedEmail } from './emailLayout.service.js';
import { parseInterviewerEmails } from './interviewSchedule.service.js';
import { STAGE_KEYS } from '../config/pipelineStages.js';
import { notify, NOTIFICATION_TYPES } from './notification.service.js';

/** Days a scorecard link stays valid after it is emailed. */
const TOKEN_TTL_DAYS = 7;

/**
 * rpa_interview_scorecard.status lifecycle.
 *
 * Note that PENDING → EXPIRED is applied LAZILY, in getScorecardByToken(), the
 * first time someone opens a stale link — there is no sweep job. So a card that
 * is never opened keeps status='pending' indefinitely, past token_expires_at.
 * Anything counting outstanding cards must therefore bound on token_expires_at
 * as well as status, or it will count dead links forever.
 */
export const SCORECARD_STATUS = Object.freeze({
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  EXPIRED: 'expired',
});

/** Human label for a stage, from the admin-editable rpa_pipeline_stages table. */
async function stageLabelFor(stageKey) {
  const row = await prisma.rpa_pipeline_stages.findUnique({ where: { stage_key: stageKey } });
  return row?.label || stageKey;
}

/** Which stages use the HR-specific card vs the shared technical card (Q18). */
const HR_STAGE_KEYS = new Set([STAGE_KEYS.HR_ROUND]);

/** Recipient role recorded per stage, used to pick the invite template + card. */
function roleForStage(stageKey) {
  if (stageKey === STAGE_KEYS.HR_ROUND) return 'hr';
  if (stageKey === STAGE_KEYS.CEO) return 'ceo';
  return 'interviewer';
}

const TEMPLATE_NAMES = Object.freeze({
  inviteInterviewer: 'Scorecard Invitation — Interviewer',
  inviteHrCeo: 'Scorecard Invitation — HR/CEO',
});

/** Loads an active template row by name, or null. */
async function getTemplate(name) {
  return prisma.rpa_email_templates.findFirst({ where: { name, is_active: true } });
}

/** Serializes a scorecard row for the API (BigInt -> Number, Decimal -> Number). */
function serializeCard(row) {
  if (!row) return null;
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    ...row,
    id: Number(row.id),
    schedule_id: Number(row.schedule_id),
    pipeline_id: Number(row.pipeline_id),
    communication: num(row.communication),
    attitude: num(row.attitude),
    final_rating: num(row.final_rating),
    avg_score: num(row.avg_score),
    rpa_interview_scorecard_skill: (row.rpa_interview_scorecard_skill || []).map((s) => ({
      ...s,
      id: Number(s.id),
      scorecard_id: Number(s.scorecard_id),
      rating: num(s.rating),
    })),
  };
}

/**
 * Builds the initial skill rows. Seeds ONE blank row: the interviewer types the
 * skill name themselves on the card (we intentionally do NOT pre-fill it from
 * the MRF mandatory_skills, which can be placeholder text like "Same as JD").
 * The schema still supports multiple rows for future N-skill cards.
 */
function initialSkillRows() {
  return [{ skill_label: '', rating: null, remark: null, sort_order: 0 }];
}

/**
 * Creates + emails the tokenized scorecard link to every interviewer on a
 * confirmed-held interview. Idempotent: guarded by
 * rpa_interview_schedule.scorecard_dispatched_at, so the manual button and the
 * occurrence sweep can both call it and the link is sent exactly once.
 *
 * @param {number|bigint} scheduleId
 * @param {object} params
 * @param {string} [params.trigger] - 'manual' | 'graph' | 'sweep' (audit only)
 * @param {number} [params.actedBy]
 * @returns {Promise<{dispatched: boolean, alreadySent?: boolean, count?: number}>}
 */
export async function dispatchScorecards(scheduleId, { trigger = 'manual', actedBy = null } = {}) {
  const schedule = await prisma.rpa_interview_schedule.findUnique({
    where: { id: BigInt(scheduleId) },
    include: { rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: { include: { mrf: true } } } } },
  });
  if (!schedule) throw new AppError('Interview booking not found.', 404);

  // Never dispatch for an interview that isn't confirmed held.
  if (schedule.occurrence_status !== 'held') {
    return { dispatched: false, alreadySent: false, reason: 'not_held' };
  }
  // Single-fire guard.
  if (schedule.scorecard_dispatched_at) {
    return { dispatched: false, alreadySent: true };
  }

  const pipeline = schedule.rpa_candidate_pipeline;
  const candidate = pipeline?.rpa_shortlisted_candidates;
  const mrf = candidate?.mrf;
  const stageKey = schedule.stage_key;
  const cardType = HR_STAGE_KEYS.has(stageKey) ? 'hr' : 'technical';
  const role = roleForStage(stageKey);
  const stageLabel = await stageLabelFor(stageKey);
  const position = mrf?.position_hiring_for || candidate?.position_applied || 'the role';

  const { emails } = parseInterviewerEmails(schedule.interviewer_email || '');
  if (emails.length === 0) {
    logger.warn(`Scorecard dispatch: schedule ${scheduleId} has no interviewer email — nothing to send.`);
    // Still stamp the guard so the sweep stops retrying a booking that can
    // never send (no recipient).
    await prisma.rpa_interview_schedule.update({
      where: { id: schedule.id },
      data: { scorecard_dispatched_at: new Date(), modified_at: new Date() },
    });
    return { dispatched: false, count: 0, reason: 'no_recipient' };
  }

  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const skillRows = initialSkillRows();

  // Create one scorecard (+ its seed skill row) per interviewer mailbox.
  const created = [];
  for (const email of emails) {
    const card = await prisma.rpa_interview_scorecard.create({
      data: {
        schedule_id: schedule.id,
        pipeline_id: schedule.pipeline_id,
        stage_key: stageKey,
        card_type: cardType,
        recipient_email: email,
        recipient_name: emails.length === 1 ? schedule.interviewer_name : null,
        recipient_role: role,
        token_expires_at: expiresAt,
        sent_at: new Date(),
        rpa_interview_scorecard_skill: { create: skillRows },
      },
    });
    created.push(card);
  }

  // Stamp the guard BEFORE emailing so a mail failure can't cause a re-dispatch
  // that duplicates the rows.
  await prisma.rpa_interview_schedule.update({
    where: { id: schedule.id },
    data: { scorecard_dispatched_at: new Date(), modified_at: new Date() },
  });

  // Compile + send each link.
  const tplName = role === 'interviewer' ? TEMPLATE_NAMES.inviteInterviewer : TEMPLATE_NAMES.inviteHrCeo;
  const tpl = await getTemplate(tplName);
  for (const card of created) {
    const link = `${config.cors.frontendUrl}/scorecard/${card.token}`;
    const tokens = {
      candidate_name: candidate?.candidate_name || 'the candidate',
      position,
      stage_label: stageLabel,
      interviewer_name: card.recipient_name || 'there',
      scorecard_link: link,
    };
    const compiled = tpl
      ? compileTemplate(tpl.subject, tpl.body_html, tokens)
      : {
          subject: `Please score your ${stageLabel} — ${candidate?.candidate_name || 'candidate'}`,
          html: `<p>Hi ${tokens.interviewer_name},</p>
                 <p>Please submit your feedback for the <strong>${stageLabel}</strong> interview with
                 <strong>${tokens.candidate_name}</strong> (${position}). No login is needed.</p>
                 <p><a href="${link}" style="background:#7a922e;color:#fff;padding:11px 22px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">Open scorecard</a></p>
                 <p>This link works once and expires on ${expiresAt.toDateString()}.</p>
                 <p>Best regards,<br/>AAPNA Recruitment Team</p>`,
        };

    const { to } = resolveRecipients('scorecardInvite', card.recipient_email);
    if (to) {
      try {
        // Header headline = the email's own subject (RT decision, 2026-07-25).
        const brandedHtml = wrapBrandedEmail(compiled.html, { title: compiled.subject });
        // OPERATOR_ADDRESSED: the scorecard goes to the panel mailbox the
        // booking was made against, so it is reached in every environment.
        await sendGraphEmail({ sender: config.microsoft.defaultSender, to, subject: compiled.subject, html: brandedHtml, allowRealRecipients: true });
      } catch (err) {
        logger.error(`Scorecard dispatch: email failed for schedule ${scheduleId} → ${card.recipient_email}: ${err.message}`);
      }
    }
  }

  // Audit trail on the journey.
  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: schedule.pipeline_id,
      stage_key: stageKey,
      event_type: 'note',
      notes: `Scorecard link sent to ${emails.join(', ')} (${trigger})`,
      acted_by: actedBy || null,
    },
  });

  // The card is now "awaiting feedback" — the single biggest stall point in the
  // whole flow (loophole L3), so it goes on the team's board immediately.
  await notify({
    type: NOTIFICATION_TYPES.INTERVIEW_AWAITING_FEEDBACK,
    title: `Awaiting interviewer feedback — ${stageLabel}`,
    description: `${candidate?.candidate_name || 'A candidate'} · link sent to ${emails.join(', ')}`,
    pipelineId: schedule.pipeline_id,
    meta: { stage_key: stageKey, recipients: emails.length },
  });

  logger.info(`Scorecard dispatched: schedule ${scheduleId} → ${created.length} recipient(s) (${trigger}).`);
  return { dispatched: true, count: created.length };
}

/**
 * Public read for the tokenized form. Returns the pre-filled read-only context
 * plus the occurrence state (so the page shows the "did it happen?" gate when
 * unresolved). Marks the token expired if past TTL; refuses an already-used one.
 *
 * @param {string} token - uuid
 * @returns {Promise<object>} view model for the scorecard page
 */
export async function getScorecardByToken(token) {
  const card = await prisma.rpa_interview_scorecard.findUnique({
    where: { token },
    include: {
      rpa_interview_scorecard_skill: { orderBy: { sort_order: 'asc' } },
      rpa_interview_schedule: true,
      rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: { include: { mrf: true } } } },
    },
  });
  if (!card) throw new AppError('This scorecard link is invalid.', 404);

  // Already submitted → closed.
  if (card.status === 'submitted') {
    return { state: 'submitted', card: serializeCard(card) };
  }
  // Expired by time → mark and close.
  if (card.status === 'expired' || new Date(card.token_expires_at) < new Date()) {
    if (card.status !== 'expired') {
      await prisma.rpa_interview_scorecard.update({ where: { id: card.id }, data: { status: 'expired', modified_at: new Date() } });
    }
    return { state: 'expired', card: serializeCard(card) };
  }

  // First open — stamp opened_at once.
  if (!card.opened_at) {
    await prisma.rpa_interview_scorecard.update({ where: { id: card.id }, data: { opened_at: new Date() } });
  }

  const schedule = card.rpa_interview_schedule;
  const candidate = card.rpa_candidate_pipeline?.rpa_shortlisted_candidates;
  const mrf = candidate?.mrf;
  const stageLabel = await stageLabelFor(card.stage_key);

  return {
    // The page shows the occurrence gate first when the interview isn't yet
    // confirmed held; a no_show link never reveals the form.
    state: schedule?.occurrence_status === 'no_show' ? 'no_show' : 'open',
    occurrence_status: schedule?.occurrence_status || null,
    card: serializeCard(card),
    context: {
      candidate_name: candidate?.candidate_name || null,
      candidate_email: candidate?.candidate_email || null,
      position: mrf?.position_hiring_for || candidate?.position_applied || null,
      stage_key: card.stage_key,
      stage_label: stageLabel,
      interviewer_name: card.recipient_name || schedule?.interviewer_name || null,
      card_type: card.card_type,
      scheduled_start_at: schedule?.scheduled_start_at || null,
    },
  };
}

/**
 * The HR round's own card fields, mirroring the HR Round sheet of
 * docs/Interview Evaluation Format V2.xlsx (the MS Forms process this replaces).
 * All free text; the numeric ratings it shares with the technical card
 * (communication / attitude / final_rating) are handled separately.
 */
const HR_TEXT_FIELDS = [
  'hr_family_background',
  'hr_general_other',
  'hr_timings',
  'hr_communication_comments',
  'hr_attitude_comments',
  'hr_relocation',
  'hr_notice_period',
  'hr_current_ctc',
  'hr_expected_ctc',
  'hr_strengths',
  'hr_weakness',
  'hr_only_negative',
  'hr_other_observation',
  'hr_final_feedback',
  'hr_next_step',
];

/**
 * Column widths for the HR fields that are NOT unbounded TEXT. Overflowing a
 * VARCHAR raises Postgres 22001 and fails the whole submit — and this form is a
 * public single-use link with no draft saved, so the interviewer would lose
 * everything they typed. Truncating is the kinder failure.
 */
const HR_FIELD_MAX = {
  hr_notice_period: 100,
  hr_current_ctc: 100,
  hr_expected_ctc: 100,
  hr_relocation: 100,
  hr_timings: 255,
};

/** Picks the HR card fields off a submit payload, trimmed + capped, empty -> null. */
function hrFieldsFrom(payload) {
  return Object.fromEntries(
    HR_TEXT_FIELDS.map((f) => {
      const max = HR_FIELD_MAX[f];
      const value = (payload[f] || '').trim();
      return [f, (max ? value.slice(0, max) : value) || null];
    })
  );
}

/** Clamps a rating to 0..5 in 0.5 steps; returns null for empty. */
function normalizeRating(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n) || n < 0 || n > 5) throw new AppError('Ratings must be between 0 and 5.', 400);
  return Math.round(n * 2) / 2;
}

/**
 * Public write for the tokenized form. Enforces single-use + not-expired,
 * persists the card + skill rows, computes avg_score, and records who/when.
 *
 * @param {string} token
 * @param {object} payload - { skills:[{label,rating,remark}], communication,
 *   attitude, final_rating, recommendation, comments, recording_url, hr_* }
 * @param {object} meta - { ip }
 */
export async function submitScorecardByToken(token, payload = {}, { ip = null } = {}) {
  const card = await prisma.rpa_interview_scorecard.findUnique({
    where: { token },
    include: { rpa_interview_schedule: true },
  });
  if (!card) throw new AppError('This scorecard link is invalid.', 404);
  if (card.status === 'submitted') throw new AppError('This scorecard has already been submitted.', 409);
  if (card.status === 'expired' || new Date(card.token_expires_at) < new Date()) {
    throw new AppError('This scorecard link has expired.', 410);
  }
  if (card.rpa_interview_schedule?.occurrence_status === 'no_show') {
    throw new AppError('This interview was marked as not held, so no scorecard can be submitted.', 409);
  }

  const rec = payload.recommendation ? String(payload.recommendation).toLowerCase() : null;
  if (rec && !['approve', 'hold', 'reject'].includes(rec)) {
    throw new AppError("recommendation must be 'approve', 'hold' or 'reject'.", 400);
  }

  const communication = normalizeRating(payload.communication);
  const attitude = normalizeRating(payload.attitude);
  const finalRating = normalizeRating(payload.final_rating);

  const skills = Array.isArray(payload.skills) ? payload.skills : [];
  const normSkills = skills
    .filter((s) => (s?.label || '').trim())
    .map((s, i) => ({ skill_label: String(s.label).trim().slice(0, 150), rating: normalizeRating(s.rating), remark: (s.remark || '').trim().slice(0, 255) || null, sort_order: i }));

  // avg_score = mean of all provided numeric ratings (skills + the three fixed).
  const nums = [...normSkills.map((s) => s.rating), communication, attitude, finalRating].filter((n) => n !== null);
  const avg = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;

  const updated = await prisma.$transaction(async (tx) => {
    // CLAIM the card before writing anything.
    //
    // The status check above is a read, and this is a public no-login page: a
    // double-click on a slow connection sends two submits that both pass it.
    // Both then wrote skill rows, both stamped the card, and both went on to
    // write an audit note and fan out a notification to every recruiter — so a
    // single interviewer's feedback arrived twice, with the later payload
    // silently overwriting the earlier.
    //
    // Flipping pending → submitted conditionally means exactly one caller can
    // win; the loser's whole transaction rolls back and it gets the same 409 a
    // sequential re-submit would have received.
    const claim = await tx.rpa_interview_scorecard.updateMany({
      where: { id: card.id, status: { not: 'submitted' } },
      data: { status: 'submitted', submitted_at: new Date(), submitted_ip: ip },
    });
    if (claim.count !== 1) {
      throw new AppError('This scorecard has already been submitted.', 409);
    }

    // Replace skill rows with the submitted set.
    await tx.rpa_interview_scorecard_skill.deleteMany({ where: { scorecard_id: card.id } });
    if (normSkills.length) {
      await tx.rpa_interview_scorecard_skill.createMany({
        data: normSkills.map((s) => ({ ...s, scorecard_id: card.id })),
      });
    }
    return tx.rpa_interview_scorecard.update({
      where: { id: card.id },
      data: {
        communication,
        attitude,
        final_rating: finalRating,
        recommendation: rec,
        comments: (payload.comments || '').trim() || null,
        recording_url: (payload.recording_url || '').trim() || null,
        ...hrFieldsFrom(payload),
        avg_score: avg,
        // status / submitted_at / submitted_ip were set by the claim above.
        modified_at: new Date(),
      },
      include: { rpa_interview_scorecard_skill: { orderBy: { sort_order: 'asc' } } },
    });
  });

  // Note it on the journey.
  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: card.pipeline_id,
      stage_key: card.stage_key,
      event_type: 'note',
      notes: `Scorecard submitted by ${card.recipient_email}${rec ? ` — recommends ${rec}` : ''}${avg !== null ? ` (avg ${avg})` : ''}`,
    },
  });

  // Notify the team: the round is unblocked and the recruiter can now set the
  // official outcome. This is the "HR notified on submission" the old MS Forms
  // + Power Automate flow did natively (03-DEVELOPMENT-PLAN.md §M3).
  const stageLabel = await stageLabelFor(card.stage_key);
  await notify({
    type: NOTIFICATION_TYPES.INTERVIEW_FEEDBACK_RECEIVED,
    title: `Feedback received — ${stageLabel}`,
    description: `${card.recipient_email}${rec ? ` recommends ${rec}` : ' submitted a scorecard'}${avg !== null ? ` · avg ${avg}/5` : ''} — ready for your decision`,
    pipelineId: card.pipeline_id,
    meta: { stage_key: card.stage_key, recommendation: rec, avg_score: avg },
  });

  logger.info(`Scorecard submitted: card ${card.id} (schedule ${card.schedule_id}) by ${card.recipient_email}.`);
  return serializeCard(updated);
}

/**
 * Per-candidate scorecard report: every SUBMITTED scorecard grouped by round,
 * plus an overall sum/average across the interview rounds (Tech1..CEO). Feeds
 * the drawer report panel and future analytics.
 *
 * @param {number} pipelineId
 */
export async function getCandidateScorecardReport(pipelineId) {
  const cards = await prisma.rpa_interview_scorecard.findMany({
    where: { pipeline_id: BigInt(pipelineId), status: 'submitted' },
    include: { rpa_interview_scorecard_skill: { orderBy: { sort_order: 'asc' } } },
    orderBy: [{ stage_key: 'asc' }, { submitted_at: 'asc' }],
  });

  // One lookup of all stage labels rather than per-row.
  const stageRows = await prisma.rpa_pipeline_stages.findMany({ select: { stage_key: true, label: true } });
  const labelByKey = Object.fromEntries(stageRows.map((r) => [r.stage_key, r.label]));

  const rounds = cards.map((c) => {
    const s = serializeCard(c);
    return {
      scorecard_id: s.id,
      stage_key: s.stage_key,
      stage_label: labelByKey[s.stage_key] || s.stage_key,
      card_type: s.card_type,
      recipient_email: s.recipient_email,
      recipient_role: s.recipient_role,
      recommendation: s.recommendation,
      avg_score: s.avg_score,
      communication: s.communication,
      attitude: s.attitude,
      final_rating: s.final_rating,
      comments: s.comments,
      recording_url: s.recording_url,
      submitted_at: s.submitted_at,
      skills: s.rpa_interview_scorecard_skill.map((sk) => ({ label: sk.skill_label, rating: sk.rating, remark: sk.remark })),
      // The HR round captures a whole different field set; only attach it there
      // so technical rounds don't carry 15 null keys.
      ...(s.card_type === 'hr' ? { hr: Object.fromEntries(HR_TEXT_FIELDS.map((f) => [f, s[f]])) } : {}),
    };
  });

  const scored = rounds.map((r) => r.avg_score).filter((n) => n !== null && n !== undefined);
  const sum = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  const average = scored.length ? Math.round((sum / scored.length) * 100) / 100 : null;

  return {
    pipeline_id: Number(pipelineId),
    rounds,
    overall: { count: scored.length, sum, average },
    consolidated_feedback: buildConsolidatedFeedback(rounds, { average }),
  };
}

/**
 * The consolidated feedback block: every interviewer's verdict on one candidate,
 * as a single readable passage.
 *
 * Whoever makes the final call — the CEO round, or HR writing the offer — has
 * until now had to open each round's card in turn and hold the picture in their
 * head. The data was all there; nothing assembled it. That assembly is the whole
 * feature, so it lives here next to the report it summarises rather than being
 * rebuilt in the drawer, the email templates and anywhere else that needs it.
 *
 * Returns null when nothing has been submitted yet — an empty summary is worse
 * than none, because it reads as "no concerns raised".
 *
 * @param {Array<object>} rounds - the serialized rounds above
 * @param {{average: number|null}} overall
 * @returns {{summary: string, lines: Array<object>, recommendation_counts: object}|null}
 */
function buildConsolidatedFeedback(rounds, { average }) {
  if (!rounds.length) return null;

  // Count the explicit recommendations, so "3 of 4 interviewers said hire" can
  // be stated rather than inferred from prose.
  const recommendationCounts = {};
  for (const r of rounds) {
    if (!r.recommendation) continue;
    recommendationCounts[r.recommendation] = (recommendationCounts[r.recommendation] || 0) + 1;
  }

  const lines = rounds.map((r) => {
    // Strongest signals first: what they concluded, then how they scored it,
    // then what they actually wrote.
    const parts = [];
    if (r.recommendation) parts.push(`Recommendation: ${r.recommendation}`);
    if (r.avg_score !== null && r.avg_score !== undefined) parts.push(`Score: ${r.avg_score}`);
    if (r.final_rating !== null && r.final_rating !== undefined) parts.push(`Overall rating: ${r.final_rating}`);

    const weakSkills = (r.skills || [])
      .filter((s) => s.rating !== null && s.rating !== undefined && s.rating <= 2)
      .map((s) => s.skill_label || s.label)
      .filter(Boolean);

    return {
      stage_key: r.stage_key,
      stage_label: r.stage_label,
      interviewer: r.recipient_email,
      role: r.recipient_role,
      recommendation: r.recommendation || null,
      avg_score: r.avg_score ?? null,
      comments: (r.comments || '').trim() || null,
      // Surfaced separately because a low skill rating is the thing a later
      // interviewer most wants to probe, and it is easy to miss inside a card.
      concerns: weakSkills,
      headline: `${r.stage_label} — ${parts.join(' · ') || 'submitted, no ratings given'}`,
      submitted_at: r.submitted_at,
    };
  });

  const verdict = Object.entries(recommendationCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n}× ${k}`)
    .join(', ');

  const summaryParts = [
    `${rounds.length} interview${rounds.length === 1 ? '' : 's'} scored`,
    average !== null ? `average ${average}` : null,
    verdict || null,
  ].filter(Boolean);

  return {
    summary: summaryParts.join(' · '),
    lines,
    recommendation_counts: recommendationCounts,
  };
}
