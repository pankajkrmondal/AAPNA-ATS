import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import redis from '../config/redis.js';
import { generateEmbedding, saveCandidateVector } from './vectorStore.service.js';
import { getAccessToken } from './onedrive.service.js';
import { compileTemplate } from './emailNotification.service.js';
import AppError, { AIModelError } from '../utils/AppError.js';
import { generateContentWithFallback } from '../utils/geminiHelper.js';

/**
 * GET /api/screening/roles
 */
export async function getApprovedRoles() {
  const mrfList = await prisma.rpa_mrf.findMany({
    where: {
      approved_by_abhijit: { in: ['approved', 'true'] },
      approval_status: 'completed',
    },
    orderBy: {
      created_at: 'desc',
    },
  });

  // Deduplicate by position_hiring_for, keeping latest
  const seen = new Set();
  const uniqueRoles = [];

  for (const mrf of mrfList) {
    const roleName = (mrf.position_hiring_for || '').trim();
    if (!roleName || seen.has(roleName.toLowerCase())) continue;
    seen.add(roleName.toLowerCase());

    uniqueRoles.push({
      id: Number(mrf.id),
      role: roleName,
      number_of_positions: mrf.number_of_positions || 0,
      created_at: mrf.created_at,
    });
  }

  return uniqueRoles;
}

/**
 * Helper: Parse Education Percentages
 */
function parseEduScores(c) {
  const result = {};
  if (c.a10th != null && c.a10th !== 'null' && String(c.a10th).trim() !== '') {
    result['10th'] = parseFloat(String(c.a10th).replace('%', '').trim());
  }
  if (c.a12th != null && c.a12th !== 'null' && String(c.a12th).trim() !== '') {
    result['12th'] = parseFloat(String(c.a12th).replace('%', '').trim());
  }
  if (c.graduation != null && c.graduation !== 'null' && String(c.graduation).trim() !== '') {
    result['graduation'] = parseFloat(String(c.graduation).replace('%', '').trim());
  }
  if (c.postGraduation != null && c.postGraduation !== 'null' && String(c.postGraduation).trim() !== '') {
    result['postgraduation'] = parseFloat(String(c.postGraduation).replace('%', '').trim());
  }
  return result;
}

/**
 * Helper: Matches Qualification checks
 */
function matchesQualification(candidateDegrees, roleQualification) {
  const degrees = [candidateDegrees.graduationdegree, candidateDegrees.postgraduationdegree].filter(
    (d) => d && d.toUpperCase() !== 'NULL'
  );
  if (!roleQualification || roleQualification.toUpperCase() === 'NULL') return true;
  const roleUpper = roleQualification.toUpperCase();

  const techGrad = [
    'BTECH',
    'B.TECH',
    'B TECH',
    'BE',
    'B.E',
    'B.E.',
    'BACHELOR OF ENGINEERING',
    'BACHELOR OF TECHNOLOGY',
    'ENGINEERING GRADUATE',
    'ENGG',
    'MCA',
  ];
  const postGrad = [
    'MTECH',
    'M.TECH',
    'M TECH',
    'MSC',
    'M.SC',
    'MCA',
    'MASTER OF TECHNOLOGY',
    'MASTER OF SCIENCE',
    'MASTER OF COMPUTER APPLICATIONS',
  ];
  const grad = ['BSC', 'B.SC', 'BCA', 'BACHELOR OF SCIENCE', 'BACHELOR OF COMPUTER APPLICATIONS'];
  const normalizedDegrees = degrees.map((d) => d.toUpperCase().replace(/[^A-Z]/g, ''));

  if (roleUpper.includes('TECH_GRADUATE')) {
    return normalizedDegrees.some((d) => techGrad.some((tg) => d.includes(tg.replace(/[^A-Z]/g, ''))));
  } else if (roleUpper.includes('POST_GRADUATE')) {
    return normalizedDegrees.some((d) => postGrad.some((pg) => d.includes(pg.replace(/[^A-Z]/g, ''))));
  } else if (roleUpper.includes('GRADUATE')) {
    return normalizedDegrees.some(
      (d) => grad.some((g) => d.includes(g.replace(/[^A-Z]/g, ''))) || d.includes('BACHELOR')
    );
  } else {
    return degrees.some((d) => d.toUpperCase().includes(roleUpper));
  }
}

/**
 * Helper: Parse Max Tenure in Years
 */
function parseMaxTenureYears(employmentHistory) {
  try {
    const data = typeof employmentHistory === 'string' ? JSON.parse(employmentHistory) : employmentHistory;
    const companies = data?.companies;
    if (!Array.isArray(companies) || companies.length === 0) return 0;

    let maxYears = 0;
    for (const job of companies) {
      let tenureYears = 0;
      const yw = parseFloat(job.YearsWorked);
      if (!isNaN(yw) && yw > 0) {
        tenureYears = yw;
      } else {
        if (!job.StartDate) continue;
        const start = new Date(job.StartDate);
        const endRaw = job.EndDate;
        const end = !endRaw || String(endRaw).toLowerCase() === 'present' ? new Date() : new Date(endRaw);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
        const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
        if (months <= 0) continue;
        tenureYears = months / 12;
      }
      if (tenureYears > maxYears) maxYears = tenureYears;
    }
    return maxYears;
  } catch {
    return 0;
  }
}

/**
 * Helper: Educational Group Match Checker for Checkboxes
 */
const EDUCATION_GROUPS = {
  tech_cs_it_mca_mtech: {
    degrees: ['btech', 'b.tech', 'b tech', 'be', 'b.e', 'b e', 'mca', 'mtech', 'm.tech', 'm tech'],
    specs: ['computer', 'information technology', 'software', 'application', 'applications', 'data science', 'cybersecurity', 'cyber security', 'programming', 'network', 'web', 'it', 'cs'],
  },
  tech_other_it_msc_ms: {
    degrees: ['btech', 'b.tech', 'b tech', 'be', 'b.e', 'b e', 'msc', 'm.sc', 'm sc', 'ms'],
  },
  tech_bca_bsc_it_grad: {
    degrees: ['bca', 'bsc', 'b.sc', 'b sc'],
    specs: ['computer', 'information technology', 'software', 'application', 'applications', 'data science', 'cybersecurity', 'cyber security', 'programming', 'network', 'web', 'it', 'cs'],
  },
  fin_ca_mba_cma_icwa: {
    degrees: ['ca', 'mba', 'cma', 'icwa', 'pgdm'],
    specs: ['finance', 'fin'],
  },
  fin_mcom: { degrees: ['mcom', 'm.com', 'master of commerce'] },
  fin_bcom: { degrees: ['bcom', 'b.com', 'bachelor of commerce'] },
  sales_mba_be_btech_mca_it: {
    degrees: ['mba', 'btech', 'b.tech', 'b tech', 'be', 'b.e', 'b e', 'mca', 'bca', 'bsc', 'b.sc', 'b sc'],
    specs: ['computer', 'information technology', 'software', 'application', 'applications', 'data science', 'cybersecurity', 'cyber security', 'programming', 'network', 'web', 'it', 'cs'],
  },
  sales_any_postgrad_non_it: {
    degrees: ['master', 'postgraduate', 'pg', 'ma', 'm.a', 'msc', 'm.sc', 'm sc', 'mcom', 'm.com'],
  },
  sales_any_grad: {
    degrees: ['bachelor', 'graduate', 'degree', 'ba', 'b.a', 'bba', 'b.b.a', 'bsc', 'b.sc', 'b sc', 'bcom', 'b.com'],
  },
};

function getCandidateEducationCategories(c) {
  const categories = [];
  const highest = (c.HighestQualification || '').toLowerCase();
  const gradDeg = (c.graduationdegree || '').toLowerCase();
  const pgDeg = (c.postgraduationdegree || '').toLowerCase();

  const cGradSpec = (c.graduationspecialization || '').toLowerCase();
  const cPgSpec = (c.postgraduationspecialization || '').toLowerCase();

  const checkMatch = (degText, specText, groupKey) => {
    const group = EDUCATION_GROUPS[groupKey];
    if (!group) return false;

    const hasDeg = group.degrees.some((d) => degText.includes(d) || highest.includes(d));
    if (!hasDeg) return false;

    if (group.specs) {
      return group.specs.some(
        (s) => specText.includes(s) || degText.includes(s) || highest.includes(s)
      );
    }
    return true;
  };

  // Tech groups
  if (
    checkMatch(gradDeg, cGradSpec, 'tech_cs_it_mca_mtech') ||
    checkMatch(pgDeg, cPgSpec, 'tech_cs_it_mca_mtech')
  ) {
    categories.push('tech_cs_it_mca_mtech');
  }

  const isBTech = ['btech', 'b.tech', 'b tech', 'be', 'b.e', 'b e'].some(
    (d) => gradDeg.includes(d) || highest.includes(d)
  );
  const isMSc = ['msc', 'm.sc', 'm sc', 'ms'].some((d) => pgDeg.includes(d) || highest.includes(d));
  if ((isBTech && !categories.includes('tech_cs_it_mca_mtech')) || isMSc) {
    categories.push('tech_other_it_msc_ms');
  }

  if (checkMatch(gradDeg, cGradSpec, 'tech_bca_bsc_it_grad')) {
    categories.push('tech_bca_bsc_it_grad');
  }

  // Non-tech fallback
  const isGraduate =
    isBTech ||
    isMSc ||
    ['bca', 'bsc', 'ba', 'bcom', 'bba', 'graduation', 'bachelor', 'graduate'].some(
      (d) => gradDeg.includes(d) || highest.includes(d)
    );
  if (
    isGraduate &&
    !categories.includes('tech_cs_it_mca_mtech') &&
    !categories.includes('tech_other_it_msc_ms') &&
    !categories.includes('tech_bca_bsc_it_grad')
  ) {
    categories.push('tech_non_it_grad');
  }

  // Finance groups
  const isCA = ['ca', 'chartered accountant', 'icai'].some(
    (d) => highest.includes(d) || gradDeg.includes(d) || pgDeg.includes(d)
  );
  const isCMA = ['cma', 'icwa'].some((d) => highest.includes(d) || gradDeg.includes(d) || pgDeg.includes(d));
  const isMbaFinance =
    ['mba', 'pgdm'].some((d) => pgDeg.includes(d) || highest.includes(d)) &&
    (cPgSpec.includes('finance') || cPgSpec.includes('fin'));
  if (isCA || isCMA || isMbaFinance) {
    categories.push('fin_ca_mba_cma_icwa');
  }

  if (['mcom', 'm.com'].some((d) => pgDeg.includes(d) || highest.includes(d))) {
    categories.push('fin_mcom');
  }
  if (['bcom', 'b.com'].some((d) => gradDeg.includes(d) || highest.includes(d))) {
    categories.push('fin_bcom');
  }
  if (isGraduate && !isCA && !isCMA && !isMbaFinance && !categories.includes('fin_mcom') && !categories.includes('fin_bcom')) {
    categories.push('fin_any_other_grad');
  }

  // Sales/HR groups
  if (
    ['mba', 'pgdm', 'btech', 'b.tech', 'be', 'b.e', 'mca', 'bca'].some(
      (d) => gradDeg.includes(d) || pgDeg.includes(d) || highest.includes(d)
    )
  ) {
    categories.push('sales_mba_be_btech_mca_it');
  }
  const isPostGraduate = ['master', 'postgraduate', 'pg', 'ma', 'm.a', 'msc', 'mcom'].some(
    (d) => pgDeg.includes(d) || highest.includes(d)
  );
  if (isPostGraduate && !categories.includes('sales_mba_be_btech_mca_it')) {
    categories.push('sales_any_postgrad_non_it');
  }
  if (isGraduate) {
    categories.push('sales_any_grad');
  }

  return categories;
}

/**
 * 8-Parameter Scoring Logic
 */
function scoreTotalExperience(candidateExp, roleTotalYears) {
  if (roleTotalYears > 0 && candidateExp > roleTotalYears) return 0;
  const diff = candidateExp - roleTotalYears;
  if (diff === 0) return 10;
  if (diff <= 2) return 8;
  if (diff <= 4) return 6;
  if (diff <= 6) return 4;
  return 2;
}

function scoreRelevantExperience(candidateTotalExp, roleRelevantYears) {
  if (roleRelevantYears > 0 && candidateTotalExp < roleRelevantYears) return 0;
  const expGap = candidateTotalExp - roleRelevantYears;
  if (expGap === 0) return 10;
  if (expGap <= 1) return 8;
  if (expGap <= 2) return 6;
  if (expGap <= 3) return 4;
  return 2;
}

function scoreJobStability(maxTenureYears, totalExpYears) {
  if (maxTenureYears === 0) return 4;
  const goodThreshold = Math.max(totalExpYears - 2, 0);
  if (goodThreshold === 0) return 4;
  if (maxTenureYears >= goodThreshold) return 10;
  if (maxTenureYears >= goodThreshold * 0.6) return 8;
  if (maxTenureYears >= goodThreshold * 0.3) return 6;
  if (maxTenureYears >= 0.67) return 4;
  return 2;
}

function scoreEducation(eduScores, candidateDegrees, roleQualification) {
  const qualMatches = matchesQualification(candidateDegrees, roleQualification);
  if (!qualMatches) return 0;
  const known = ['10th', '12th', 'graduation']
    .map((k) => eduScores[k])
    .filter((v) => v !== undefined && v !== null && !isNaN(v));
  if (known.length === 0) return 4;
  const belowCount = known.filter((s) => s < 60).length;
  if (known.every((s) => s >= 70)) return 10;
  if (known.every((s) => s >= 60)) return 8;
  if (belowCount === 1) return 6;
  if (belowCount === 2) return 4;
  return 2;
}

function scoreCommunication(rating) {
  const r = Math.round(parseFloat(rating)) || 0;
  if (r >= 5) return 10;
  if (r >= 4) return 8;
  if (r >= 3) return 6;
  if (r >= 2) return 4;
  if (r >= 1) return 2;
  return 6;
}

/**
 * Deterministic JD skill matching scorer (parity with n8n scoreJDMatch).
 * Compares candidate Top5KeySkills against role mandatory+good-to-have skills.
 */
function scoreJDMatch(top5Skills, roleSkills) {
  if (!top5Skills || !roleSkills) return 4;
  const skills = Array.isArray(top5Skills)
    ? top5Skills.map((s) => String(s).toLowerCase().trim())
    : String(top5Skills).split(',').map((s) => s.toLowerCase().trim());
  if (skills.length === 0) return 4;
  const keywords = roleSkills
    .toLowerCase()
    .split(/[\s,;]+/)
    .filter((w) => w.length > 2);
  if (keywords.length === 0) return 4;
  let matchCount = 0;
  for (const skill of skills) {
    if (keywords.some((kw) => skill.includes(kw) || kw.includes(skill))) matchCount++;
  }
  const pct = (matchCount / skills.length) * 100;
  if (pct >= 90) return 10;
  if (pct >= 70) return 8;
  if (pct >= 50) return 6;
  if (pct >= 30) return 4;
  return 2;
}

function scoreCTCAlignment(expectedCTC, budgetMin, budgetMax) {
  const exp = parseFloat(expectedCTC);
  const bMax = parseFloat(budgetMax);
  if (isNaN(exp) || isNaN(bMax) || bMax <= 0) return 0;
  if (exp <= bMax) return 10;
  const overshoot = ((exp - bMax) / bMax) * 100;
  if (overshoot <= 15) return 8;
  if (overshoot <= 30) return 6;
  if (overshoot <= 50) return 4;
  return 2;
}

function scoreAvailability(noticePeriodDays) {
  const days = parseFloat(noticePeriodDays);
  if (isNaN(days)) return 6;
  if (days <= 15) return 10;
  if (days <= 30) return 8;
  if (days <= 45) return 6;
  if (days <= 60) return 4;
  return 2;
}

/**
 * Robust parsed_jd_json field lookup.
 * The JSON column may store keys as snake_case, camelCase, or with spaces.
 */
function getJdJsonField(parsedJd, ...keys) {
  if (!parsedJd || typeof parsedJd !== 'object') return '';
  for (const key of keys) {
    if (parsedJd[key] != null && String(parsedJd[key]).trim() !== '') {
      return String(parsedJd[key]).trim();
    }
  }
  return '';
}

function mapStars(score) {
  if (score >= 9) return { stars: 5, label: 'Excellent Fit' };
  if (score >= 7) return { stars: 4, label: 'Strong Candidate' };
  if (score >= 5) return { stars: 3, label: 'Moderate Fit' };
  if (score >= 3) return { stars: 2, label: 'Weak Fit' };
  return { stars: 1, label: 'Poor Fit' };
}

/**
 * Single-Batch Gemini Profile Insights & Skill Matching Evaluator
 */
async function generateProfileInsights(roleContext, candidates) {
  if (!genAI || candidates.length === 0) {
    return candidates.map((c) => ({
      id: c.id,
      skillMatchScore: 4,
      skillMatchReason: 'Gemini not configured',
      profile: {
        summary: `Candidate has ${c.TotalExperienceYears} years of experience in ${c.CurrentLocation}.`,
        fitVerdict: 'Moderately fits criteria.',
        shortlistRecommendation: 'Maybe',
        redFlags: [],
        skillGap: {
          mandatory: { present: [], missing: [] },
          goodToHave: { present: [], missing: [] },
        },
        careerProgression: 'Steady progression.',
        scoreReasons: {
          totalExperience: 'Fulfills basic criteria',
          relevantExperience: 'Shows basic overlap',
          jobStability: 'Acceptable tenures',
          education: 'Meets qualification requirements',
          communication: 'Adequate English capabilities',
          jdMatching: 'Semantic overlap checked',
          ctcAlignment: 'Fulfills budget metrics',
          availability: 'Fits notice period criteria',
        },
      },
    }));
  }

  const prompt = `
You are a recruitment profile analyst. Generate a profile insights JSON object for each candidate based on the role requirements and candidate data below.

<role_requirements>
${JSON.stringify(roleContext, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2)}
</role_requirements>

<candidates>
${JSON.stringify(
  candidates.map((c) => ({
    id: typeof c.id === 'bigint' ? Number(c.id) : c.id,
    Name: c.Name,
    TotalExperienceYears: c.TotalExperienceYears,
    CurrentCompany: c.CurrentCompany,
    ExpectedCTC_LPA: c.ExpectedCTC_LPA,
    NoticePeriod: c.NoticePeriod,
    Top5KeySkills: c.Top5KeySkills,
    EnglishCommunicationRating: c.EnglishCommunicationRating,
    graduationdegree: c.graduationdegree,
    postgraduationdegree: c.postgraduationdegree,
    a10th: c.a10th,
    a12th: c.a12th,
    graduation: c.graduation,
    EmploymentHistory: c.EmploymentHistory || c.employment_history,
    resume_technical_terms: c.resume_technical_terms
  })),
  (k, v) => typeof v === 'bigint' ? Number(v) : v,
  2
)}
</candidates>

Generate a detailed profile block for each candidate. Specifically, the summary must be a detailed 3-4 sentences detailing the total experience vs requirement, key skills matching the role, current/expected CTC vs budget alignment, notice period, and availability of employment history.
Return ONLY a valid JSON object in this exact structure — no markdown, no explanation, no preamble:
{
  "candidates": [
    {
      "id": <candidate id as number or string>,
      "skillMatchScore": <integer 0-10 based on how well their skills match the role mandatory and good to have skills>,
      "skillMatchReason": "<one sentence explaining the score>",
      "profile": {
        "summary": "<A detailed 3-4 sentence recruiter-friendly candidate summary. Specifically mention their total experience vs the requirement, key skills matching the role, current/expected CTC vs budget alignment, notice period readiness, and whether their employment history is available. For example: 'Sneha Gupta has 4 years of total experience, below the required 5, but possesses strong AI-relevant skills including Python, AI Integration, and LLM APIs. Currently at Civic Infotech with a 10-day notice period, she shows high education scores and good communication. However, her expected CTC of 5.30 LPA may not align with budget (not specified). Employment history is not available.'>",
        "fitVerdict": "<one sentence verdict relative to the search>",
        "shortlistRecommendation": "<Yes | No | Maybe> — <one-line reason>",
        "redFlags": ["<specific red flag with data, or empty array if none>"],
        "skillGap": {
          "mandatory": {
            "present": ["<mandatory skills present in resume>"],
            "missing": ["<mandatory skills missing from resume>"]
          },
          "goodToHave": {
            "present": ["<good-to-have skills present>"],
            "missing": ["<good-to-have skills missing>"]
          }
        },
        "careerProgression": "<one sentence summarizing career timeline progression>",
        "scoreReasons": {
          "totalExperience": "<concise explanation referencing candidate experience vs requirement>",
          "relevantExperience": "<concise explanation referencing candidate relevant experience vs requirement>",
          "jobStability": "<concise explanation referencing longest job tenure and job hops>",
          "education": "<concise explanation referencing graduation/postgraduation degree vs qualification criteria>",
          "communication": "<concise explanation referencing communication rating>",
          "jdMatching": "<concise explanation referencing skill match score>",
          "ctcAlignment": "<concise explanation referencing expected CTC vs budget max>",
          "availability": "<concise explanation referencing notice period in days>"
        }
      }
    }
  ]
}
`;

  try {
    const rawText = await generateContentWithFallback(prompt, {
      generationConfig: { responseMimeType: 'application/json' }
    });
    let cleanText = rawText;
    if (cleanText) {
      cleanText = cleanText.trim();
      if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim();
      }
    }
    const parsed = JSON.parse(cleanText);
    return parsed.candidates || [];
  } catch (err) {
    logger.error('Failed to generate profile insights via Gemini:', { error: err.message });
    throw new AIModelError(err.message);
  }
}

/**
 * POST /api/screening/roles/:id/search
 */
export async function searchRoleCandidates(mrfId) {
  // Check cache first
  const cacheKey = `screening:role:${mrfId}`;
  try {
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      logger.info(`Serving screening results for MRF ${mrfId} from Redis cache`);
      return JSON.parse(cachedData);
    }
  } catch (err) {
    logger.warn('Failed to read from Redis cache:', { error: err.message });
  }

  // 1) Fetch MRF Job details
  const mrf = await prisma.rpa_mrf.findUnique({
    where: { id: BigInt(mrfId) },
  });
  if (!mrf) {
    throw new AppError('MRF request not found.', 404);
  }

  const roleName = (mrf.position_hiring_for || '').trim();

  // Robust skills fallback matching n8n SQL CASE logic:
  // Falls back to parsed_jd_json when value is null, empty, or 'SAME AS JD'
  const rawMandatory = (mrf.mandatory_skills || '').trim();
  const mandatorySkills =
    rawMandatory && rawMandatory.toUpperCase() !== 'SAME AS JD'
      ? rawMandatory
      : getJdJsonField(mrf.parsed_jd_json, 'mandatory_skills', 'mandatorySkills', 'Mandatory Skills');

  const rawGoodToHave = (mrf.good_to_have_skills || '').trim();
  const goodToHaveSkills =
    rawGoodToHave && rawGoodToHave.toUpperCase() !== 'SAME AS JD'
      ? rawGoodToHave
      : getJdJsonField(mrf.parsed_jd_json, 'good_to_have_skills', 'goodToHaveSkills', 'Good to Have Skills');

  const rawResponsibilities = (mrf.roles_responsibilities || '').trim();
  const rolesResponsibilities =
    rawResponsibilities && rawResponsibilities.toUpperCase() !== 'SAME AS JD'
      ? rawResponsibilities
      : getJdJsonField(mrf.parsed_jd_json, 'roles_and_responsibilities', 'roles_responsibilities', 'rolesAndResponsibilities', 'Roles and Responsibilities');

  // Get budget from mrf_jd_send
  const jdSend = await prisma.rpa_mrf_jd_send.findFirst({
    where: {
      role: { equals: roleName.trim(), mode: 'insensitive' },
      email: { equals: (mrf.submitter_email || '').trim(), mode: 'insensitive' },
    },
  });

  const budgetMin = jdSend ? Number(jdSend.budget_min || 0) : 0;
  const budgetMax = jdSend ? Number(jdSend.budget_max || 0) : 0;

  let requiredQual = 'ANY';
  const qualText = (mrf.desired_qualification || '').toLowerCase();
  if (qualText.includes('be/btech') || qualText.includes('mca') || qualText.includes('any')) {
    requiredQual = 'TECH_GRADUATE';
  } else if (qualText.includes('pg')) {
    requiredQual = 'POST_GRADUATE';
  } else if (qualText.includes('graduate')) {
    requiredQual = 'GRADUATE';
  } else if (qualText.includes('other')) {
    requiredQual = 'OTHER';
  }

  const requiredStream =
    requiredQual === 'POST_GRADUATE'
      ? mrf.pg_information
      : requiredQual === 'GRADUATE'
      ? mrf.graduate_other_information
      : requiredQual === 'OTHER'
      ? mrf.other_qualification_more_info
      : null;

  const roleContext = {
    position: roleName,
    role_title: roleName,
    requirement_for_team: mrf.requirement_for_team || '',
    role_team: mrf.requirement_for_team || '',
    number_of_positions: mrf.number_of_positions || 0,
    role_openings: mrf.number_of_positions || 0,
    mandatory_skills: mandatorySkills,
    role_mandatory_skills: mandatorySkills,
    good_to_have_skills: goodToHaveSkills,
    role_good_to_have_skills: goodToHaveSkills,
    roles_and_responsibilities: rolesResponsibilities,
    role_responsibilities: rolesResponsibilities,
    total_experience: Number(mrf.total_years_of_experience || 0),
    role_total_years_of_experience: Number(mrf.total_years_of_experience || 0),
    relevant_experience: Number(mrf.relevant_years_of_experience || 0),
    role_relevant_years_of_experience: Number(mrf.relevant_years_of_experience || 0),
    required_qualification: requiredQual,
    role_required_qualification: requiredQual,
    required_stream: requiredStream,
    role_required_qualification_stream: requiredStream,
    budget_min: budgetMin,
    role_budget_min: budgetMin,
    budget_max: budgetMax,
    role_budget_max: budgetMax,
  };

  // 2) Semantic PGVector Search — enriched query with responsibilities (n8n parity)
  const searchQuery = `${roleName} ${mandatorySkills} ${goodToHaveSkills} ${rolesResponsibilities}`.trim();
  logger.info(`Performing vector similarity search for query: "${searchQuery}"`);

  const embedding = await generateEmbedding(searchQuery);
  const vectorStr = `[${embedding.join(',')}]`;

  // 2) Semantic PGVector Search with SQL Pre-Filtering (Experience & Budget Max to avoid candidate starvation)
  const roleTotalYearsVal = Number(mrf.total_years_of_experience || 0);
  const roleBudgetMaxLPA = budgetMax > 1000 ? budgetMax / 100000 : budgetMax; // convert to LPA if needed

  // Query vector DB for top 50 (joined with rpa_cv to apply hard pre-filtering matching n8n logic)
  const hardFiltered = await prisma.$queryRawUnsafe(
    `SELECT 
        c.id, c."Name", c."NoticePeriod", c."ContactNumber", c."EmailID", c."HighestQualification", 
        c."TotalExperienceYears", c."LastCompanyExperienceYears", c."CurrentLocation", c."CTC_LPA", 
        c."ExpectedCTC_LPA", c."JobSource", c."RecruiterInfoAAPNA", c."PositionApplied", c."Top5KeySkills", 
        c."CurrentCompany", c."Gender", c."EnglishCommunicationRating", c."PreferredShift", c."ReasonForJobChange", 
        c."WillingToTakeOnlineTest", c."HasLaptopForInitialDays", c."EducationalScoresPercentage", 
        c."LinkedInProfile", c."MetaData", c."statusActive", c."missingData", c."cvMissingToken", 
        c."cvMissingTokenStatus", c."createdAt", c."modifiedAt", c."vendorName", c."lockForNinetyDays", 
        c."VendorEmail", c."a10th", c."a12th", c."graduation", c."postGraduation", c."Heat", 
        c."HRQuickcomments", c."IQScore", c."TechScore", c."FinalStatus", c."TechRoundOne", c."TechRoundTwo", 
        c."ManagerialOrCEOFeedback", c."HRInterview", c."ZekoInterviewScore", c."ZekoCodingScore", 
        c."ZekoCommunicationScore", c."TechRoundThree", c.graduationdegree, c.graduationspecialization, 
        c.postgraduationdegree, c.postgraduationspecialization, c.employment_history, c."cvVectorLock", 
        c."cvFileUrl", c.resume_technical_terms, c.ai_profile_insights, v.embedding <=> $1::vector as distance
     FROM public.rpa_cv_vectors v
     JOIN public.rpa_cv c ON c.id = v.candidate_id
     WHERE 
         (
             $2::numeric = 0
             OR c."TotalExperienceYearsNumeric" IS NULL
             OR c."TotalExperienceYearsNumeric" <= $2::numeric
         )
         AND (
             $3::numeric = 0
             OR c."ExpectedCTCNumeric" IS NULL
             OR c."ExpectedCTCNumeric" <= $3::numeric
         )
     ORDER BY distance ASC
     LIMIT 50`,
    vectorStr,
    roleTotalYearsVal,
    roleBudgetMaxLPA
  );

  if (hardFiltered.length === 0) {
    const totalCandidates = await prisma.rpa_cv.count();
    return {
      role: roleContext,
      candidates: [],
      summary: {
        total: totalCandidates,
        hardFilteredOut: totalCandidates,
        shown: 0,
        summaryText: `0 matched (${totalCandidates} removed by exp/CTC filter)`,
      },
    };
  }

  // 3) Pre-Score candidates using deterministic p6 baseline to identify top matches
  const preScored = hardFiltered.map((c) => {
    const eduScores = parseEduScores(c);
    const maxTenureYears = parseMaxTenureYears(c.employment_history);

    const cExp = parseFloat(c.TotalExperienceYears) || 0;
    const cCTC = parseFloat(c.ExpectedCTC_LPA) || 0;
    const cNotice = parseFloat(c.NoticePeriod) || 0;
    const cComm = parseFloat(c.EnglishCommunicationRating) || 0;

    const p1 = scoreTotalExperience(cExp, roleTotalYearsVal);
    const p2 = scoreRelevantExperience(cExp, Number(mrf.relevant_years_of_experience || 0));
    const p3 = scoreJobStability(maxTenureYears, cExp);
    const p4 = scoreEducation(
      eduScores,
      { graduationdegree: c.graduationdegree, postgraduationdegree: c.postgraduationdegree },
      requiredQual
    );
    const p5 = scoreCommunication(cComm);
    const p6 = scoreJDMatch(c.Top5KeySkills, mandatorySkills);
    const p7 = scoreCTCAlignment(cCTC, budgetMin > 1000 ? budgetMin / 100000 : budgetMin, roleBudgetMaxLPA);
    const p8 = scoreAvailability(cNotice);

    const finalScore = parseFloat(((p1 + p2 + p3 + p4 + p5 + p6 + p7 + p8) / 8).toFixed(2));

    return {
      c,
      p1, p2, p3, p4, p5, p6, p7, p8,
      finalScore,
      maxTenureYears
    };
  });

  // Sort and select top 10 for Gemini processing
  const top10 = preScored
    .filter((item) => item.finalScore >= 5 && item.p6 >= 3)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, 10);

  // If no candidates pass the threshold, take top 5 sorted by score to ensure we still show insights
  const candidatesToAnalyze = top10.length > 0 
    ? top10.map(item => item.c) 
    : preScored.sort((a, b) => b.finalScore - a.finalScore).slice(0, 5).map(item => item.c);

  // 4) Build insightsMap from database cached insights first, backfill missing ones
  const insightsMap = {};
  const missingInsightsCandidates = [];

  for (const c of candidatesToAnalyze) {
    if (c.ai_profile_insights) {
      let insightsObj = c.ai_profile_insights;
      if (typeof insightsObj === 'string') {
        try {
          insightsObj = JSON.parse(insightsObj);
        } catch (e) {
          logger.warn('Failed to parse cached ai_profile_insights string', { error: e.message });
        }
      }
      if (insightsObj && (insightsObj.profile || insightsObj.summary)) {
        insightsMap[String(c.id)] = {
          skillMatchScore: insightsObj.skillMatchScore ?? 5,
          skillMatchReason: insightsObj.skillMatchReason ?? 'Cached insights loaded',
          profile: insightsObj.profile ?? insightsObj
        };
        continue;
      }
    }
    missingInsightsCandidates.push(c);
  }

  if (missingInsightsCandidates.length > 0) {
    logger.info(`Requesting batch Gemini insights for ${missingInsightsCandidates.length} candidates missing cached insights...`);
    try {
      const enrichedInsights = await generateProfileInsights(roleContext, missingInsightsCandidates);
      for (const c of enrichedInsights) {
        if (c.id != null) {
          insightsMap[String(c.id)] = c;
          
          // Save back-filled insights to DB in background
          prisma.rpa_cv.update({
            where: { id: BigInt(c.id) },
            data: { ai_profile_insights: c }
          }).catch(err => {
            logger.error(`Failed to save back-filled AI insights for candidate ${c.id}: ${err.message}`);
          });
        }
      }
    } catch (err) {
      logger.error('Failed to run batch Gemini insights:', { error: err.message });
      throw err;
    }
  }

  // 5) Calculate Final Scored Profiles (merging insights)
  const scoredCandidates = preScored.map((item) => {
    const c = item.c;
    const candidateIdStr = c.id.toString();
    const insights = insightsMap[candidateIdStr] || {};
    const rawSkillScore = insights.skillMatchScore != null ? Number(insights.skillMatchScore) : item.p6;
    const skillMatchReason = insights.skillMatchReason || 'Deterministic evaluation conducted';

    // Ground skill match score against candidate resume_technical_terms
    let p6 = rawSkillScore;
    const technicalTerms = (() => {
      try {
        const raw = c.resume_technical_terms;
        return Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []);
      } catch {
        return [];
      }
    })();

    if (technicalTerms.length > 0 && mandatorySkills) {
      const mandatoryKeywords = mandatorySkills
        .toLowerCase()
        .split(/[\s,;]+/)
        .filter((w) => w.length > 2);

      const matchedTerm =
        mandatoryKeywords.length > 0
          ? technicalTerms.find((t) =>
              mandatoryKeywords.some(
                (kw) =>
                  (t.term || '').toLowerCase().includes(kw) ||
                  kw.includes((t.term || '').toLowerCase())
              )
            )
          : null;

      if (matchedTerm) {
        p6 = Math.max(rawSkillScore, 5);
        if ((matchedTerm.count || 1) >= 3) p6 = Math.max(p6, 7);
      } else {
        p6 = Math.min(rawSkillScore, 4);
      }
    }

    const finalScore = parseFloat(((item.p1 + item.p2 + item.p3 + item.p4 + item.p5 + p6 + item.p7 + item.p8) / 8).toFixed(2));
    const { stars, label } = mapStars(finalScore);

    const educationContext = {
      candidate_graduation_degree: c.graduationdegree || null,
      candidate_graduation_specialization: c.graduationspecialization || null,
      candidate_pg_degree: c.postgraduationdegree || null,
      candidate_pg_specialization: c.postgraduationspecialization || null,
    };

    return {
      ...c,
      id: Number(c.id),
      educationContext,
      maxTenureYears: parseFloat(item.maxTenureYears.toFixed(2)),
      shortlisted_status: c.FinalStatus === 'Stage 0 - Resume Shortlisted' ? c.FinalStatus : null,
      profile: insights.profile || null,
      starRating: {
        finalScore,
        stars,
        label,
        mode: 'JD Mode',
        breakdown: {
          totalExperience: { score: item.p1, label: 'Total Experience' },
          relevantExperience: { score: item.p2, label: 'Relevant Experience' },
          jobStability: { score: item.p3, label: 'Job Stability (Max Tenure)' },
          education: { score: item.p4, label: 'Education Performance' },
          communication: { score: item.p5, label: 'Communication Skills' },
          jdMatching: { score: p6, label: 'JD Matching', reason: skillMatchReason },
          ctcAlignment: { score: item.p7, label: 'CTC Alignment' },
          availability: { score: item.p8, label: 'Availability' },
        },
      },
    };
  });

  // Sort by finalScore DESC
  const sorted = scoredCandidates.sort((a, b) => b.starRating.finalScore - a.starRating.finalScore);

  // Filter: Hide candidates with score < 5 or jdMatching score < 3 (n8n parity)
  const filtered = sorted.filter(
    (c) => c.starRating.finalScore >= 5 && c.starRating.breakdown.jdMatching.score >= 3
  );

  // Compute stats
  const countByStars = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const c of filtered) {
    countByStars[c.starRating.stars]++;
  }

  const totalCandidates = await prisma.rpa_cv.count();
  const hardFilteredOut = totalCandidates - hardFiltered.length;
  const filteredOutCount = sorted.length - filtered.length;

  const summary = {
    total: totalCandidates,
    hardFilteredOut,
    shown: filtered.length,
    filteredOut: filteredOutCount,
    fiveStar: countByStars[5],
    fourStar: countByStars[4],
    threeStar: countByStars[3],
    twoStar: countByStars[2],
    oneStar: countByStars[1],
    summaryText: `${filtered.length} matched (${hardFilteredOut} removed by exp/CTC filter, ${filteredOutCount} hidden by low score or skill mismatch) · ★★★★★ ${countByStars[5]} · ★★★★ ${countByStars[4]} · ★★★ ${countByStars[3]}`,
  };

  const responsePayload = {
    role: roleContext,
    candidates: filtered,
    summary,
  };

  // Cache in Redis
  try {
    await redis.set(
      cacheKey,
      JSON.stringify(responsePayload, (k, v) => typeof v === 'bigint' ? Number(v) : v),
      'EX',
      3600
    );
  } catch (err) {
    logger.warn('Failed to write to Redis cache:', { error: err.message });
  }

  return responsePayload;
}

/**
 * POST /api/screening/keyword-search
 */
export async function searchKeywordCandidates(filters) {
  const fKeyword = (filters.keyword || '').toLowerCase().trim();
  const fDesignation = (filters.designation || '').toLowerCase().trim();
  const fEducation = (filters.education || '').toLowerCase().trim();
  const fExpMin = filters.expMin != null && filters.expMin !== '' ? parseFloat(filters.expMin) : null;
  const fExpMax = filters.expMax != null && filters.expMax !== '' ? parseFloat(filters.expMax) : null;
  const fCtcMin = filters.ctcMin != null && filters.ctcMin !== '' ? parseFloat(filters.ctcMin) : null;
  const fCtcMax = filters.ctcMax != null && filters.ctcMax !== '' ? parseFloat(filters.ctcMax) : null;
  const fLocation = (filters.location || '').toLowerCase().trim();
  const fGender = (filters.gender || '').toLowerCase().trim();
  const fNoticePeriod =
    filters.noticePeriod != null && filters.noticePeriod !== '' ? parseFloat(filters.noticePeriod) : null;

  let candidates = [];

  if (fKeyword) {
    const safeKeyword = fKeyword.replace(/'/g, "''");
    const embedding = await generateEmbedding(fKeyword);
    const vectorStr = `[${embedding.join(',')}]`;

    // 1) Combined SQL Pre-filtered Vector Search (checks exp range, CTC range, and full-text tsvector directly in database to avoid candidate starvation)
    candidates = await prisma.$queryRawUnsafe(
      `SELECT 
          c.id, c."Name", c."NoticePeriod", c."ContactNumber", c."EmailID", c."HighestQualification", 
          c."TotalExperienceYears", c."LastCompanyExperienceYears", c."CurrentLocation", c."CTC_LPA", 
          c."ExpectedCTC_LPA", c."JobSource", c."RecruiterInfoAAPNA", c."PositionApplied", c."Top5KeySkills", 
          c."CurrentCompany", c."Gender", c."EnglishCommunicationRating", c."PreferredShift", c."ReasonForJobChange", 
          c."WillingToTakeOnlineTest", c."HasLaptopForInitialDays", c."EducationalScoresPercentage", 
          c."LinkedInProfile", c."MetaData", c."statusActive", c."missingData", c."cvMissingToken", 
          c."cvMissingTokenStatus", c."createdAt", c."modifiedAt", c."vendorName", c."lockForNinetyDays", 
          c."VendorEmail", c."a10th", c."a12th", c."graduation", c."postGraduation", c."Heat", 
          c."HRQuickcomments", c."IQScore", c."TechScore", c."FinalStatus", c."TechRoundOne", c."TechRoundTwo", 
          c."ManagerialOrCEOFeedback", c."HRInterview", c."ZekoInterviewScore", c."ZekoCodingScore", 
          c."ZekoCommunicationScore", c."TechRoundThree", c.graduationdegree, c.graduationspecialization, 
          c.postgraduationdegree, c.postgraduationspecialization, c.employment_history, c."cvVectorLock", 
          c."cvFileUrl", c.ai_profile_insights, v.embedding <=> $1::vector as distance
       FROM public.rpa_cv_vectors v
       JOIN public.rpa_cv c ON c.id = v.candidate_id
       WHERE 
           (
               $2::numeric = 0
               OR c."TotalExperienceYearsNumeric" IS NULL
               OR c."TotalExperienceYearsNumeric" >= $2::numeric
           )
           AND (
               $3::numeric = 0
               OR c."TotalExperienceYearsNumeric" IS NULL
               OR c."TotalExperienceYearsNumeric" <= $3::numeric
           )
           AND (
               $4::numeric = 0
               OR c."ExpectedCTCNumeric" IS NULL
               OR c."ExpectedCTCNumeric" <= $4::numeric
           )
           AND (
               $5::numeric = 0
               OR c."ExpectedCTCNumeric" IS NULL
               OR c."ExpectedCTCNumeric" >= $5::numeric
           )
           AND (
               c.resume_tsvector IS NULL 
               OR c.resume_tsvector @@ plainto_tsquery('english', $6)
               OR c."Top5KeySkills" ILIKE CONCAT('%', $6, '%')
               OR c."PositionApplied" ILIKE CONCAT('%', $6, '%')
               OR c."Name" ILIKE CONCAT('%', $6, '%')
               OR c."CurrentCompany" ILIKE CONCAT('%', $6, '%')
               OR (c.resume_technical_terms IS NOT NULL AND c.resume_technical_terms::text ILIKE CONCAT('%', $6, '%'))
           )
       ORDER BY distance ASC
       LIMIT 50`,
      vectorStr,
      fExpMin || 0,
      fExpMax || 0,
      fCtcMax || 0,
      fCtcMin || 0,
      safeKeyword
    );
  } else {
    // Standard database query filters (no keyword) - Optimized database-side filter to prevent Out-Of-Memory/slow queries with 60,000+ candidates
    const where = {};
    if (fLocation) {
      where.CurrentLocation = { contains: fLocation, mode: 'insensitive' };
    }
    if (fGender) {
      where.Gender = { equals: fGender, mode: 'insensitive' };
    }

    if (fExpMin !== null || fExpMax !== null) {
      where.TotalExperienceYearsNumeric = {};
      if (fExpMin !== null) where.TotalExperienceYearsNumeric.gte = fExpMin;
      if (fExpMax !== null) where.TotalExperienceYearsNumeric.lte = fExpMax;
    }

    if (fCtcMin !== null || fCtcMax !== null) {
      where.OR = [
        { ExpectedCTCNumeric: null },
        {
          ExpectedCTCNumeric: {
            gte: fCtcMin !== null ? fCtcMin : undefined,
            lte: fCtcMax !== null ? fCtcMax : undefined,
          }
        }
      ];
    }

    if (fNoticePeriod !== null) {
      if (where.OR) {
        where.AND = [
          { OR: where.OR },
          {
            OR: [
              { NoticePeriodDays: null },
              { NoticePeriodDays: { lte: fNoticePeriod } }
            ]
          }
        ];
        delete where.OR;
      } else {
        where.OR = [
          { NoticePeriodDays: null },
          { NoticePeriodDays: { lte: fNoticePeriod } }
        ];
      }
    }

    candidates = await prisma.rpa_cv.findMany({ 
      where,
      orderBy: { id: 'desc' },
      take: 200 // Safe cap for UI list to display candidates matching basic filters without keyword
    });
  }

  if (candidates.length === 0) {
    return { candidates: [], summary: { total: 0, shown: 0, summaryText: '0 matched' } };
  }

  // 3) Pre-Score Candidates against Advanced Filters
  const preScored = candidates.map((c) => {
    const eduScores = parseEduScores(c);
    const maxTenure = parseMaxTenureYears(c.employment_history);

    const exp = parseFloat(c.TotalExperienceYears) || 0;
    const ctc = parseFloat(c.ExpectedCTC_LPA) || parseFloat(c.CTC_LPA) || 0;
    const notice = parseFloat(c.NoticePeriod) || 0;

    const scores = [];
    const breakdown = {};

    // A. Skill Match - check if keyword is present in Top5KeySkills or technical terms
    let baselineSkillScore = 4;
    if (fKeyword) {
      const skills = String(c.Top5KeySkills || '')
        .replace(/[{}"\\]/g, '')
        .split(',')
        .map((s) => s.toLowerCase().trim())
        .filter(Boolean);
      
      const technicalTerms = (() => {
        try {
          const raw = c.resume_technical_terms;
          return Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []);
        } catch {
          return [];
        }
      })();

      const kwLower = fKeyword.toLowerCase();
      const hasSkillMatch = skills.some(s => s.includes(kwLower) || kwLower.includes(s));
      const hasTermMatch = technicalTerms.some(t => {
        const term = String(t.term || t || '').toLowerCase();
        return term.includes(kwLower) || kwLower.includes(term);
      });
      const hasNameMatch = String(c.Name || '').toLowerCase().includes(kwLower);
      const hasPositionMatch = String(c.PositionApplied || '').toLowerCase().includes(kwLower);
      const hasCompanyMatch = String(c.CurrentCompany || '').toLowerCase().includes(kwLower);

      baselineSkillScore = (hasSkillMatch || hasTermMatch || hasNameMatch || hasPositionMatch || hasCompanyMatch) ? 10 : 2;
    }
    if (fKeyword) {
      scores.push(baselineSkillScore);
      breakdown.skillMatch = { pts: baselineSkillScore, max: 10, label: 'Skill Match' };
    }

    // B. Designation Match
    if (fDesignation) {
      const haystack = [String(c.Top5KeySkills || ''), String(c.MetaData || ''), String(c.CurrentCompany || '')]
        .join(' ')
        .toLowerCase();
      const words = fDesignation.split(/[\s,]+/).filter((w) => w.length > 2);
      const hits = words.filter((w) => haystack.includes(w)).length;
      const pct = words.length > 0 ? hits / words.length : 0;
      const pts = pct >= 0.7 ? 10 : pct >= 0.4 ? 5 : 0;
      scores.push(pts);
      breakdown.designationMatch = { pts, max: 10, label: 'Designation Match' };
    }

    // C. Education Match
    if (fEducation) {
      const requiredCategories = fEducation
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      const candidateCategories = getCandidateEducationCategories(c);

      let pts = 2;
      const matches = requiredCategories.some((cat) => candidateCategories.includes(cat));
      if (matches) {
        pts = 10;
      }
      scores.push(pts);
      breakdown.educationMatch = { pts, max: 10, label: 'Education Match' };
    }

    // D. Experience Fit
    if (fExpMin !== null || fExpMax !== null) {
      const pts = (fExpMin === null || exp >= fExpMin) && (fExpMax === null || exp <= fExpMax) ? 10 : 0;
      scores.push(pts);
      breakdown.experienceFit = { pts, max: 10, label: 'Experience Fit' };
    }

    // E. CTC Fit
    if (fCtcMin !== null || fCtcMax !== null) {
      const pts = (fCtcMin === null || ctc >= fCtcMin) && (fCtcMax === null || ctc <= fCtcMax) ? 10 : 0;
      scores.push(pts);
      breakdown.ctcFit = { pts, max: 10, label: 'CTC Fit' };
    }

    // F. Job Stability
    if (maxTenure > 0) {
      const goodThreshold = Math.max(exp - 2, 0);
      let pts = 4;
      if (goodThreshold > 0) {
        if (maxTenure >= goodThreshold) pts = 10;
        else if (maxTenure >= goodThreshold * 0.6) pts = 8;
        else if (maxTenure >= goodThreshold * 0.3) pts = 6;
        else if (maxTenure >= 0.67) pts = 4;
        else pts = 2;
      }
      scores.push(pts);
      breakdown.jobStability = { pts, max: 10, label: 'Job Stability' };
    }

    // G. Notice Period
    if (fNoticePeriod !== null) {
      const noticeVal = parseFloat(c.NoticePeriod);
      const pts = isNaN(noticeVal) || noticeVal <= fNoticePeriod ? 10 : 0;
      scores.push(pts);
      breakdown.noticePeriodFit = { pts, max: 10, label: 'Notice Period Fit' };
    }

    const avgScore = scores.length > 0 ? parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)) : 6.0;
    const scorePct = Math.round(avgScore * 10);

    return {
      c,
      eduScores,
      maxTenure,
      avgScore,
      scorePct,
      scores,
      breakdown,
      baselineSkillScore
    };
  });

  // Filter and sort top 10 for Gemini processing
  const top10 = preScored
    .filter((item) => {
      if (item.avgScore < 5) return false;
      if (fKeyword) {
        return item.baselineSkillScore >= 3;
      }
      return true;
    })
    .sort((a, b) => b.scorePct - a.scorePct)
    .slice(0, 10);

  const candidatesToAnalyze = top10.length > 0
    ? top10.map(item => item.c)
    : preScored.sort((a, b) => b.scorePct - a.scorePct).slice(0, 5).map(item => item.c);

  const searchContext = {
    keyword: fKeyword,
    designation: fDesignation,
    education: fEducation,
    expMin: fExpMin,
    expMax: fExpMax,
    ctcMin: fCtcMin,
    ctcMax: fCtcMax,
    noticePeriod: fNoticePeriod,
    location: fLocation,
  };

  // 4) Build insightsMap from database cached insights first, backfill missing ones
  const insightsMap = {};
  const missingInsightsCandidates = [];

  for (const c of candidatesToAnalyze) {
    if (c.ai_profile_insights) {
      let insightsObj = c.ai_profile_insights;
      if (typeof insightsObj === 'string') {
        try {
          insightsObj = JSON.parse(insightsObj);
        } catch (e) {
          logger.warn('Failed to parse cached ai_profile_insights string', { error: e.message });
        }
      }
      if (insightsObj && (insightsObj.profile || insightsObj.summary)) {
        insightsMap[String(c.id)] = {
          skillMatchScore: insightsObj.skillMatchScore ?? 5,
          skillMatchReason: insightsObj.skillMatchReason ?? 'Cached insights loaded',
          profile: insightsObj.profile ?? insightsObj
        };
        continue;
      }
    }
    missingInsightsCandidates.push(c);
  }

  if (missingInsightsCandidates.length > 0) {
    logger.info(`Requesting batch Gemini insights for ${missingInsightsCandidates.length} keyword candidates missing cached insights...`);
    try {
      const enrichedInsights = await generateProfileInsights(searchContext, missingInsightsCandidates);
      for (const c of enrichedInsights) {
        if (c.id != null) {
          insightsMap[String(c.id)] = c;
          
          // Save back-filled insights to DB in background
          prisma.rpa_cv.update({
            where: { id: BigInt(c.id) },
            data: { ai_profile_insights: c }
          }).catch(err => {
            logger.error(`Failed to save back-filled AI insights for candidate ${c.id}: ${err.message}`);
          });
        }
      }
    } catch (err) {
      logger.error('Failed to run batch Gemini insights:', { error: err.message });
      throw err;
    }
  }

  // 5) Calculate Final Scored Profiles (merging insights)
  const scoredCandidates = preScored.map((item) => {
    const c = item.c;
    const candidateIdStr = c.id.toString();
    const insights = insightsMap[candidateIdStr] || {};
    const skillScore = insights.skillMatchScore != null ? Number(insights.skillMatchScore) : item.baselineSkillScore;
    const skillMatchReason = insights.skillMatchReason || 'Grounded keyword evaluation';

    // Recalculate skill match score with keywords matching
    const scores = [...item.scores];
    const breakdown = { ...item.breakdown };

    if (fKeyword) {
      let adjustedSkillScore = skillScore;
      const skills = String(c.Top5KeySkills || '')
        .replace(/[{}"\\]/g, '')
        .split(',')
        .map((s) => s.toLowerCase().trim())
        .filter(Boolean);
      
      const technicalTerms = (() => {
        try {
          const raw = c.resume_technical_terms;
          return Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []);
        } catch {
          return [];
        }
      })();

      const kwLower = fKeyword.toLowerCase();
      const hasSkillMatch = skills.some(s => s.includes(kwLower) || kwLower.includes(s));
      const matchedTerm = technicalTerms.find(t => {
        const term = String(t.term || t || '').toLowerCase();
        return term.includes(kwLower) || kwLower.includes(term);
      });
      const hasNameMatch = String(c.Name || '').toLowerCase().includes(kwLower);
      const hasPositionMatch = String(c.PositionApplied || '').toLowerCase().includes(kwLower);
      const hasCompanyMatch = String(c.CurrentCompany || '').toLowerCase().includes(kwLower);

      if (hasSkillMatch || matchedTerm || hasNameMatch || hasPositionMatch || hasCompanyMatch) {
        adjustedSkillScore = Math.max(skillScore, 5);
        if (hasSkillMatch || (matchedTerm && (matchedTerm.count || 1) >= 3) || hasNameMatch || hasPositionMatch || hasCompanyMatch) {
          adjustedSkillScore = Math.max(adjustedSkillScore, 7);
        }
      } else {
        adjustedSkillScore = Math.min(skillScore, 4);
      }

      // Update skill match score in list and breakdown
      scores[0] = adjustedSkillScore;
      breakdown.skillMatch = {
        pts: adjustedSkillScore,
        max: 10,
        label: 'Skill Match',
        reason: skillMatchReason,
      };
    }

    const avgScore = scores.length > 0 ? parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)) : 6.0;
    const scorePct = Math.round(avgScore * 10);

    let stars;
    if (avgScore >= 9) stars = 5;
    else if (avgScore >= 7) stars = 4;
    else if (avgScore >= 5) stars = 3;
    else if (avgScore >= 3) stars = 2;
    else stars = 1;

    const labelMap = { 5: 'Excellent Match', 4: 'Strong Match', 3: 'Moderate Match', 2: 'Weak Fit', 1: 'Poor Fit' };

    const educationContext = {
      candidate_graduation_degree: c.graduationdegree || null,
      candidate_graduation_specialization: c.graduationspecialization || null,
      candidate_pg_degree: c.postgraduationdegree || null,
      candidate_pg_specialization: c.postgraduationspecialization || null,
    };

    return {
      ...c,
      id: Number(c.id),
      educationContext,
      shortlisted_status: c.FinalStatus === 'Stage 0 - Resume Shortlisted' ? c.FinalStatus : null,
      profile: insights.profile || null,
      relevanceScore: {
        scorePct,
        stars,
        label: labelMap[stars],
        avgScore,
        filtersApplied: scores.length,
        breakdown,
        mode: 'keyword',
      },
    };
  });

  // Filter out avgScore < 5. If keyword is present, also check that skillMatch >= 3
  const filtered = scoredCandidates
    .filter((c) => {
      if (c.relevanceScore.avgScore < 5) return false;
      if (fKeyword) {
        const skillPts = c.relevanceScore.breakdown.skillMatch?.pts ?? 0;
        return skillPts >= 3;
      }
      return true;
    })
    .sort((a, b) => b.relevanceScore.scorePct - a.relevanceScore.scorePct);

  // Compute stats
  const high = filtered.filter((c) => c.relevanceScore.scorePct >= 75).length;
  const medium = filtered.filter((c) => c.relevanceScore.scorePct >= 50 && c.relevanceScore.scorePct < 75).length;
  const low = filtered.filter((c) => c.relevanceScore.scorePct < 50).length;

  const scoreFilteredOut = scoredCandidates.length - filtered.length;

  const summary = {
    total: candidates.length,
    shown: filtered.length,
    scoreFilteredOut,
    high,
    medium,
    low,
    summaryText: `${filtered.length} matched (${scoreFilteredOut} hidden by low score) · ★★★★★ ${high} strong · ★★★ ${medium} moderate · ★ ${low} low`,
  };

  return {
    candidates: filtered,
    summary,
  };
}

/**
 * Helper: Re-sync vector embeddings after status changes
 */
async function refreshCandidateVector(candidateId) {
  try {
    const candidate = await prisma.rpa_cv.findUnique({
      where: { id: BigInt(candidateId) },
    });
    if (!candidate) return;

    const parsedData = {
      Name: candidate.Name,
      EmailID: candidate.EmailID,
      ContactNumber: candidate.ContactNumber,
      Gender: candidate.Gender,
      TotalExperienceYears: candidate.TotalExperienceYears,
      LastCompanyExperienceYears: candidate.LastCompanyExperienceYears,
      CurrentLocation: candidate.CurrentLocation,
      CTC_LPA: candidate.CTC_LPA,
      ExpectedCTC_LPA: candidate.ExpectedCTC_LPA,
      NoticePeriod: candidate.NoticePeriod,
      Top5KeySkills: candidate.Top5KeySkills ? candidate.Top5KeySkills.split(',').map((s) => s.trim()) : [],
      CurrentCompany: candidate.CurrentCompany,
      EnglishCommunicationRating: candidate.EnglishCommunicationRating,
      HighestQualification: candidate.HighestQualification,
      JobSource: candidate.JobSource,
      LinkedInProfile: candidate.LinkedInProfile,
      PreferredShift: candidate.PreferredShift,
      ReasonForJobChange: candidate.ReasonForJobChange,
      WillingToTakeOnlineTest: candidate.WillingToTakeOnlineTest,
      HasLaptopForInitialDays: candidate.HasLaptopForInitialDays,
      vendorName: candidate.vendorName,
      VendorEmail: candidate.VendorEmail,
      a10th: candidate.a10th,
      a12th: candidate.a12th,
      graduation: candidate.graduation,
      postGraduation: candidate.postGraduation,
      graduationdegree: candidate.graduationdegree,
      graduationspecialization: candidate.graduationspecialization,
      postgraduationdegree: candidate.postgraduationdegree,
      postgraduationspecialization: candidate.postgraduationspecialization,
      MetaData: candidate.MetaData,
      EmploymentHistory: candidate.employment_history,
      FinalStatus: candidate.FinalStatus,
    };

    await saveCandidateVector(candidate.id, parsedData);
    logger.info(`Vector embeddings updated successfully for candidate ID ${candidateId}`);
  } catch (err) {
    logger.error(`Failed to refresh vector embeddings for candidate ID ${candidateId}:`, {
      error: err.message,
    });
  }
}

/**
 * POST /api/screening/shortlist
 */
export async function shortlistCandidates(candidates, mrfId, roleName, user) {
  const hrEmail = user.email || config.microsoft.defaultSender;
  let emailsSent = 0;

  // 1) Fetch template
  const template = await prisma.rpa_email_templates.findFirst({
    where: {
      category: 'shortlist',
      is_active: true,
    },
  });
  if (!template) {
    throw new AppError('Shortlist email template not found.', 500);
  }

  // 2) Loop over candidates
  for (const c of candidates) {
    const candidateId = BigInt(c.id);

    // Check conflict
    const exists = await prisma.rpa_shortlisted_candidates.findFirst({
      where: {
        cv_id: candidateId,
        mrf_id: BigInt(mrfId),
      },
    });

    if (exists) {
      logger.info(`Candidate ${c.Name} already shortlisted for MRF ${mrfId}, skipping DB insert.`);
      continue;
    }

    // Insert shortlist record
    const shortlist = await prisma.rpa_shortlisted_candidates.create({
      data: {
        cv_id: candidateId,
        mrf_id: BigInt(mrfId),
        candidate_name: c.Name || 'Candidate',
        candidate_email: c.EmailID || '',
        position_applied: roleName,
        shortlisted_by: user.username || 'recruiter',
        shortlisted_at: new Date(),
        pipeline_status: 'shortlisted',
      },
    });

    // Update candidate status
    await prisma.rpa_cv.update({
      where: { id: candidateId },
      data: {
        FinalStatus: 'Stage 0 - Resume Shortlisted',
        modifiedAt: new Date(),
      },
    });

    let toEmail = c.EmailID;
    if (config.env !== 'production') {
      toEmail = config.microsoft.stagingRecipients;
    }

    if (toEmail) {
      // Replace placeholders
      const { subject, html: bodyHtml } = compileTemplate(template.subject, template.body_html, {
        candidate_name: c.Name || 'Candidate',
        job_title: roleName,
        recruiter_name: user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : 'Recruitment Team'
      });

      try {
        const token = await getAccessToken();
        const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(hrEmail)}/sendMail`;

        const recipients = toEmail
          .split(',')
          .map((em) => em.trim())
          .filter((em) => em.length > 0)
          .map((em) => ({
            emailAddress: { address: em },
          }));

        const mailPayload = {
          message: {
            subject,
            body: {
              contentType: 'HTML',
              content: bodyHtml,
            },
            toRecipients: recipients,
          },
          saveToSentItems: 'true',
        };

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(mailPayload),
        });

        if (res.ok) {
          emailsSent++;
          // Log mail message to db
          const emailMsg = await prisma.rpa_email_messages.create({
            data: {
              conversation_id: `shortlist-conv-${shortlist.id}`,
              from_email: hrEmail,
              to_emails: toEmail.split(','),
              subject,
              body_html: bodyHtml,
              direction: 'outbound',
              candidate_id: candidateId,
              mrf_id: BigInt(mrfId),
              shortlist_id: shortlist.id,
              sent_at: new Date(),
            },
          });

          // Create tracking record
          await prisma.rpa_email_tracking.create({
            data: {
              message_id: emailMsg.id,
              delivered: true,
              delivered_at: new Date(),
            },
          });

          // Update shortlist flag
          await prisma.rpa_shortlisted_candidates.update({
            where: { id: shortlist.id },
            data: {
              email_sent: true,
              email_sent_at: new Date(),
              email_subject: subject,
              email_body_snapshot: bodyHtml,
            },
          });
        }
      } catch (err) {
        logger.error(`Failed to send shortlist email to ${toEmail}:`, { error: err.message });
      }
    }

    // Refresh embeddings asynchronously
    refreshCandidateVector(c.id);
  }

  // Invalidate Redis caches for MRF roles
  try {
    const keys = await redis.keys('screening:role:*');
    if (keys.length > 0) {
      await redis.del(keys);
      logger.info('Screening Redis caches invalidated successfully');
    }
  } catch (err) {
    logger.warn('Failed to invalidate Redis cache:', { error: err.message });
  }

  return { success: true, emails_sent: emailsSent };
}

/**
 * GET /api/screening/analytics/jobs
 */
export async function getZekoJobs() {
  const jobs = await prisma.rpa_zeko_jobs.findMany({
    where: { is_archived: false },
    orderBy: { title: 'asc' },
  });
  return jobs;
}

/**
 * GET /api/screening/analytics/pipeline
 */
export async function getZekoPipeline() {
  // Load pipeline candidates combined with shortlist name
  const rows = await prisma.$queryRaw`
    SELECT 
      p.id, p.candidate_id, p.zeko_job_id, p.pipeline_id, p.stage, p.status, 
      p.link_sent_at, p.completed_at, p.created_at, p.interview_start_at, 
      p.interview_end_at, p.cancelled_at, p.cancel_reason, p.candidate_email, 
      sc.candidate_name, j.title AS job_title 
    FROM rpa_zeko_candidate_pipeline p 
    JOIN rpa_shortlisted_candidates sc ON sc.id = p.candidate_id 
    JOIN rpa_zeko_jobs j ON j.zeko_id = p.zeko_job_id
    ORDER BY p.created_at DESC;
  `;

  // Compute stage counts (tiles)
  const stats = await prisma.$queryRaw`
    SELECT 
      COUNT(*) FILTER (WHERE status IN ('sent','in_progress','completed','passed','failed')) AS zeko_sent,
      COUNT(*) FILTER (WHERE status IN ('in_progress')) AS zeko_in_progress,
      COUNT(*) FILTER (WHERE status IN ('completed','passed','failed')) AS zeko_completed,
      COUNT(*) FILTER (WHERE status IN ('passed')) AS zeko_passed,
      COUNT(*) FILTER (WHERE status IN ('failed')) AS zeko_failed,
      COUNT(*) FILTER (WHERE status IN ('cancelled')) AS zeko_cancelled
    FROM rpa_zeko_candidate_pipeline;
  `;

  const tileCounts = stats[0] || {
    zeko_sent: 0,
    zeko_in_progress: 0,
    zeko_completed: 0,
    zeko_passed: 0,
    zeko_failed: 0,
    zeko_cancelled: 0,
  };

  // Fetch all shortlisted candidates to display in the All Candidates tab and role stats in the Analytics tab
  const candidates = await prisma.rpa_shortlisted_candidates.findMany({
    include: {
      mrf: true,
      rpa_zeko_candidate_pipeline: true,
      cv: true
    },
    orderBy: {
      shortlisted_at: 'desc'
    }
  });

  // Safe serialization for BigInt and decimal fields
  const serializedRows = rows.map((r) => ({
    ...r,
    id: Number(r.id),
    candidate_id: Number(r.candidate_id),
  }));

  const serializedCandidates = candidates.map((c) => ({
    ...c,
    id: Number(c.id),
    cv_id: c.cv_id ? Number(c.cv_id) : null,
    mrf_id: c.mrf_id ? Number(c.mrf_id) : null,
    mrf: c.mrf ? {
      ...c.mrf,
      id: Number(c.mrf.id)
    } : null,
    cv: c.cv ? {
      ...c.cv,
      id: Number(c.cv.id)
    } : null,
    // Add zeko status/stage fields for easy column rendering in frontend
    zeko_stage: c.rpa_zeko_candidate_pipeline[0]?.stage || '-',
    zeko_status: c.rpa_zeko_candidate_pipeline[0]?.status || '-',
  }));

  // Compute candidate status counts (shortlisted, rejected, on_hold, total)
  const candidateCounts = {
    shortlisted: candidates.filter(c => (c.pipeline_status || 'shortlisted').toLowerCase() === 'shortlisted').length,
    rejected: candidates.filter(c => (c.pipeline_status || '').toLowerCase() === 'rejected').length,
    on_hold: candidates.filter(c => (c.pipeline_status || '').toLowerCase() === 'on_hold' || (c.pipeline_status || '').toLowerCase() === 'on hold').length,
    total: candidates.length
  };

  return {
    pipeline: serializedRows,
    candidates: serializedCandidates,
    tiles: {
      zeko_sent: Number(tileCounts.zeko_sent || 0),
      zeko_in_progress: Number(tileCounts.zeko_in_progress || 0),
      zeko_completed: Number(tileCounts.zeko_completed || 0),
      zeko_passed: Number(tileCounts.zeko_passed || 0),
      zeko_failed: Number(tileCounts.zeko_failed || 0),
      zeko_cancelled: Number(tileCounts.zeko_cancelled || 0),
      shortlisted: candidateCounts.shortlisted,
      rejected: candidateCounts.rejected,
      on_hold: candidateCounts.on_hold,
      total: candidateCounts.total,
    },
  };
}

/**
 * POST /api/screening/analytics/assign
 */
export async function assignCandidateToZekoJob(candidateId, zekoJobId) {
  const shortlist = await prisma.rpa_shortlisted_candidates.findUnique({
    where: { id: candidateId },
  });
  if (!shortlist) {
    throw new AppError('Shortlisted candidate not found.', 404);
  }

  // Compound unique key check
  const pipelineRow = await prisma.rpa_zeko_candidate_pipeline.upsert({
    where: {
      candidate_id_zeko_job_id_stage: {
        candidate_id: candidateId,
        zeko_job_id: String(zekoJobId),
        stage: 'hr',
      },
    },
    update: {
      status: 'pending',
      candidate_email: shortlist.candidate_email,
    },
    create: {
      candidate_id: candidateId,
      zeko_job_id: String(zekoJobId),
      pipeline_id: String(zekoJobId), // Defaults to job ID if not specified yet
      stage: 'hr',
      status: 'pending',
      candidate_email: shortlist.candidate_email,
      created_at: new Date(),
    },
  });

  return {
    id: Number(pipelineRow.id),
    candidate_id: Number(pipelineRow.candidate_id),
    zeko_job_id: pipelineRow.zeko_job_id,
    stage: pipelineRow.stage,
    status: pipelineRow.status,
    pipeline_id: pipelineRow.pipeline_id,
  };
}

/**
 * POST /api/screening/analytics/schedule
 */
export async function scheduleInterview(shortlistId, zekoJobId, startTime, endTime, user) {
  const hrEmail = user.email || config.microsoft.defaultSender;

  // 1) Fetch settings Client ID
  const settingClientId = await prisma.rpa_settings.findUnique({
    where: { key: 'ZEKO_CLIENT_ID' },
  });
  if (!settingClientId) {
    throw new AppError('ZEKO_CLIENT_ID not found in settings.', 500);
  }

  // 2) Fetch active Zeko token
  const tokenRecord = await prisma.rpa_zeko_auth_token.findFirst({
    where: {
      is_active: true,
      expires_at: { gt: new Date() },
    },
  });
  if (!tokenRecord) {
    throw new AppError('No active authentication token found for Zeko APIs.', 500);
  }

  // 3) Get candidate details
  const shortlist = await prisma.rpa_shortlisted_candidates.findUnique({
    where: { id: shortlistId },
  });
  if (!shortlist) {
    throw new AppError('Shortlist Candidate details not found.', 404);
  }

  // Get Job details
  const job = await prisma.rpa_zeko_jobs.findFirst({
    where: { zeko_id: String(zekoJobId) },
  });
  if (!job) {
    throw new AppError('Zeko Job details not found.', 404);
  }

  const interviewId = job.primary_interview_id;
  if (!interviewId) {
    throw new AppError('Primary interview ID missing for this Zeko Job.', 500);
  }

  // Round start time to next 30-min boundary for Zeko compatibility
  const MS30 = 30 * 60 * 1000;
  const rawStart = new Date(startTime);
  const rawEnd = new Date(endTime);
  const durationMs = rawEnd - rawStart;
  const rem = rawStart.getTime() % MS30;
  const roundedStart = rem === 0 ? rawStart : new Date(rawStart.getTime() + (MS30 - rem));
  const roundedEnd = new Date(roundedStart.getTime() + durationMs);

  const startIso = roundedStart.toISOString();
  const endIso = roundedEnd.toISOString();

  // 4) Call Zeko Schedule API
  const zekoUrl = `https://interview-api.zeko.ai/api/v1/interview/${interviewId}/schedule`;
  const zekoPayload = {
    candidates: [
      {
        name: shortlist.candidate_name,
        email: shortlist.candidate_email,
        phone: '',
        resumeLink: '',
        metaData: {
          Id: shortlistId,
          name: job.title || '',
          clientId: settingClientId.value,
        },
      },
    ],
    startTime: startIso,
    endTime: endIso,
  };

  logger.info(`Zeko API: Scheduling interview at Zeko for candidate ${shortlist.candidate_name}`);

  const zekoRes = await fetch(zekoUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenRecord.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(zekoPayload),
  });

  if (!zekoRes.ok) {
    const errorBody = await zekoRes.json().catch(() => ({}));
    throw new AppError(`Zeko Schedule API failed: ${zekoRes.statusText}. ${JSON.stringify(errorBody)}`, 502);
  }

  // Update pipeline status
  const pipeline = await prisma.rpa_zeko_candidate_pipeline.updateMany({
    where: {
      candidate_id: shortlistId,
      zeko_job_id: String(zekoJobId),
    },
    data: {
      interview_start_at: roundedStart,
      interview_end_at: roundedEnd,
      status: 'sent',
      link_sent_at: new Date(),
    },
  });

  // 5) Load & Compile Zeko Interview Scheduled template from database
  const template = await prisma.rpa_email_templates.findFirst({
    where: { name: 'Zeko Interview Scheduled Invitation', is_active: true }
  });
  if (!template) {
    throw new AppError('Zeko Interview Scheduled Invitation template not found in database.', 500);
  }

  const interviewLink = `https://interview.zeko.ai/interview/${job.slug}`;
  const startStr =
    roundedStart.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }) + ' IST';
  const endStr =
    roundedEnd.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }) + ' IST';

  const { subject, html: emailHtml } = compileTemplate(template.subject, template.body_html, {
    candidate_name: shortlist.candidate_name,
    job_title: job.title || 'Position',
    interview_start: startStr,
    interview_end: endStr,
    interview_link: interviewLink
  });

  // Send email via Outlook
  let toEmail = shortlist.candidate_email;
  if (config.env !== 'production') {
    toEmail = config.microsoft.stagingRecipients;
  }

  if (toEmail) {
    try {
      const token = await getAccessToken();
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(hrEmail)}/sendMail`;

      const mailPayload = {
        message: {
          subject,
          body: {
            contentType: 'HTML',
            content: emailHtml,
          },
          toRecipients: toEmail
            .split(',')
            .map((em) => em.trim())
            .filter((em) => em.length > 0)
            .map((em) => ({ emailAddress: { address: em } })),
        },
        saveToSentItems: 'true',
      };

      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mailPayload),
      });
    } catch (err) {
      logger.error('Failed to send interview scheduling email:', { error: err.message });
    }
  }

  return { success: true };
}

/**
 * POST /api/screening/analytics/cancel
 */
export async function cancelInterview(pipelineId, reason, user) {
  const hrEmail = user.email || config.microsoft.defaultSender;

  // 1) Fetch active Zeko token
  const tokenRecord = await prisma.rpa_zeko_auth_token.findFirst({
    where: {
      is_active: true,
      expires_at: { gt: new Date() },
    },
  });
  if (!tokenRecord) {
    throw new AppError('No active authentication token found for Zeko APIs.', 500);
  }

  // 2) Get pipeline details
  const pipeline = await prisma.rpa_zeko_candidate_pipeline.findUnique({
    where: { id: pipelineId },
  });
  if (!pipeline) {
    throw new AppError('Zeko Pipeline record not found.', 404);
  }

  const shortlist = await prisma.rpa_shortlisted_candidates.findUnique({
    where: { id: pipeline.candidate_id },
  });
  const job = await prisma.rpa_zeko_jobs.findFirst({
    where: { zeko_id: pipeline.zeko_job_id },
  });

  const jobTitle = job ? job.title : 'Position';

  // 3) Call Zeko Cancel API
  const zekoUrl = `https://interview-api.zeko.ai/api/v1/interview/${pipeline.pipeline_id}/cancel-scheduled-candidates`;
  const zekoPayload = {
    candidateEmails: [pipeline.candidate_email],
  };

  logger.info(`Zeko API: Cancelling interview at Zeko for candidate ${pipeline.candidate_email}`);

  const zekoRes = await fetch(zekoUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenRecord.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(zekoPayload),
  });

  if (!zekoRes.ok) {
    const errorBody = await zekoRes.json().catch(() => ({}));
    logger.warn(`Zeko Cancel API returned warning status: ${zekoRes.statusText}. ${JSON.stringify(errorBody)}`);
    // Do not fail block to allow database state update & email notifications anyway (best-effort cancellation)
  }

  // Update pipeline status
  await prisma.rpa_zeko_candidate_pipeline.update({
    where: { id: pipelineId },
    data: {
      status: 'cancelled',
      cancelled_at: new Date(),
      cancel_reason: reason,
    },
  });

  // 4) Load & Compile Zeko Interview Cancelled template from database
  const template = await prisma.rpa_email_templates.findFirst({
    where: { name: 'Zeko Interview Cancelled Alert', is_active: true }
  });
  if (!template) {
    throw new AppError('Zeko Interview Cancelled Alert template not found in database.', 500);
  }

  const { subject, html: emailHtml } = compileTemplate(template.subject, template.body_html, {
    candidate_name: shortlist ? shortlist.candidate_name : 'Candidate',
    job_title: jobTitle,
    interview_stage: pipeline.stage.toUpperCase(),
    cancel_reason: reason || 'Not specified'
  });

  // Send email via Outlook
  let toEmail = pipeline.candidate_email;
  if (config.env !== 'production') {
    toEmail = config.microsoft.stagingRecipients;
  }

  if (toEmail) {
    try {
      const token = await getAccessToken();
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(hrEmail)}/sendMail`;

      const mailPayload = {
        message: {
          subject,
          body: {
            contentType: 'HTML',
            content: emailHtml,
          },
          toRecipients: toEmail
            .split(',')
            .map((em) => em.trim())
            .filter((em) => em.length > 0)
            .map((em) => ({ emailAddress: { address: em } })),
        },
        saveToSentItems: 'true',
      };

      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mailPayload),
      });
    } catch (err) {
      logger.error('Failed to send interview cancellation email:', { error: err.message });
    }
  }

  return { success: true };
}

/**
 * Fetch Outlook conversations and group into threads (migrated from n8n)
 */
export async function getOutlookConversations(email) {
  const query = `
    SELECT
      m.id,
      m.graph_message_id,
      m.conversation_id,
      m.from_email,
      m.from_name,
      m.to_emails,
      m.subject,
      m.body_preview,
      m.body_html,
      m.direction,
      m.candidate_id,
      m.mrf_id,
      m.shortlist_id,
      m.sent_at,
      m.created_at,
      t.delivered,
      t.opened,
      t.open_count,
      t.first_opened_at,
      COALESCE(sc.candidate_name, ob.ob_name) AS candidate_name,
      COALESCE(sc.candidate_email, ob.ob_email) AS candidate_email,
      COALESCE(sc.position_applied, ob.ob_position) AS position_applied
    FROM rpa_email_messages m
    LEFT JOIN rpa_email_tracking t ON t.message_id = m.id
    LEFT JOIN rpa_shortlisted_candidates sc ON sc.id = m.shortlist_id
    LEFT JOIN LATERAL (
      SELECT sc2.candidate_name AS ob_name, sc2.candidate_email AS ob_email, sc2.position_applied AS ob_position
      FROM rpa_email_messages m2
      LEFT JOIN rpa_shortlisted_candidates sc2 ON sc2.id = m2.shortlist_id
      WHERE m2.conversation_id = m.conversation_id
        AND m2.direction = 'outbound'
        AND sc2.candidate_email IS NOT NULL
      ORDER BY m2.created_at ASC
      LIMIT 1
    ) ob ON true
    WHERE m.graph_message_id IS NOT NULL AND m.graph_message_id != 'undefined'
      AND m.conversation_id IS NOT NULL AND m.conversation_id != 'undefined'
      AND LOWER(COALESCE(sc.candidate_email, ob.ob_email)) = LOWER($1)
    ORDER BY COALESCE(m.sent_at, m.created_at) ASC
    LIMIT 500
  `;

  const messages = await prisma.$queryRawUnsafe(query, email);
  const threadMap = {};

  for (const msg of messages) {
    const ce = (msg.candidate_email || '').toLowerCase().trim();
    if (!ce) continue;
    const pos = (msg.position_applied || '').trim();
    const gk = ce + '|' + pos;

    if (!threadMap[gk]) {
      threadMap[gk] = {
        group_key: gk,
        candidate_name: msg.candidate_name || 'Candidate',
        candidate_email: ce,
        position: pos,
        last_activity: null,
        message_count: 0,
        messages: []
      };
    }

    const th = threadMap[gk];
    const ts = msg.sent_at || msg.created_at;
    const isOut = msg.direction === 'outbound';

    th.messages.push({
      id: msg.id ? msg.id.toString() : undefined,
      conversation_id: msg.conversation_id,
      direction: isOut ? 'outbound' : 'inbound',
      from_email: msg.from_email,
      from_name: msg.from_name,
      to_emails: msg.to_emails,
      subject: msg.subject,
      body_preview: msg.body_preview,
      body_html: msg.body_html,
      sent_at: ts,
      tracking: isOut ? {
        delivered: msg.delivered || false,
        opened: msg.opened || false,
        open_count: msg.open_count || 0,
        first_opened_at: msg.first_opened_at
      } : null
    });
    th.message_count++;
    if (!th.last_activity || new Date(ts) > new Date(th.last_activity)) {
      th.last_activity = ts;
    }
  }

  const threads = Object.values(threadMap)
    .map(t => {
      const convEarliest = {};
      for (const m of t.messages) {
        if (m.direction === 'outbound') {
          const mt = new Date(m.sent_at || 0).getTime();
          if (!convEarliest[m.conversation_id] || mt < convEarliest[m.conversation_id]) {
            convEarliest[m.conversation_id] = mt;
          }
        }
      }
      for (const m of t.messages) {
        if (!convEarliest[m.conversation_id]) {
          const mt = new Date(m.sent_at || 0).getTime();
          convEarliest[m.conversation_id] = mt;
        }
      }
      t.messages.sort((a, b) => {
        const ca = convEarliest[a.conversation_id] || 0;
        const cb = convEarliest[b.conversation_id] || 0;
        if (ca !== cb) return ca - cb;
        return new Date(a.sent_at) - new Date(b.sent_at);
      });
      return t;
    })
    .sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity));

  return { success: true, threads };
}

/**
 * Update candidate pipeline status in rpa_shortlisted_candidates.
 */
export async function updateCandidateStatus(candidateId, status) {
  const updated = await prisma.rpa_shortlisted_candidates.update({
    where: { id: candidateId },
    data: { pipeline_status: status }
  });

  return {
    ...updated,
    id: Number(updated.id),
    cv_id: updated.cv_id ? Number(updated.cv_id) : null,
    mrf_id: updated.mrf_id ? Number(updated.mrf_id) : null,
  };
}

