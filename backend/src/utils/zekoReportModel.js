/**
 * zekoReportModel.js — Zeko's screening report, rendered INTO the dossier
 * instead of linked out to.
 *
 * WHY THIS EXISTS. The obvious way to give an external interviewer the AI
 * screening report is Zeko's own share link, and the dossier can carry one
 * (plan §6.6). But that link opens a page composed by Zeko, and a check in a
 * no-session browser (2026-09-03) found it showing the candidate's current and
 * expected CTC, the salary band the role is being hired against ("within the
 * 0–7 LPA preference range"), the full transcript with audio and the interview
 * video. Three of those four are things §8 strips from the pack itself, and the
 * §10.3 leak scan cannot see any of them — it greps the pack, and the pack is
 * clean; the exposure is on the page the link points at.
 *
 * We already fetch that report as JSON on every score sync. So this takes the
 * same payload and produces the part an interviewer actually needs — the fit
 * verdict, the parameter-by-parameter assessment, strengths, concerns,
 * recommendation, soft skills — with compensation removed, under our redaction,
 * inside a file that works offline and cannot be revoked out from under the
 * reader.
 *
 * TWO GUARDS, NOT ONE. Parameters are dropped by NAME ("Current CTC") and again
 * by VALUE (any text mentioning CTC/LPA/salary). The names come from Zeko's
 * workflow config — a recruiter can rename "Expected CTC" to "Package
 * expectation" in their console tomorrow — so a name list alone would leak the
 * day someone did. Same construction as dossierRedaction.js: the list catches
 * today's fields, the pattern catches tomorrow's.
 *
 * WHAT IS DELIBERATELY LEFT OUT ENTIRELY, rather than filtered:
 *   - `interview_questions` — the verbatim transcript, plus per-question S3
 *     audio links. It is where the compensation exchange lives word for word,
 *     and the links are media URLs we do not control. Available through the
 *     opt-in share link for the rare reader who needs it.
 *   - `evidence` on every soft-skill rating — a direct quotation of the
 *     candidate, i.e. a transcript in miniature, and the field where
 *     "My current CD is 5 LPA and I am expecting 7 LPA" actually turned up.
 *   - `proctoringData` / `cheatingProbability` — an AI-generated suspicion
 *     about a real person. If it goes to an outsider it should be a conscious
 *     decision by HR, not a side effect of this file.
 *   - `reportLink`, `screenRecording`, `userId`, `email`, `phone`, `location` —
 *     vendor URLs and contact/identity data the pack governs elsewhere.
 *
 * Pure: no Prisma, no config, no network — so the redaction rules here are
 * unit-testable with no database, the same constraint dossierRedaction.js
 * documents and for the same reason. The fetching is getZekoReport() in
 * zeko.service.js.
 *
 * Plan: docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §6.7.
 */

/**
 * Parameter names that are commercial on their face.
 *
 * Matched loosely (substring, case-insensitive) because these are free text in
 * Zeko's workflow console, not an enum: "Current CTC", "CTC (current)" and
 * "Expected ctc" are all the same parameter wearing different clothes.
 */
const COMMERCIAL_PARAMETER_PATTERN = /\b(ctc|salary|compensation|package|remuneration|stipend|pay)\b/i;

/**
 * Compensation showing up in free text, whatever the field is called.
 *
 * `lpa` and the bare-number forms are here because that is how compensation is
 * actually written in these payloads — "5 LPA", "0–8.5 LPA preference range" —
 * and a guard that only looked for the word "salary" would have passed both of
 * the strings that made this whole section necessary.
 */
const COMPENSATION_TEXT_PATTERN = /\b(ctc|lpa|lakhs? per annum|salary|salaries|compensation|remuneration|stipend|in-hand|take[- ]home)\b/i;

/**
 * True when a piece of text discusses money.
 *
 * Deliberately over-eager. A dropped bullet costs the reader one line of
 * assessment prose and says so in the section's own note; a missed one puts a
 * candidate's salary — or our hiring band — in a stranger's inbox permanently.
 * The asymmetry is the entire argument.
 *
 * @param {*} text
 * @returns {boolean}
 */
export function mentionsCompensation(text) {
  if (text === null || text === undefined) return false;
  return COMPENSATION_TEXT_PATTERN.test(String(text));
}

/**
 * True when a screening parameter is commercial, by its name or by its content.
 *
 * @param {{parameter?: string, answer?: string, reasoning?: string}} param
 * @returns {boolean}
 */
export function isCommercialParameter(param = {}) {
  if (COMMERCIAL_PARAMETER_PATTERN.test(String(param.parameter || ''))) return true;
  return mentionsCompensation(param.answer) || mentionsCompensation(param.reasoning);
}

/**
 * Zeko writes its narrative fields as one string of "- " bullets. Split them
 * back out so the renderers get a list rather than a paragraph with hyphens in
 * it, and drop any bullet that discusses money.
 *
 * @param {string|null|undefined} text
 * @returns {{ kept: string[], dropped: number }}
 */
export function splitBullets(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean);

  const kept = lines.filter((l) => !mentionsCompensation(l));
  return { kept, dropped: lines.length - kept.length };
}

/** Title Case for a snake_cased skill key: `clarity_of_thought` → `Clarity of thought`. */
const humanise = (key) => String(key || '')
  .replace(/_/g, ' ')
  .replace(/^\w/, (c) => c.toUpperCase());

/**
 * Flatten Zeko's two nested soft-skill trees into one list of ratings.
 *
 * A SKIPPED SKILL IS NOT A WEAK SKILL. Zeko marks a skill it had no chance to
 * observe as `status: "skipped"` — and then still stamps
 * `overall_rating: "weak"` on it. Copying that number through would tell an
 * interviewer that a real candidate reasons weakly when what actually happened
 * is that the AI never asked them anything requiring it (four of nine skills on
 * the staging report). So `assessed` is carried explicitly and the rating is
 * dropped for anything not evaluated, exactly as the pack refuses to print an
 * unconfirmed interview as "did not happen".
 *
 * `dimensions` is discarded wholesale: every entry in it carries an `evidence`
 * field quoting the candidate verbatim, which is a transcript in miniature —
 * see this file's header. Only Zeko's own overall summary survives, and it still
 * passes the compensation guard, because that summary quotes the candidate too
 * ("Candidate communicated salary and notice period information fluently").
 *
 * @param {object|null} softSkills - report.softSkillsEvaluation
 * @returns {{ skills: Array<{area: string, rating: string|null, assessed: boolean, comment: string|null}>, dropped: number }}
 */
export function flattenSoftSkills(softSkills) {
  const skills = [];
  let dropped = 0;

  const groups = [
    ['Cognitive', softSkills?.cognitiveSkillsAnalysis?.evaluation?.candidate_evaluation],
    ['Interpersonal', softSkills?.interpersonalSkillsAnalysis?.evaluation?.candidate_evaluation],
  ];

  for (const [group, evaluation] of groups) {
    if (!evaluation || typeof evaluation !== 'object') continue;
    for (const [key, value] of Object.entries(evaluation)) {
      if (!value || typeof value !== 'object') continue;

      const assessed = value.status !== 'skipped'
        && Object.keys(value.dimensions || {}).length > 0;
      const comment = assessed
        ? (value.overall_summary || null)
        : (value.skip_reason || value.overall_summary || null);

      if (mentionsCompensation(comment)) {
        dropped += 1;
        continue;
      }

      skills.push({
        area: `${group} — ${humanise(key)}`,
        assessed,
        rating: assessed ? (value.overall_rating || null) : null,
        comment,
      });
    }
  }
  return { skills, dropped };
}

/**
 * Build the renderable, redacted screening section from a Zeko report payload.
 *
 * COUNTS ARE REPORTED BEFORE REDACTION, on purpose. Zeko assessed 14 parameters
 * and the candidate met 13; if two are withheld here, the section still says
 * "13 of 14 met" and separately notes that 2 were withheld. Recomputing the
 * ratio over what survived would quietly restate the vendor's own assessment —
 * an interviewer comparing this against a Zeko screenshot would find two
 * different numbers for the same interview, and believe the wrong one.
 *
 * @param {object|null} report - the interview-report payload (`data.data`)
 * @returns {object|null} null when there is no screening evaluation to render
 */
export function buildZekoReportSection(report) {
  const evaluation = report?.hr_screening_evaluation;
  if (!evaluation) return null;

  const rawParams = Array.isArray(evaluation.parameter_fits) ? evaluation.parameter_fits : [];
  const kept = rawParams.filter((p) => !isCommercialParameter(p));

  const summary = splitBullets(evaluation.remarks);
  const strengths = splitBullets(report.strength);
  const concerns = splitBullets(report.weakness);
  const recommendation = splitBullets(report.recommendation);
  const improvements = splitBullets(report.improvement);
  const soft = flattenSoftSkills(report.softSkillsEvaluation);

  const withheld = (rawParams.length - kept.length)
    + summary.dropped + strengths.dropped + concerns.dropped
    + recommendation.dropped + improvements.dropped + soft.dropped;

  return {
    round_name: report.role || null,
    verdict: evaluation.fit || null,
    fit_percentage: evaluation.fit_percentage ?? null,
    // The vendor's own assessment, unaltered — see the note above.
    parameters_total: rawParams.length,
    parameters_met: rawParams.filter((p) => p.fit).length,
    red_flag_count: evaluation.red_flags?.count ?? null,
    red_flags: (evaluation.red_flags?.details || [])
      .map((d) => (typeof d === 'string' ? d : d?.detail || d?.reason || null))
      .filter((d) => d && !mentionsCompensation(d)),
    summary: summary.kept,
    parameters: kept.map((p) => ({
      name: p.parameter || null,
      met: Boolean(p.fit),
      required: Boolean(p.is_must),
      answer: p.answer || null,
      remark: p.reasoning || null,
    })),
    strengths: strengths.kept,
    concerns: concerns.kept,
    recommendation: recommendation.kept,
    improvements: improvements.kept,
    soft_skills: soft.skills,
    // Stated in the pack, not silently applied. A reader comparing this against
    // Zeko's own screen must be able to tell that something was removed on
    // purpose rather than conclude the ATS renders reports badly.
    withheld_count: withheld,
  };
}

export default {
  buildZekoReportSection,
  flattenSoftSkills,
  isCommercialParameter,
  mentionsCompensation,
  splitBullets,
};
