/**
 * Candidate Screening — strict filtering (Phase 3 "Do Now", section A).
 *
 * WHY A SEPARATE MODULE
 * ---------------------
 * screening.service.js's searchKeywordCandidates / searchRoleCandidates are
 * left untouched on purpose: the before/after check (N11) runs the old and the
 * new search side by side on the same data, and RT signs off on that
 * comparison before production switches over. The controller and the CSV
 * export choose between them with config.screening.v2 (SCREENING_V2).
 *
 * Imports flow one way only — this module imports helpers from the old
 * service, never the reverse.
 *
 * THE RULES (RT, 29 Sep)
 * ----------------------
 * Filters decide WHO appears; the score only decides the ORDER. Every applied
 * filter is a hard filter and an empty value for it excludes the candidate
 * (see utils/screeningFilters.js). Nothing that passes is hidden by a low
 * score, and an AI failure never fails the search.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { roleCacheKeyV2, isCacheableRecency } from '../utils/screeningCacheKeys.js';
import redis from '../config/redis.js';
import AppError from '../utils/AppError.js';
import { emailMatchesSql } from '../utils/emailMatch.js';
import { getCooldownCutoff } from '../utils/rejectionCooldown.js';
import { generateEmbedding } from './vectorStore.service.js';
import {
  parseScreeningFilters,
  detectLookup,
  buildFilterConditions,
  joinConditions,
  buildPassCountSql,
  removedByFromPassCounts,
  passesStrictFilters,
  skillColumnPredicates,
  skillPredicateSql,
  wholeWordMatch,
} from '../utils/screeningFilters.js';
import {
  resolveMandatoryText,
  parseMandatorySkills,
  experienceBand,
  normaliseBudget,
  mapQualification,
  QUALIFICATION_LABELS,
  jdEducationPass,
  educationGateSql,
  jdRankScore,
} from '../utils/jdScreeningRules.js';
import {
  attachStageHistory,
  generateProfileInsights,
  getRejectionCooldownExcludedCvIds,
  mapStars,
  parseMaxTenureYears,
  parseTechnicalTerms,
  resolveProfile,
  scoreJobStability,
} from './screening.service.js';

// ---------------------------------------------------------------------------
// Shared SQL
// ---------------------------------------------------------------------------

/** Everything a result card, the drawer and the CSV export read. */
const CARD_COLUMNS = Prisma.raw(`
  c.id, c."Name", c."NoticePeriod", c."NoticePeriodDays", c."ContactNumber", c."EmailID", c."HighestQualification",
  c."TotalExperienceYears", c."TotalExperienceYearsNumeric", c."LastCompanyExperienceYears", c."CurrentLocation",
  c."CTC_LPA", c."ExpectedCTC_LPA", c."ExpectedCTCNumeric", c."JobSource", c."RecruiterInfoAAPNA", c."PositionApplied",
  c."Top5KeySkills", c."CurrentCompany", c."Gender", c."EnglishCommunicationRating", c."PreferredShift",
  c."ReasonForJobChange", c."WillingToTakeOnlineTest", c."HasLaptopForInitialDays", c."EducationalScoresPercentage",
  c."LinkedInProfile", c."MetaData", c."statusActive", c."missingData", c."cvMissingToken", c."cvMissingTokenStatus",
  c."createdAt", c."modifiedAt", c."vendorName", c."lockForNinetyDays", c."VendorEmail", c."a10th", c."a12th",
  c."graduation", c."postGraduation", c."Heat", c."HRQuickcomments", c."IQScore", c."TechScore", c."FinalStatus",
  c."TechRoundOne", c."TechRoundTwo", c."ManagerialOrCEOFeedback", c."HRInterview", c."ZekoInterviewScore",
  c."ZekoCodingScore", c."ZekoCommunicationScore", c."TechRoundThree", c.graduationdegree, c.graduationspecialization,
  c.postgraduationdegree, c.postgraduationspecialization, c.employment_history, c."cvVectorLock", c."cvFileUrl",
  c.ai_profile_insights, c.resume_technical_terms, c.is_referral`);

/**
 * Most recent shortlist / reject stamp per candidate: any MRF for the keyword
 * search, this MRF only for the JD search (as the old JD search did). "Not
 * rejected" rather than "= shortlisted" for the same reason as the old service:
 * closure writes terminal values (hired / withdrawn …) into pipeline_status.
 *
 * @param {number|null} [mrfId]
 */
function provenanceJoins(mrfId = null) {
  const scope = mrfId == null ? Prisma.empty : Prisma.sql` AND rsc.mrf_id = ${BigInt(mrfId)}`;
  return Prisma.sql`
  LEFT JOIN LATERAL (
      SELECT rsc.shortlisted_by, rsc.shortlisted_at
      FROM public.rpa_shortlisted_candidates rsc
      WHERE rsc.cv_id = c.id AND rsc.pipeline_status <> 'rejected'${scope}
      ORDER BY rsc.shortlisted_at DESC NULLS LAST, rsc.id DESC
      LIMIT 1
  ) sl ON true
  LEFT JOIN LATERAL (
      SELECT rsc.shortlisted_by AS rejected_by, rsc.shortlisted_at AS rejected_at
      FROM public.rpa_shortlisted_candidates rsc
      WHERE rsc.cv_id = c.id AND rsc.pipeline_status = 'rejected'${scope}
      ORDER BY rsc.shortlisted_at DESC NULLS LAST, rsc.id DESC
      LIMIT 1
  ) rj ON true`;
}

const PROVENANCE_COLUMNS = Prisma.raw('sl.shortlisted_by, sl.shortlisted_at, rj.rejected_by, rj.rejected_at');

/** Labels for the removed-by summary, in funnel order. */
const REMOVED_LABELS = {
  recentlyRejected: 'recently rejected',
  location: 'location',
  gender: 'gender',
  experience: 'experience',
  ctc: 'expected CTC',
  notice: 'notice period',
  addedWithin: 'added date',
  position: 'position applied',
  skills: 'skills',
  education: 'education',
};

/** Rows from $queryRaw carry BigInt ids; the API speaks numbers. */
const toPublic = (c) => {
  const { resume_full_text: _omit, distance: _d, ...rest } = c;
  for (const k of Object.keys(rest)) if (k.startsWith('ev_')) delete rest[k];
  return { ...rest, id: Number(c.id) };
};

const round1 = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// N02 — exact lookup
// ---------------------------------------------------------------------------

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

/**
 * Finds the one person a recruiter is looking for by email, phone or name.
 * Skips skills search, embeddings, AI and ranking entirely. Other filters are
 * NOT applied: the recruiter already knows who they want. The rejection
 * cooldown is not applied either — rejectionCooldown.js: "a recruiter who
 * knows the candidate by name can still act on them".
 *
 * @param {{type: 'email'|'phone'|'name', value: string|null}} lookup
 */
async function runLookup(lookup) {
  const t0 = Date.now();
  if (lookup.type === 'phone' && !lookup.value) {
    throw new AppError('Enter a full 10-digit phone number to look a candidate up by phone.', 400);
  }

  const query = (where, limit = 50) => prisma.$queryRaw`
    SELECT ${CARD_COLUMNS}, ${PROVENANCE_COLUMNS}
    FROM public.rpa_cv c
    ${provenanceJoins()}
    WHERE ${where}
    ORDER BY c."createdAt" DESC NULLS LAST, c.id DESC
    LIMIT ${limit}`;

  let rows;
  let matchKind = 'exact';
  if (lookup.type === 'email') {
    rows = await query(emailMatchesSql(Prisma.sql`c."EmailID"`, lookup.value));
  } else if (lookup.type === 'phone') {
    // '[^0-9]' rather than '\D': a backslash would be swallowed by the template
    // literal before Postgres saw it (same note as emailMatch.js).
    rows = await query(Prisma.sql`EXISTS (
      SELECT 1 FROM regexp_split_to_table(coalesce(c."ContactNumber", ''), '[,;/]') AS ph(part)
      WHERE right(regexp_replace(ph.part, '[^0-9]', '', 'g'), 10) = ${lookup.value}
    )`);
  } else {
    const nameSql = Prisma.sql`lower(btrim(regexp_replace(coalesce(c."Name", ''), '[[:space:]]+', ' ', 'g')))`;
    rows = await query(Prisma.sql`${nameSql} = ${lookup.value}`);
    if (rows.length === 0) {
      matchKind = 'prefix';
      rows = await query(Prisma.sql`${nameSql} LIKE ${`${escapeLike(lookup.value)}%`}`);
    }
  }

  const candidates = rows.map((c) => ({
    ...toPublic(c),
    shortlisted_status: c.FinalStatus === 'Stage 0 - Resume Shortlisted' ? c.FinalStatus : null,
    profile: resolveProfile(null, c),
    relevanceScore: null,
  }));

  const what = { email: 'email', phone: 'phone', name: 'name' }[lookup.type];
  const summaryText = matchKind === 'exact'
    ? `${candidates.length} exact match${candidates.length === 1 ? '' : 'es'} (${what} lookup)`
    : `${candidates.length} name${candidates.length === 1 ? '' : 's'} starting with "${lookup.value}" (no exact match)`;

  logger.info(`[screening:v2] lookup ${lookup.type} → ${candidates.length} rows in ${Date.now() - t0}ms`);
  return {
    candidates: await attachStageHistory(candidates),
    summary: {
      mode: 'lookup',
      lookupType: lookup.type,
      matchKind,
      total: candidates.length,
      shown: candidates.length,
      high: 0,
      medium: 0,
      low: 0,
      summaryText,
      degraded: false,
      degradedReason: null,
    },
  };
}

// ---------------------------------------------------------------------------
// N04 / N05 — skill evidence and the ordering score
// ---------------------------------------------------------------------------

/** How much a skill counts, by where it was found. */
const EVIDENCE_WEIGHT = { declared: 1, terms: 0.85, resume: 0.7 };

/**
 * Where each searched skill is evidenced on this candidate. The three flags
 * per term (ev_<i>_s / _t / _r) are computed by the database with the same
 * whole-word predicate that filtered the row, so the card can never disagree
 * with the filter — and the resume body never has to leave the database.
 */
function skillEvidence(terms, c, prefix = 'ev_') {
  const techTerms = parseTechnicalTerms(c.resume_technical_terms);

  let weight = 0;
  let declaredCount = 0;
  let totalFreq = 0;
  const perTerm = terms.map((term, i) => {
    const inSkills = c[`${prefix}${i}_s`] === true;
    const inTerms = c[`${prefix}${i}_t`] === true;
    const inResumeText = c[`${prefix}${i}_r`] === true;
    // Frequency only: the small technical-terms JSON is matched in JS.
    const tech = inTerms ? techTerms.find((t) => wholeWordMatch(t.term, term)) : null;
    const source = inSkills ? 'declared' : inTerms ? 'terms' : inResumeText ? 'resume' : null;
    if (source) weight += EVIDENCE_WEIGHT[source];
    if (inSkills) declaredCount++;
    totalFreq += tech ? tech.count || 1 : 0;
    return { term, inSkills, inTerms, inResumeText, count: tech ? tech.count || 1 : 0, source, matched: Boolean(source) };
  });

  return {
    perTerm,
    matchedCount: perTerm.filter((p) => p.matched).length,
    total: terms.length,
    skillPts: terms.length ? round1((10 * weight) / terms.length) : null,
    // Tiebreak among equal scores: declared skills first, then term frequency.
    evidence: declaredCount * 1e6 + totalFreq,
  };
}

/**
 * SELECT-list fragments for the evidence flags of `terms`: `flagSelect` goes in
 * the filtering CTE `m`, `flagOut` in the outer query. Column names are
 * <prefix><i>_s / _t / _r (declared skills / technical terms / resume text).
 *
 * @param {string[]} terms
 * @param {string} [prefix='ev_'] - must start with "ev_" so toPublic strips it
 */
function evidenceFlagSql(terms, prefix = 'ev_') {
  const select = [];
  const out = [];
  terms.forEach((term, i) => {
    const p = skillColumnPredicates(term, 'c');
    if (!p) return;
    for (const [suffix, sql] of [['s', p.declared], ['t', p.terms], ['r', p.resume]]) {
      select.push(Prisma.sql`${sql} AS ${Prisma.raw(`${prefix}${i}_${suffix}`)}`);
      out.push(`m.${prefix}${i}_${suffix}`);
    }
  });
  return { select, out };
}

/** Joins flag fragments into the leading-comma form the queries splice in. */
const flagList = (sqls) => (sqls.length ? Prisma.sql`, ${Prisma.join(sqls, ', ')}` : Prisma.empty);
const flagNames = (names) => (names.length ? Prisma.sql`, ${Prisma.raw(names.join(', '))}` : Prisma.empty);

/**
 * Display shape the card's "Searched Skills" meter reads (same shape as the
 * old buildJdSkillSignals), built from the strict matcher.
 */
function strictSkillSignals(ev, goodEv = null) {
  const classify = (p) => {
    const inSignals = p.inTerms || p.inResumeText;
    const inSkillsSection = p.inSkills;
    const status = inSignals && inSkillsSection ? 'evidenced'
      : inSignals ? 'signals_only'
      : inSkillsSection ? 'listed_only'
      : 'missing';
    return { skill: p.term, count: p.count, inSignals, inSkillsSection, inResumeText: p.inResumeText, status };
  };
  return { mandatory: ev.perTerm.map(classify), goodToHave: goodEv ? goodEv.perTerm.map(classify) : [] };
}

/**
 * Keyword score: skill coverage weighted by evidence, plus job stability.
 * Only orders results — never decides who is shown.
 */
function keywordScore(ev, c) {
  const exp = Number(c.TotalExperienceYearsNumeric ?? c.TotalExperienceYears) || 0;
  const maxTenure = parseMaxTenureYears(c.employment_history);
  const stability = maxTenure > 0 ? scoreJobStability(maxTenure, exp) : null;

  const breakdown = {};
  let avg;
  if (ev) {
    breakdown.skillMatch = {
      pts: ev.skillPts,
      max: 10,
      label: 'Skill Match',
      reason: `Matched ${ev.matchedCount}/${ev.total} searched skill(s): ${ev.perTerm
        .map((p) => `${p.term} (${p.source === 'declared' ? 'declared skill' : p.source === 'terms' ? 'resume keyword' : p.source === 'resume' ? 'resume text' : 'not found'})`)
        .join(', ')}`,
      matched: ev.matchedCount,
      totalTerms: ev.total,
      weight: stability != null ? 0.8 : 1,
    };
    avg = stability != null ? 0.8 * ev.skillPts + 0.2 * stability : ev.skillPts;
  } else {
    // Filter-only search: nothing to cover, stability alone orders the list.
    avg = stability ?? 5;
  }
  if (stability != null) {
    breakdown.jobStability = { pts: stability, max: 10, label: 'Job Stability', weight: ev ? 0.2 : 1 };
  }

  const avgScore = round1(avg);
  const { stars, label } = mapStars(avgScore);
  return {
    scorePct: Math.round(avgScore * 10),
    stars,
    label,
    avgScore,
    filtersApplied: Object.keys(breakdown).length,
    breakdown,
    mode: 'keyword',
    evidence: ev ? ev.evidence : 0,
  };
}

// ---------------------------------------------------------------------------
// Keyword search (N02–N05)
// ---------------------------------------------------------------------------

/**
 * POST /api/screening/keyword-search with SCREENING_V2 on.
 *
 * @param {object} body - raw request body (see parseScreeningFilters)
 * @returns {Promise<{candidates: object[], summary: object}>}
 */
export async function searchKeywordCandidatesV2(body) {
  const t0 = Date.now();
  const f = parseScreeningFilters(body);

  const lookup = detectLookup(f);
  if (lookup) return runLookup(lookup);

  // With nothing applied the "result" is the whole database (~99k rows, every
  // JSON column) — slow for the server and useless to a recruiter.
  const anyFilter = f.skills.length || f.position.length || f.education.length || f.location.length
    || f.gender || [f.expMin, f.expMax, f.ctcMin, f.ctcMax, f.noticePeriod, f.addedWithinDays].some((v) => v != null);
  if (!anyFilter) {
    throw new AppError('Enter at least one filter (skills, name, email, phone, location, experience …) to search.', 400);
  }

  // Rejection cooldown first in the funnel, so "removed by" accounts for it.
  const excludedIds = [...(await getRejectionCooldownExcludedCvIds())];
  const conditions = buildFilterConditions(f, 'c');
  if (excludedIds.length > 0) {
    conditions.unshift({
      key: 'recentlyRejected',
      sql: Prisma.sql`COALESCE((c.id <> ALL(${excludedIds}::bigint[])), false)`,
    });
  }
  // Two steps. `m` applies every filter (cheap ones first, short-circuiting —
  // see joinConditions) and, for the rows that pass, records per skill WHERE it
  // was found (declared / technical terms / resume text) as true/false flags.
  // SELECT expressions only run on rows that passed WHERE, so the flags cost
  // nothing on the rest. MATERIALIZED stops the planner inlining `m` and
  // re-running the regexes. The outer query fetches card columns for the
  // passing rows only — the resume body never leaves the database.
  const flags = evidenceFlagSql(f.skills);
  const flagSelect = flagList(flags.select);
  const flagOut = flagNames(flags.out);

  // Semantic distance is only a last tiebreak; if embedding fails the search
  // still runs, just without it.
  let vectorStr = null;
  if (f.skills.length > 0) {
    try {
      const embedding = await generateEmbedding(f.keyword);
      vectorStr = `[${embedding.join(',')}]`;
    } catch (err) {
      logger.warn(`[screening:v2] keyword embedding skipped: ${err.message}`);
    }
  }
  const distanceSql = vectorStr
    ? Prisma.sql`(SELECT MIN(v.embedding <=> ${vectorStr}::vector) FROM public.rpa_cv_vectors v WHERE v.candidate_id = c.id)`
    : Prisma.sql`NULL::float8`;

  // Counts for every step but the last; the main query's row count is the last.
  const countConditions = conditions.slice(0, -1);
  const tSql0 = Date.now();
  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw`
      WITH m AS MATERIALIZED (
        SELECT c.id${flagSelect}
        FROM public.rpa_cv c
        WHERE ${joinConditions(conditions)}
      )
      SELECT ${CARD_COLUMNS}, ${PROVENANCE_COLUMNS}, ${distanceSql} AS distance${flagOut}
      FROM m
      JOIN public.rpa_cv c ON c.id = m.id
      ${provenanceJoins()}`,
    prisma.$queryRaw`SELECT ${buildPassCountSql(countConditions)} FROM public.rpa_cv c`,
  ]);
  const tSql = Date.now() - tSql0;

  const keys = conditions.map((c) => c.key);
  const removedBy = removedByFromPassCounts(keys, countRows[0] || { total: 0 }, rows.length);

  // JS second check: education (no SQL form) plus a defensive mirror of the
  // cheap SQL filters. Skills were decided by the database on
  // the resume text, which is deliberately not fetched.
  const jsFilters = { ...f, skills: [] };
  const passing = [];
  for (const c of rows) {
    const check = passesStrictFilters(c, jsFilters);
    if (check.pass) {
      passing.push(c);
    } else {
      if (check.failedOn !== 'education') {
        logger.warn(`[screening:v2] SQL/JS filter disagreement on ${check.failedOn} for cv ${c.id}`);
      }
      removedBy[check.failedOn] = (removedBy[check.failedOn] || 0) + 1;
    }
  }

  // Score and order. The score never removes anyone.
  const scored = passing.map((c) => {
    const ev = f.skills.length > 0 ? skillEvidence(f.skills, c) : null;
    return {
      c,
      rating: keywordScore(ev, c),
      signals: ev ? strictSkillSignals(ev) : undefined,
      distance: c.distance == null ? Infinity : Number(c.distance),
    };
  });
  scored.sort((a, b) =>
    b.rating.avgScore - a.rating.avgScore
    || b.rating.evidence - a.rating.evidence
    || a.distance - b.distance
    || new Date(b.c.createdAt || 0) - new Date(a.c.createdAt || 0));

  // AI insights for the top 10 only; a failure leaves results intact.
  const tAi0 = Date.now();
  const insightsMap = {};
  let aiUnavailable = false;
  const top = scored.slice(0, 10).map((s) => s.c);
  const missing = top.filter((c) => !resolveProfile(null, c));
  if (missing.length > 0) {
    try {
      const searchContext = {
        keyword: f.keyword,
        matchMode: f.matchMode,
        position: f.position.join(', '),
        addedWithinDays: f.addedWithinDays,
        education: f.education.join(', '),
        expMin: f.expMin,
        expMax: f.expMax,
        ctcMin: f.ctcMin,
        ctcMax: f.ctcMax,
        noticePeriod: f.noticePeriod,
        location: f.location.join(', '),
      };
      const enriched = await generateProfileInsights(searchContext, missing);
      for (const ins of enriched) {
        if (ins.id == null) continue;
        insightsMap[String(ins.id)] = ins;
        prisma.rpa_cv
          .update({ where: { id: BigInt(ins.id) }, data: { ai_profile_insights: ins } })
          .catch((err) => logger.error(`Failed to save back-filled AI insights for candidate ${ins.id}: ${err.message}`));
      }
    } catch (err) {
      aiUnavailable = true;
      logger.error(`[screening:v2] keyword AI insights failed, returning results without them: ${err.message}`);
    }
  }
  const tAi = Date.now() - tAi0;

  const candidates = scored.map(({ c, rating, signals }) => ({
    ...toPublic(c),
    educationContext: {
      candidate_graduation_degree: c.graduationdegree || null,
      candidate_graduation_specialization: c.graduationspecialization || null,
      candidate_pg_degree: c.postgraduationdegree || null,
      candidate_pg_specialization: c.postgraduationspecialization || null,
    },
    shortlisted_status: c.FinalStatus === 'Stage 0 - Resume Shortlisted' ? c.FinalStatus : null,
    ...(signals ? { jdSkillSignals: signals } : {}),
    profile: resolveProfile(insightsMap[String(c.id)], c),
    relevanceScore: rating,
  }));

  // Chip buckets follow the star thresholds: Strong = 4–5★, Moderate = 3★, Weak = 1–2★.
  const high = candidates.filter((c) => c.relevanceScore.stars >= 4).length;
  const medium = candidates.filter((c) => c.relevanceScore.stars === 3).length;
  const low = candidates.length - high - medium;

  const total = Number(countRows[0]?.total) || 0;
  const removedText = keys
    .concat(f.education.length && !keys.includes('education') ? ['education'] : [])
    .filter((k) => removedBy[k] > 0)
    .map((k) => `${REMOVED_LABELS[k] || k} ${removedBy[k]}`)
    .join(', ');
  const summaryText = `${candidates.length} matched (${total} searched${removedText ? `; removed by ${removedText}` : ''})`
    + ` · ★★★★ ${high} strong · ★★★ ${medium} moderate · ★ ${low} weak`;

  const tTotal = Date.now() - t0;
  logger.info(`[screening:v2] keyword t_sql=${tSql}ms t_ai=${tAi}ms t_total=${tTotal}ms rows=${rows.length} shown=${candidates.length}`);

  return {
    candidates: await attachStageHistory(candidates),
    summary: {
      mode: 'keyword',
      matchMode: f.matchMode,
      total,
      shown: candidates.length,
      removedBy,
      high,
      medium,
      low,
      summaryText,
      aiUnavailable,
      degraded: false,
      degradedReason: null,
      timings: { t_sql: tSql, t_ai: tAi, t_total: tTotal },
    },
  };
}

// ---------------------------------------------------------------------------
// JD search (N07–N10)
// ---------------------------------------------------------------------------

const ROLE_CACHE_TTL = 3600;
const INSIGHT_TTL = 7 * 24 * 3600;

/** Redis key of the cached V2 JD result for one MRF (and "Added within" value). Cleared on MRF edit and close. */
export { roleCacheKeyV2 };

/**
 * AI insights per MRF and candidate. Never the shared ai_profile_insights
 * column: an insight written for one role read as a verdict on another (N09).
 */
const insightKey = (mrfId, cvId) => `insight:mrf:${mrfId}:cv:${cvId}`;

const bigintSafe = (k, v) => (typeof v === 'bigint' ? Number(v) : v);

/** The MRF row, its skills / qualification fields, and its budget from rpa_mrf_jd_send. */
async function loadMrf(mrfId) {
  const rows = await prisma.$queryRaw`
    SELECT
        m.id, m.position_hiring_for AS role, m.mandatory_skills, m.mandatory_skills_other, m.parsed_jd_json,
        CASE
            WHEN UPPER(TRIM(COALESCE(m.good_to_have_skills,''))) = 'SAME AS JD' OR TRIM(COALESCE(m.good_to_have_skills,'')) = ''
            THEN m.parsed_jd_json->>'good_to_have_skills'
            WHEN LOWER(TRIM(m.good_to_have_skills)) = 'other' THEN m.good_to_have_skills_other
            ELSE m.good_to_have_skills
        END AS good_to_have_skills,
        CASE
            WHEN UPPER(TRIM(COALESCE(m.roles_responsibilities,''))) = 'SAME AS JD' OR TRIM(COALESCE(m.roles_responsibilities,'')) = ''
            THEN m.parsed_jd_json->>'roles_and_responsibilities'
            ELSE m.roles_responsibilities
        END AS roles_responsibilities,
        m.number_of_positions, m.requirement_for_team, m.total_years_of_experience, m.relevant_years_of_experience,
        m.desired_qualification, m.pg_information, m.graduate_other_information,
        b.budget_min, b.budget_max, b.budget_source
    FROM public.rpa_mrf m
    -- Budget lives only on the MRF request (rpa_mrf_jd_send). The request
    -- linked by mrf_id wins, even with no budget on it; otherwise the old
    -- role-name + submitter match, for requests raised before mrf_id existed.
    LEFT JOIN LATERAL (
        SELECT j.budget_min, j.budget_max,
               CASE WHEN j.mrf_id = m.id THEN 'mrf_id' ELSE 'role_match' END AS budget_source
        FROM public.rpa_mrf_jd_send j
        WHERE j.mrf_id = m.id
           OR (LOWER(TRIM(j.role)) = LOWER(TRIM(m.position_hiring_for)) AND j.email = m.submitter_email)
        ORDER BY (j.mrf_id = m.id) DESC NULLS LAST, j.created_at DESC NULLS LAST, j.id DESC
        LIMIT 1
    ) b ON true
    WHERE m.id = ${BigInt(mrfId)}
    LIMIT 1`;
  if (rows.length === 0) throw new AppError('MRF request not found.', 404);
  return rows[0];
}

/**
 * Top-N AI insights for this MRF, from Redis or freshly generated. Never fails
 * the search: any error leaves the results intact and sets aiUnavailable.
 */
async function insightsForTop(mrfId, roleContext, top) {
  const map = {};
  if (top.length === 0) return { map, aiUnavailable: false };
  if (!config.gemini.apiKey && !config.openrouter?.apiKey) return { map, aiUnavailable: true };

  const keys = top.map((c) => insightKey(mrfId, c.id));
  try {
    const cached = await redis.mget(...keys);
    cached.forEach((raw, i) => {
      if (!raw) return;
      try { map[String(top[i].id)] = JSON.parse(raw); } catch { /* regenerate below */ }
    });
  } catch (err) {
    logger.warn(`[screening:v2] insight cache read skipped: ${err.message}`);
  }

  const missing = top.filter((c) => !map[String(c.id)]);
  if (missing.length === 0) return { map, aiUnavailable: false };
  try {
    const enriched = await generateProfileInsights(roleContext, missing);
    for (const ins of enriched) {
      if (ins?.id == null) continue;
      map[String(ins.id)] = ins;
      redis.set(insightKey(mrfId, ins.id), JSON.stringify(ins, bigintSafe), 'EX', INSIGHT_TTL)
        .catch((err) => logger.warn(`[screening:v2] insight cache write skipped: ${err.message}`));
    }
    return { map, aiUnavailable: false };
  } catch (err) {
    logger.error(`[screening:v2] JD AI insights failed, returning results without them: ${err.message}`);
    return { map, aiUnavailable: true };
  }
}

/**
 * POST /api/screening/roles/:id/search with SCREENING_V2 on.
 *
 * Gates, in RT's order: mandatory skills (ALL) → education → budget →
 * experience band. An empty value for an applied gate excludes the candidate.
 * Every passer is returned, ranked by jdRankScore; nothing is hidden by score.
 *
 * @param {number} mrfId
 * @param {boolean} [force=false] - skip the cache
 */
export async function searchRoleCandidatesV2(mrfId, force = false, { addedWithinDays = null } = {}) {
  const t0 = Date.now();
  // N38 "Added within": same parser and SQL as keyword search. Each offered
  // value has its own cache entry; any other value is computed fresh.
  const recencyDays = parseScreeningFilters({ addedWithinDays }).addedWithinDays;
  const cacheable = isCacheableRecency(recencyDays);
  const cacheKey = roleCacheKeyV2(mrfId, recencyDays);
  if (!force && cacheable) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.info(`[screening:v2] JD MRF ${mrfId} served from cache`);
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn(`[screening:v2] JD cache read skipped: ${err.message}`);
    }
  }

  const mrf = await loadMrf(mrfId);
  const roleName = (mrf.role || '').trim();
  const mandatoryText = resolveMandatoryText(mrf);
  const mandatory = parseMandatorySkills(mandatoryText.text);
  const goodToHave = parseMandatorySkills(mrf.good_to_have_skills);
  const band = experienceBand(mrf.parsed_jd_json, mrf.total_years_of_experience);
  const budgetMin = normaliseBudget(mrf.budget_min);
  const budgetMax = normaliseBudget(mrf.budget_max);
  const budgetSource = budgetMax != null ? mrf.budget_source : null;
  const eduReq = mapQualification(mrf.desired_qualification);
  const rolesResponsibilities = mrf.roles_responsibilities || '';

  const roleContext = {
    position: roleName,
    role_title: roleName,
    requirement_for_team: mrf.requirement_for_team || '',
    role_team: mrf.requirement_for_team || '',
    number_of_positions: Number(mrf.number_of_positions || 0),
    role_openings: Number(mrf.number_of_positions || 0),
    mandatory_skills: mandatoryText.text,
    role_mandatory_skills: mandatoryText.text,
    good_to_have_skills: mrf.good_to_have_skills || '',
    role_good_to_have_skills: mrf.good_to_have_skills || '',
    roles_and_responsibilities: rolesResponsibilities,
    role_responsibilities: rolesResponsibilities,
    total_experience: Number(mrf.total_years_of_experience || 0),
    role_total_years_of_experience: Number(mrf.total_years_of_experience || 0),
    relevant_experience: Number(mrf.relevant_years_of_experience || 0),
    role_relevant_years_of_experience: Number(mrf.relevant_years_of_experience || 0),
    required_qualification: eduReq || 'ANY',
    role_required_qualification: eduReq || 'ANY',
    required_stream: eduReq === 'POST_GRADUATE' ? mrf.pg_information || null
      : eduReq === 'GRADUATE' ? mrf.graduate_other_information || null : null,
    budget_min: budgetMin,
    role_budget_min: budgetMin,
    budget_max: budgetMax,
    role_budget_max: budgetMax,
    // V2 only: what the gates actually enforce, for the role card.
    mandatorySkillsParsed: mandatory.labels,
    ignoredSkills: mandatory.ignored,
    mandatorySource: mandatoryText.source,
    experienceBand: band,
    budgetSource,
    educationRequirement: eduReq ? QUALIFICATION_LABELS[eduReq] : null,
  };

  const baseSummary = {
    mode: 'jd-strict',
    mandatorySource: mandatoryText.source,
    experienceBand: band,
    budgetApplied: budgetMax != null,
    budgetSource,
    educationApplied: eduReq != null,
    aiUnavailable: false,
    degraded: false,
    degradedReason: null,
  };

  // No checkable mandatory skill: "all of nothing" would pass everyone in the
  // band, so block and tell RT to fix the MRF (decided 14 Oct).
  if (mandatory.skills.length === 0) {
    return {
      role: roleContext,
      candidates: [],
      summary: {
        ...baseSummary,
        noMandatorySkills: true,
        total: 0,
        shown: 0,
        removedBy: {},
        mandatorySkills: [],
        ignoredSkills: mandatory.ignored,
        passedOtherGates: 0,
        passedSkillGate: 0,
        fiveStar: 0, fourStar: 0, threeStar: 0, twoStar: 0, oneStar: 0,
        summaryText: 'This MRF has no mandatory skills; edit the MRF to add them.',
      },
    };
  }

  // RT's rule is "ALL mandatory skills, then education, CTC, experience". Who
  // passes does not depend on the order, so the DATABASE runs it the cheap way
  // round: recently rejected for this MRF (the cooldown, as in the old JD
  // search) → education → CTC → experience on plain columns, and only the
  // candidates left are searched for skills in their resume text (decided
  // 14 Oct; ~3x faster than skills-first on 100k resumes, same result).
  const f = {
    ...parseScreeningFilters({}),
    skills: mandatory.skills,
    matchMode: 'all',
    expMin: band.min,
    expMax: band.max,
    ctcMax: budgetMax,
    addedWithinDays: recencyDays,
  };
  const byKey = Object.fromEntries(buildFilterConditions(f, 'c').map((cond) => [cond.key, cond]));
  const eduSql = educationGateSql(eduReq, 'c');
  const cheapConds = [
    {
      key: 'recentlyRejected',
      sql: Prisma.sql`NOT EXISTS (
        SELECT 1 FROM public.rpa_shortlisted_candidates rsc
        WHERE rsc.cv_id = c.id AND rsc.mrf_id = ${BigInt(mrfId)} AND rsc.pipeline_status = 'rejected'
          AND rsc.modified_at > ${getCooldownCutoff()}::timestamp)`,
    },
    eduSql ? { key: 'education', sql: Prisma.sql`COALESCE((${eduSql}), false)` } : null,
    byKey.ctc || null,
    byKey.experience,
    byKey.addedWithin || null,
  ].filter(Boolean);
  const keys = [...cheapConds.map((cond) => cond.key), 'skills'];

  // Semantic distance: last tiebreak only. No embedding → no distance, and the
  // SQL never touches the vector operator.
  const searchQuery = `${roleName} ${mandatoryText.text} ${mrf.good_to_have_skills || ''} ${rolesResponsibilities}`.trim();
  const tEmbed0 = Date.now();
  let vectorStr = null;
  try {
    const embedding = await generateEmbedding(searchQuery);
    vectorStr = `[${embedding.join(',')}]`;
  } catch (err) {
    logger.warn(`[screening:v2] JD embedding skipped: ${err.message}`);
  }
  const tEmbed = Date.now() - tEmbed0;
  const distanceSql = vectorStr
    ? Prisma.sql`(SELECT MIN(v.embedding <=> ${vectorStr}::vector) FROM public.rpa_cv_vectors v WHERE v.candidate_id = c.id)`
    : Prisma.sql`NULL::float8`;

  const skillCols = Prisma.join(
    mandatory.skills.map((t, j) => Prisma.sql`COALESCE(${skillPredicateSql(t, 'c')}, false) AS ${Prisma.raw(`k_${j}`)}`),
    ', ',
  );

  // Step 1 — two queries in parallel:
  //   (a) the funnel counts for the cheap gates (plain columns, all rows);
  //   (b) everyone passing the cheap gates, with one true/false per mandatory
  //       skill. This is the only query that reads resume text, and only for
  //       the candidates left by (a)'s gates. Every skill is checked for every
  //       one of them, so the same rows also tell RT who is missing just ONE
  //       skill ("Kafka 9") — the quickest way to see which phrase in an MRF
  //       empties the list.
  const tSql0 = Date.now();
  const [countRows, poolRows] = await Promise.all([
    prisma.$queryRaw`SELECT ${buildPassCountSql(cheapConds)} FROM public.rpa_cv c`,
    prisma.$queryRaw`
      WITH p AS MATERIALIZED (
        SELECT c.id FROM public.rpa_cv c WHERE ${joinConditions(cheapConds)}
      )
      SELECT p.id, ${skillCols} FROM p JOIN public.rpa_cv c ON c.id = p.id`,
  ]);

  const counts = countRows[0] || { total: 0 };
  const has = (r, j) => r[`k_${j}`] === true;
  const matchedIds = [];
  const missingOnly = mandatory.skills.map(() => 0);
  for (const r of poolRows) {
    const missing = mandatory.skills.map((_, j) => j).filter((j) => !has(r, j));
    if (missing.length === 0) matchedIds.push(String(r.id));
    else if (missing.length === 1) missingOnly[missing[0]]++;
  }

  // Step 2 — cards for the matches only: primary-key lookups, with the
  // per-skill evidence flags and the semantic distance.
  const mFlags = evidenceFlagSql(mandatory.skills, 'ev_');
  const gFlags = evidenceFlagSql(goodToHave.skills, 'ev_g');
  const rows = matchedIds.length === 0 ? [] : await prisma.$queryRaw`
    SELECT ${CARD_COLUMNS}, ${PROVENANCE_COLUMNS}, ${distanceSql} AS distance${flagList([...mFlags.select, ...gFlags.select])}
    FROM public.rpa_cv c
    ${provenanceJoins(mrfId)}
    WHERE c.id = ANY(${matchedIds}::bigint[])`;
  const tSql = Date.now() - tSql0;

  const removedBy = removedByFromPassCounts(keys, counts, matchedIds.length);
  const passedOtherGates = poolRows.length;

  // Defensive JS mirror of the cheap gates (education included); skills were
  // decided by the database on the resume text, which is not fetched.
  const jsFilters = { ...f, skills: [] };
  const passing = [];
  for (const c of rows) {
    const check = passesStrictFilters(c, jsFilters);
    const failedOn = !check.pass ? check.failedOn : !jdEducationPass(c, eduReq) ? 'education' : null;
    if (failedOn) {
      logger.warn(`[screening:v2] JD SQL/JS gate disagreement on ${failedOn} for cv ${c.id}`);
      removedBy[failedOn] = (removedBy[failedOn] || 0) + 1;
    } else {
      passing.push(c);
    }
  }

  const scored = passing.map((c) => {
    const ev = skillEvidence(mandatory.skills, c, 'ev_');
    const goodEv = goodToHave.skills.length ? skillEvidence(goodToHave.skills, c, 'ev_g') : null;
    const rank = jdRankScore({ perTerm: ev.perTerm, band, budgetMax, candidate: c });
    return {
      c,
      ev,
      goodEv,
      rank,
      distance: c.distance == null ? Infinity : Number(c.distance),
    };
  });
  scored.sort((a, b) =>
    b.rank.finalScore - a.rank.finalScore
    || b.ev.evidence - a.ev.evidence
    || a.distance - b.distance
    || new Date(b.c.createdAt || 0) - new Date(a.c.createdAt || 0));

  const tAi0 = Date.now();
  const { map: insightsMap, aiUnavailable } = await insightsForTop(mrfId, roleContext, scored.slice(0, 10).map((s) => s.c));
  const tAi = Date.now() - tAi0;

  const candidates = scored.map(({ c, ev, goodEv, rank }) => {
    const { stars, label } = mapStars(rank.finalScore);
    return {
      ...toPublic(c),
      educationContext: {
        candidate_graduation_degree: c.graduationdegree || null,
        candidate_graduation_specialization: c.graduationspecialization || null,
        candidate_pg_degree: c.postgraduationdegree || null,
        candidate_pg_specialization: c.postgraduationspecialization || null,
      },
      maxTenureYears: Math.round(parseMaxTenureYears(c.employment_history) * 100) / 100,
      shortlisted_status: c.FinalStatus === 'Stage 0 - Resume Shortlisted' ? c.FinalStatus : null,
      jdSkillSignals: strictSkillSignals(ev, goodEv),
      profile: resolveProfile(insightsMap[String(c.id)], c),
      starRating: {
        finalScore: rank.finalScore,
        stars,
        label,
        mode: 'JD Strict',
        breakdown: rank.breakdown,
      },
    };
  });

  const countByStars = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const c of candidates) countByStars[c.starRating.stars]++;

  const total = Number(counts.total) || 0;
  const passedSkillGate = matchedIds.length;
  // Per skill: how many candidates who meet education, CTC and experience are
  // missing ONLY this skill.
  const mandatorySkills = mandatory.skills.map((term, j) => ({
    skill: mandatory.labels[j],
    term,
    missingOnlyThis: missingOnly[j],
  }));

  // The line under the count, worded as on the approved mockup (14 Oct):
  // "of 98,412 · 1,240 meet education, budget and experience · of those, 24
  // have all 3 mandatory skills". Only the gates this MRF applies are named.
  // missingOnlyThis stays in the payload (N11 comparison, RT rules document)
  // but is not shown on screen.
  const fmt = (n) => Number(n).toLocaleString('en-IN');
  const gates = [eduReq && 'education', budgetMax != null && 'budget', 'experience'].filter(Boolean);
  const gateList = gates.length > 1 ? `${gates.slice(0, -1).join(', ')} and ${gates[gates.length - 1]}` : gates[0];
  const detail = [`of ${fmt(total)}`];
  if (removedBy.recentlyRejected > 0) detail.push(`${fmt(removedBy.recentlyRejected)} recently rejected for this role`);
  detail.push(`${fmt(passedOtherGates)} meet ${gateList}`);
  detail.push(`of those, ${fmt(passedSkillGate)} have all ${mandatory.skills.length} mandatory skill${mandatory.skills.length === 1 ? '' : 's'}`);
  if (budgetMax == null) detail.push('no budget on this MRF, CTC not checked');
  if (!eduReq) detail.push('no education requirement on this MRF');
  if (recencyDays != null) detail.push(`only candidates added in the last ${recencyDays} days`);
  const summaryDetail = detail.join(' · ');
  const summaryText = `${candidates.length} matched (${summaryDetail})`;

  const tTotal = Date.now() - t0;
  logger.info(`[screening:v2] JD mrf=${mrfId} t_embed=${tEmbed}ms t_sql=${tSql}ms t_ai=${tAi}ms t_total=${tTotal}ms rows=${rows.length} shown=${candidates.length}`);

  const payload = {
    role: roleContext,
    candidates: await attachStageHistory(candidates),
    summary: {
      ...baseSummary,
      noMandatorySkills: false,
      total,
      shown: candidates.length,
      removedBy,
      mandatorySkills,
      ignoredSkills: mandatory.ignored,
      passedOtherGates,
      passedSkillGate,
      fiveStar: countByStars[5],
      fourStar: countByStars[4],
      threeStar: countByStars[3],
      twoStar: countByStars[2],
      oneStar: countByStars[1],
      summaryText,
      summaryDetail,
      addedWithinDays: recencyDays,
      aiUnavailable,
      timings: { t_embed: tEmbed, t_sql: tSql, t_ai: tAi, t_total: tTotal },
    },
  };

  try {
    if (cacheable) await redis.set(cacheKey, JSON.stringify(payload, bigintSafe), 'EX', ROLE_CACHE_TTL);
  } catch (err) {
    logger.warn(`[screening:v2] JD cache write skipped: ${err.message}`);
  }
  return payload;
}

/**
 * True when the request is a lookup for one specific person (name / email /
 * phone). The old search has no lookup at all, so the controller sends these
 * to V2 whatever SCREENING_V2 says — the flag gates the strict-filtering
 * rework that RT signs off in N11, not this.
 *
 * @param {object} body
 * @returns {boolean}
 */
export function isLookupRequest(body) {
  return detectLookup(parseScreeningFilters(body)) != null;
}

export default { searchKeywordCandidatesV2, searchRoleCandidatesV2, roleCacheKeyV2, isLookupRequest };
