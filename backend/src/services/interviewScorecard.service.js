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

/** Days a scorecard link stays valid after it is emailed. */
const TOKEN_TTL_DAYS = 7;

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
        await sendGraphEmail({ sender: config.microsoft.defaultSender, to, subject: compiled.subject, html: brandedHtml });
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
        hr_notice_period: (payload.hr_notice_period || '').trim() || null,
        hr_current_ctc: (payload.hr_current_ctc || '').trim() || null,
        hr_expected_ctc: (payload.hr_expected_ctc || '').trim() || null,
        hr_relocation: (payload.hr_relocation || '').trim() || null,
        hr_strengths: (payload.hr_strengths || '').trim() || null,
        avg_score: avg,
        status: 'submitted',
        submitted_at: new Date(),
        submitted_ip: ip,
        modified_at: new Date(),
      },
      include: { rpa_interview_scorecard_skill: { orderBy: { sort_order: 'asc' } } },
    });
  });

  // Note it on the journey; HR is informed via the existing outcome flow.
  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: card.pipeline_id,
      stage_key: card.stage_key,
      event_type: 'note',
      notes: `Scorecard submitted by ${card.recipient_email}${rec ? ` — recommends ${rec}` : ''}${avg !== null ? ` (avg ${avg})` : ''}`,
    },
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
      recipient_email: s.recipient_email,
      recipient_role: s.recipient_role,
      recommendation: s.recommendation,
      avg_score: s.avg_score,
      communication: s.communication,
      attitude: s.attitude,
      final_rating: s.final_rating,
      comments: s.comments,
      submitted_at: s.submitted_at,
      skills: s.rpa_interview_scorecard_skill.map((sk) => ({ label: sk.skill_label, rating: sk.rating, remark: sk.remark })),
    };
  });

  const scored = rounds.map((r) => r.avg_score).filter((n) => n !== null && n !== undefined);
  const sum = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  const average = scored.length ? Math.round((sum / scored.length) * 100) / 100 : null;

  return { pipeline_id: Number(pipelineId), rounds, overall: { count: scored.length, sum, average } };
}
