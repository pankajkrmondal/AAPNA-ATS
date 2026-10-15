/**
 * JD screening rules (Phase 3 "Do Now", N07–N09).
 *
 * WHY THIS EXISTS
 * ---------------
 * The old JD search scored every candidate in the database on eight averaged
 * dimensions, so a profile without a single mandatory skill could still rate
 * "strong", and a fresher passed an experience "filter" that was only a
 * maximum. RT's rule (29 Sep) is a gate, then a ranking:
 *
 *   1. The candidate must have ALL mandatory skills (whole words, aliases).
 *   2. Then education, budget and the experience band. An empty value for any
 *      applied gate EXCLUDES the candidate.
 *   3. Only the passers are ranked, by JD_RANK_WEIGHTS. The score orders; it
 *      never removes anyone.
 *
 * This module holds the parts of that rule that need no database: reading the
 * MRF (mandatory skills text, experience band, budget, qualification), the
 * education gate in SQL and its JS mirror, and the ranking score. Pure
 * functions only, so every rule is unit tested (tests/unit/jdScreeningRules.test.js).
 */
import { Prisma } from '@prisma/client';
import { splitSkillPhrases, termVariants } from './screeningFilters.js';

// ---------------------------------------------------------------------------
// Mandatory skills
// ---------------------------------------------------------------------------

const SAME_AS_JD = /^same\s+as\s+jd$/i;

/** parsed_jd_json arrives as an object, a JSON string, or not at all. */
export function parseJdJson(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** A skills value that may be a list, a JSON-array string, or plain text. */
function skillsText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
  const s = String(v).trim();
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return skillsText(arr);
    } catch {
      // Not JSON after all — use the text as written.
    }
  }
  return s;
}

/**
 * The mandatory-skills text this MRF actually means. The form offers
 * "Same as JD" (use the skills parsed from the JD at upload) and "Other"
 * (free text in mandatory_skills_other); a blank field also falls back to the
 * parsed JD, as the old search did.
 *
 * @param {{mandatory_skills?: string|null, mandatory_skills_other?: string|null, parsed_jd_json?: unknown}} mrf
 * @returns {{text: string, source: 'mrf'|'mrf_other'|'jd'|null}}
 */
export function resolveMandatoryText(mrf = {}) {
  const raw = skillsText(mrf.mandatory_skills);
  if (/^other$/i.test(raw)) {
    const other = skillsText(mrf.mandatory_skills_other);
    return { text: other, source: other ? 'mrf_other' : null };
  }
  if (raw && !SAME_AS_JD.test(raw)) return { text: raw, source: 'mrf' };
  const jd = skillsText(parseJdJson(mrf.parsed_jd_json)?.mandatory_skills);
  return { text: jd, source: jd ? 'jd' : null };
}

/** Slash terms that are one skill, not two ("CI/CD" is not "CI" and "CD"). */
const PROTECTED_SLASH = ['ci/cd', 'pl/sql', 'tcp/ip', 'ui/ux', 'a/b testing', 'i/o'];
const SLASH_MARK = '\u0001';

/** Lead-ins that describe a skill rather than name it. Applied repeatedly. */
const LEADING_FILLERS = [
  /^(?:must|should)\s+(?:have|know|be)\s+(?:(?:good|strong|working)\s+)?/i,
  /^(?:(?:very|strong|good|solid|excellent|deep|sound|basic|working|proven|practical|in[- ]depth|thorough|hands[- ]on|prior|relevant)\s+)*(?:knowledge|experience|expertise|proficiency|understanding|familiarity|exposure|command|skills?)\s+(?:of|in|with|on|using)\s+/i,
  /^(?:proficient|experienced|expert|skilled|well[- ]versed|strong)\s+(?:in|with|at|on)\s+/i,
  /^(?:familiar|comfortable|conversant)\s+with\s+/i,
  /^hands[- ]on\s+(?:with|in|on)\s+/i,
  /^(?:good|strong|working|basic)\s+/i,
];

/** Trailing words that describe the skill ("React experience", "SQL skills"). */
const TRAILING_FILLERS = /\s+(?:experience|skills?|knowledge|expertise|proficiency|concepts|fundamentals)$/i;

/** Not technical skills: cannot be found reliably in a resume, so not enforced. */
const SOFT_SKILL = /\b(?:communication|team\s*player|team\s*work|teamwork|problem[- ]solving|analytical|interpersonal|attitude|leadership|self[- ]motivated|quick\s+learner|presentation|time\s+management|written|verbal|english|go[- ]getter|ownership)\b/i;
const YEARS = /\b\d+(?:\.\d+)?\s*\+?\s*(?:years?|yrs?)\b/i;
/** "3+ years of hands-on experience in Java" → "Java". */
const YEARS_LEAD_IN = /^\d+(?:\.\d+)?\s*\+?\s*(?:years?|yrs?)\.?\s*(?:of\s+)?(?:(?:hands[- ]on|relevant|professional|working|strong)\s+)*(?:experience\b\s*)?(?:(?:in|with|on|using)\b)?\s*/i;
const MAX_WORDS = 4;

const normalise = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * MRF-side spellings that name a skill under another form. Applied to the
 * MRF's mandatory skills only, never to candidate text: an MRF listing "NET"
 * means .NET (e.g. "NET, DOT NET, C#"), but treating every "net" in a resume
 * as .NET would match "net salary". Without this, bare "NET" was its own
 * required skill that no profile ever had, so such an MRF matched nobody
 * (review 15 Oct 2026).
 */
const MRF_SKILL_FIXES = {
  net: { term: '.net', label: '.NET' },
};

/**
 * Turns an MRF's mandatory-skills text into the skills a candidate must have.
 *
 * Splits on commas / semicolons / new lines / slashes (splitSkillPhrases) and
 * also on "and" / "&" (both sides are required). Drops parenthetical asides
 * ("Python (Django/Flask)" → "Python"), strips lead-ins ("Strong knowledge of
 * Java" → "Java"), and IGNORES — visibly, never silently — phrases that are
 * not checkable skills: soft skills, years of experience, "X or Y"
 * alternatives, and sentences longer than four words. Aliases collapse (".NET"
 * and "dotnet" are one skill).
 *
 * @param {string} text
 * @returns {{skills: string[], labels: string[], ignored: Array<{text: string, reason: string}>}}
 *   skills: normalised terms for matching; labels: the same skills as written, for display.
 */
export function parseMandatorySkills(text) {
  const out = { skills: [], labels: [], ignored: [] };
  if (!text || !String(text).trim()) return out;

  let s = String(text)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[•·|]/g, ',');
  for (const term of PROTECTED_SLASH) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    s = s.replace(re, (m) => m.replace('/', SLASH_MARK));
  }

  const seen = new Set();
  const phrases = splitSkillPhrases(s).flatMap((p) => p.split(/\s+(?:and|&)\s+/i));
  for (const rawPhrase of phrases) {
    let p = rawPhrase.replaceAll(SLASH_MARK, '/').replace(/^(?:[-*]\s*|\d+[.)]\s+)+/, '').replace(/[.:]+$/, '').trim();
    if (!p) continue;
    const original = p;

    if (SOFT_SKILL.test(p)) {
      out.ignored.push({ text: original, reason: 'soft skill' });
      continue;
    }
    p = p.replace(YEARS_LEAD_IN, '').trim();
    if (!p || YEARS.test(p)) {
      out.ignored.push({ text: original, reason: 'years of experience (the experience band covers this)' });
      continue;
    }

    let prev;
    do {
      prev = p;
      for (const re of LEADING_FILLERS) p = p.replace(re, '');
      p = p.replace(TRAILING_FILLERS, '').trim();
    } while (p !== prev && p);
    if (!p) {
      out.ignored.push({ text: original, reason: 'no skill named' });
      continue;
    }
    if (/\s+or\s+/i.test(p)) {
      out.ignored.push({ text: original, reason: 'either/or alternatives cannot be required' });
      continue;
    }
    if (p.split(/\s+/).length > MAX_WORDS) {
      out.ignored.push({ text: original, reason: 'a sentence, not a skill name' });
      continue;
    }

    const fix = MRF_SKILL_FIXES[normalise(p)];
    const term = fix ? fix.term : normalise(p);
    const key = termVariants(term).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.skills.push(term);
    out.labels.push(fix ? fix.label : p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Experience band, budget, qualification
// ---------------------------------------------------------------------------

/** Non-negative number from 3, "3", "3+", "3 years"; null otherwise. */
function years(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The experience band a candidate must fall in, inclusive. From the parsed JD
 * when it gives a min or max; otherwise the MRF's total years as a minimum
 * with no ceiling. No tolerance (RT can revisit in N11).
 *
 * @param {unknown} parsedJd - rpa_mrf.parsed_jd_json
 * @param {number|null} mrfYears - rpa_mrf.total_years_of_experience
 * @returns {{min: number, max: number|null, source: 'jd'|'mrf'|'none'}}
 */
export function experienceBand(parsedJd, mrfYears) {
  const jd = parseJdJson(parsedJd);
  const jdMin = years(jd?.min_experience_years);
  const jdMax = years(jd?.max_experience_years);
  const mrf = years(mrfYears);
  if (jdMin != null || jdMax != null) {
    const min = jdMin ?? mrf ?? 0;
    if (jdMax == null || min <= jdMax) return { min, max: jdMax, source: 'jd' };
  }
  return { min: mrf ?? 0, max: null, source: mrf != null ? 'mrf' : 'none' };
}

/** Budget in LPA. Stored as LPA or as rupees (> 1000 means rupees), as the old search read it. */
export function normaliseBudget(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n > 1000 ? n / 100000 : n) * 100) / 100;
}

/** Display names for the education requirement. */
export const QUALIFICATION_LABELS = {
  TECH_GRADUATE: 'BE/BTech or MCA (any branch)',
  POST_GRADUATE: 'Post-graduate (any stream)',
  GRADUATE: 'Graduate (any degree)',
};

/**
 * The MRF form's "Desired Qualification" → the education gate.
 *   "BE/BTech, MCA, Any" → TECH_GRADUATE (BE/BTech or MCA, any branch)
 *   "PG, Any"            → POST_GRADUATE (any PG degree)
 *   "Graduate"           → GRADUATE (any degree)
 *   "Other" / blank      → null: no gate (free text cannot be checked)
 * "Any" means any stream, not any degree (decided 14 Oct).
 *
 * @param {string|null} desired
 * @returns {'TECH_GRADUATE'|'POST_GRADUATE'|'GRADUATE'|null}
 */
export function mapQualification(desired) {
  const d = String(desired ?? '').toLowerCase();
  if (/b\.?\s?tech|\bb\.?e\b|\bmca\b/.test(d)) return 'TECH_GRADUATE';
  if (/\bpg\b|post[- ]?grad/.test(d)) return 'POST_GRADUATE';
  if (/graduate/.test(d)) return 'GRADUATE';
  return null;
}

// Degree keywords, compared upper-cased with everything but A–Z removed
// ("B.Tech" → "BTECH"). TECH is the same list matchesQualification uses.
const TECH_KEYS = ['BTECH', 'BE', 'BACHELOROFENGINEERING', 'BACHELOROFTECHNOLOGY', 'ENGINEERINGGRADUATE', 'ENGG', 'MCA'];
const PG_KEYS = ['MTECH', 'MSC', 'MCA', 'MBA', 'MCOM', 'PGDM', 'MASTER', 'POSTGRAD'];
/** Placeholder values that mean "no degree recorded". */
const EMPTY_DEGREE = ['', 'NULL', 'NA', 'NONE', 'NIL'];

const degreeKey = (d) => String(d ?? '').toUpperCase().replace(/[^A-Z]/g, '');
const hasDegree = (d) => !EMPTY_DEGREE.includes(degreeKey(d));
const degreeHas = (d, keys) => hasDegree(d) && keys.some((k) => degreeKey(d).includes(k));

/**
 * JS mirror of educationGateSql: does the candidate meet the requirement?
 * Reads graduationdegree and postgraduationdegree; both empty → fails.
 *
 * @param {{graduationdegree?: string|null, postgraduationdegree?: string|null}} c
 * @param {'TECH_GRADUATE'|'POST_GRADUATE'|'GRADUATE'|null} req
 * @returns {boolean}
 */
export function jdEducationPass(c, req) {
  if (!req) return true;
  const g = c.graduationdegree;
  const pg = c.postgraduationdegree;
  if (req === 'TECH_GRADUATE') return degreeHas(g, TECH_KEYS) || degreeHas(pg, TECH_KEYS);
  if (req === 'POST_GRADUATE') return hasDegree(pg) || degreeHas(g, PG_KEYS);
  return hasDegree(g) || hasDegree(pg);
}

/**
 * The education gate as SQL, the same rule as jdEducationPass. null when the
 * MRF has no checkable requirement.
 *
 * @param {'TECH_GRADUATE'|'POST_GRADUATE'|'GRADUATE'|null} req
 * @param {string} [alias='c']
 * @returns {Prisma.Sql|null}
 */
export function educationGateSql(req, alias = 'c') {
  if (!req) return null;
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Invalid SQL alias: ${alias}`);
  const key = (col) => Prisma.sql`regexp_replace(upper(coalesce(${Prisma.raw(`${alias}.${col}`)}, '')), '[^A-Z]', '', 'g')`;
  const has = (col) => Prisma.sql`NOT (${key(col)} = ANY(${EMPTY_DEGREE}::text[]))`;
  const like = (col, keys) => Prisma.sql`(${has(col)} AND ${key(col)} LIKE ANY(${keys.map((k) => `%${k}%`)}::text[]))`;
  if (req === 'TECH_GRADUATE') {
    return Prisma.sql`(${like('graduationdegree', TECH_KEYS)} OR ${like('postgraduationdegree', TECH_KEYS)})`;
  }
  if (req === 'POST_GRADUATE') {
    return Prisma.sql`(${has('postgraduationdegree')} OR ${like('graduationdegree', PG_KEYS)})`;
  }
  return Prisma.sql`(${has('graduationdegree')} OR ${has('postgraduationdegree')})`;
}

// ---------------------------------------------------------------------------
// Ranking (N09)
// ---------------------------------------------------------------------------

/**
 * How much each part counts in the JD ranking. One place, so Scoring weights &
 * recency (L01) can re-tune them; finalise with RT during N11.
 */
export const JD_RANK_WEIGHTS = { coverage: 0.6, expFit: 0.2, ctcHeadroom: 0.1, notice: 0.1 };

/** Coverage credit by where a mandatory skill was found. */
export const JD_COVERAGE_WEIGHT = { declared: 1, resume: 0.7 };

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const round1 = (n) => Math.round(n * 10) / 10;
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Mandatory coverage, 0–1: declared skill 1, found only in resume keywords / text 0.7. */
export function coverageOf(perTerm) {
  if (!perTerm || perTerm.length === 0) return 0;
  const sum = perTerm.reduce((acc, p) => acc + (p.inSkills ? JD_COVERAGE_WEIGHT.declared : p.matched ? JD_COVERAGE_WEIGHT.resume : 0), 0);
  return sum / perTerm.length;
}

/**
 * Where the experience sits in the band, 0.5–1. Closed band: 1 at the middle,
 * 0.5 at either edge. Open band [min, ∞): 1 up to min + 2 years, easing to 0.5
 * at min + 6 and beyond.
 */
export function experienceFit(exp, band) {
  if (exp == null || !band) return 0.5;
  if (band.max != null) {
    if (band.max === band.min) return 1;
    const mid = (band.min + band.max) / 2;
    const half = (band.max - band.min) / 2;
    return Math.max(0.5, 1 - (0.5 * Math.abs(exp - mid)) / half);
  }
  const over = exp - band.min;
  if (over <= 2) return 1;
  if (over >= 6) return 0.5;
  return 1 - (0.5 * (over - 2)) / 4;
}

/** Share of the budget left over, 0–1. No budget → 0.5 for everyone (no reordering). */
export function ctcHeadroom(ctc, budgetMax) {
  if (budgetMax == null) return 0.5;
  if (ctc == null) return 0;
  return clamp01((budgetMax - ctc) / budgetMax);
}

/** Notice period, 0–1: the same steps as scoreAvailability. Unknown ranks as 60+ days. */
export function noticeScore(days) {
  if (days == null) return 0.2;
  if (days <= 15) return 1;
  if (days <= 30) return 0.8;
  if (days <= 45) return 0.6;
  if (days <= 60) return 0.4;
  return 0.2;
}

const fmtYears = (n) => `${Math.round(n * 10) / 10}`;
const bandText = (band) => (band.max != null
  ? `${fmtYears(band.min)}–${fmtYears(band.max)} yrs`
  : `${fmtYears(band.min)}+ yrs`);

/**
 * The JD ranking score for one candidate who passed every gate. Ordering only.
 *
 * Breakdown keys reuse the old JD names (jdMatching, totalExperience,
 * ctcAlignment, availability) so the drawer's criteria lines and the CSV's
 * score columns fill in without a format change.
 *
 * @param {object} p
 * @param {Array<{term: string, inSkills: boolean, matched: boolean, source: string|null}>} p.perTerm
 * @param {{min: number, max: number|null, source: string}} p.band
 * @param {number|null} p.budgetMax - LPA, null when the MRF has none
 * @param {object} p.candidate - rpa_cv row
 * @returns {{finalScore: number, parts: Record<string, number>, breakdown: object}}
 */
export function jdRankScore({ perTerm, band, budgetMax, candidate: c }) {
  const exp = num(c.TotalExperienceYearsNumeric);
  const ctc = num(c.ExpectedCTCNumeric);
  const days = num(c.NoticePeriodDays);

  const parts = {
    coverage: coverageOf(perTerm),
    expFit: experienceFit(exp, band),
    ctcHeadroom: ctcHeadroom(ctc, budgetMax),
    notice: noticeScore(days),
  };
  const w = JD_RANK_WEIGHTS;
  const finalScore = Math.round(10 * (w.coverage * parts.coverage + w.expFit * parts.expFit
    + w.ctcHeadroom * parts.ctcHeadroom + w.notice * parts.notice) * 100) / 100;

  const where = (p) => (p.inSkills ? 'declared skill' : p.source === 'terms' ? 'resume keyword' : 'resume text');
  const breakdown = {
    jdMatching: {
      score: round1(parts.coverage * 10),
      label: 'Mandatory Skill Coverage',
      weight: w.coverage,
      reason: `Has all ${perTerm.length} mandatory skill(s): ${perTerm.map((p) => `${p.term} (${where(p)})`).join(', ')}. Declared skills count fully, resume-only mentions count 70%.`,
    },
    totalExperience: {
      score: round1(parts.expFit * 10),
      label: 'Experience Fit',
      weight: w.expFit,
      reason: `${exp == null ? 'Unknown' : `${fmtYears(exp)} yrs`} within the ${bandText(band)} band${band.source === 'jd' ? ' (from the JD)' : ' (MRF minimum)'}; the middle of the band scores highest.`,
    },
    ctcAlignment: {
      score: round1(parts.ctcHeadroom * 10),
      label: 'CTC Headroom',
      weight: w.ctcHeadroom,
      reason: budgetMax == null
        ? 'No budget on this MRF, so CTC does not affect the order.'
        : `Expects ₹${ctc} LPA against a ₹${budgetMax} LPA budget; more headroom scores higher.`,
    },
    availability: {
      score: round1(parts.notice * 10),
      label: 'Notice Period',
      weight: w.notice,
      reason: days == null ? 'Notice period not recorded; ranked as 60+ days.' : `${days} days notice; shorter scores higher.`,
    },
  };
  return { finalScore, parts, breakdown };
}

export default {
  parseJdJson,
  resolveMandatoryText,
  parseMandatorySkills,
  experienceBand,
  normaliseBudget,
  mapQualification,
  QUALIFICATION_LABELS,
  jdEducationPass,
  educationGateSql,
  JD_RANK_WEIGHTS,
  JD_COVERAGE_WEIGHT,
  coverageOf,
  experienceFit,
  ctcHeadroom,
  noticeScore,
  jdRankScore,
};
