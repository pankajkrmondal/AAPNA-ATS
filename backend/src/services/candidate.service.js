import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { parseExperienceNumeric, parseExpectedCTCNumeric, parseNoticePeriodDays } from '../utils/candidateParser.js';
import { mapReferralFields } from '../utils/referralView.js';
import { preGenerateCandidateInsights } from './hrUpload.service.js';

/**
 * Candidate service.
 * Handles search, retrieval, and updates for the rpa_cv table.
 * Includes bi-directional mapping between camelCase API schema and legacy PascalCase DB schema.
 */

/**
 * Map database record to frontend candidate schema.
 * Handles BigInt conversions, JSON parsing for skills/company, and field mappings.
 * @param {Object} c - Database candidate record
 * @returns {Object|null}
 */
export function mapCandidate(c) {
  if (!c) return null;

  // Parse Top5KeySkills (which might be comma-separated or stored as JSON array)
  let skills = [];
  if (c.Top5KeySkills) {
    try {
      const trimmed = c.Top5KeySkills.trim();
      if (trimmed.startsWith('[')) {
        skills = JSON.parse(trimmed);
      } else {
        skills = trimmed.split(',').map(s => s.trim()).filter(Boolean);
      }
    } catch {
      skills = c.Top5KeySkills.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  // Parse score (ZekoInterviewScore or fallback to TechScore)
  let score = 0;
  if (c.ZekoInterviewScore !== null && c.ZekoInterviewScore !== undefined) {
    score = Math.round(Number(c.ZekoInterviewScore));
  } else if (c.TechScore) {
    score = Math.round(Number(c.TechScore)) || 0;
  }

  // Parse CurrentCompany JSON safely
  let currentCompanyObj = { Name: '', Website: '' };
  if (c.CurrentCompany) {
    try {
      const parsed = JSON.parse(c.CurrentCompany);
      if (parsed) {
        if (Array.isArray(parsed) && parsed.length > 0) {
          const item = parsed[0];
          currentCompanyObj = {
            Name: item.Name || item.name || '',
            Website: item.Website || item.website || '',
          };
        } else {
          currentCompanyObj = {
            Name: parsed.Name || parsed.name || '',
            Website: parsed.Website || parsed.website || '',
          };
        }
      }
    } catch {
      const ccStr = c.CurrentCompany;
      const nm = ccStr.match(/Name\s*[:=]\s*["']?([^"',}]+)/i);
      const wm = ccStr.match(/Website\s*[:=]\s*["']?([^"',}]+)/i);
      currentCompanyObj = {
        Name: nm ? nm[1].trim() : ccStr,
        Website: wm ? wm[1].trim() : '',
      };
    }
  }

  const summary = c.MetaData || '';

  return {
    id: c.id.toString(), // BigInt to string safe serialization
    name: c.Name || 'Unnamed Candidate',
    email: c.EmailID || '',
    phone: c.ContactNumber || '',
    location: c.CurrentLocation || '',
    position: c.PositionApplied || '',
    experience: c.TotalExperienceYears || '',
    status: c.statusActive || 'new',
    score: score || 0,
    skills,
    summary,
    education: c.HighestQualification || '',
    currentCompany: currentCompanyObj,
    noticePeriod: c.NoticePeriod || '',
    expectedCTC: c.ExpectedCTC_LPA || '', // Return raw value for forms
    currentCTC: c.CTC_LPA || '', // Return raw value for forms
    gender: c.Gender || '',
    englishCommunicationRating: c.EnglishCommunicationRating || '',
    reasonForJobChange: c.ReasonForJobChange || '',
    cvFileUrl: c.cvFileUrl || '',
    vendorEmail: c.VendorEmail || '',
    finalStatus: c.FinalStatus || '',
    createdAt: c.createdAt,
    modifiedAt: c.modifiedAt,
    resumeTextQuality: c.resume_text_quality || 'unknown',
    resumeTechnicalTerms: c.resume_technical_terms || [],
    resumeTermUpdatedAt: c.resume_term_updated_at || null,

    // Referral (P1). Internal to superadmin/admin/recruiter — never an
    // interviewer, never a vendor, never a dossier. When the caller is a vendor
    // these columns are not even SELECTed (see REFERRAL_COLUMNS below), so `c`
    // has no such keys and this maps to "not a referral" — the rule, and why it
    // has to fail closed, live in utils/referralView.js where they are testable
    // without a database.
    ...mapReferralFields(c),

    // Mapped fields for high fidelity modals
    lastCompanyExperience: c.LastCompanyExperienceYears || '',
    jobSource: c.JobSource || '',
    recruiterInfo: c.RecruiterInfoAAPNA || '',
    preferredShift: c.PreferredShift || '',
    willingToTakeOnlineTest: c.WillingToTakeOnlineTest || '',
    hasLaptopForInitialDays: c.HasLaptopForInitialDays || '',
    top5KeySkills: c.Top5KeySkills || '', // Return raw string for editing

    // Education section fields
    a10th: c.a10th || '',
    a12th: c.a12th || '',
    graduation: c.graduation || '',
    postGraduation: c.postGraduation || '',
    graduationdegree: c.graduationdegree || '',
    graduationspecialization: c.graduationspecialization || '',
    postgraduationdegree: c.postgraduationdegree || '',
    postgraduationspecialization: c.postgraduationspecialization || '',
    LinkedInProfile: c.LinkedInProfile || '',

    // Employment history fields
    employment_history: c.employment_history || { companies: [] },

    // Assessment & Interview fields
    Heat: c.Heat || '',
    HRQuickcomments: c.HRQuickcomments || '',
    IQScore: c.IQScore || '',
    TechScore: c.TechScore || '',
    ZekoInterviewScore: c.ZekoInterviewScore !== null && c.ZekoInterviewScore !== undefined ? c.ZekoInterviewScore.toString() : '',
    ZekoCodingScore: c.ZekoCodingScore !== null && c.ZekoCodingScore !== undefined ? c.ZekoCodingScore.toString() : '',
    ZekoCommunicationScore: c.ZekoCommunicationScore !== null && c.ZekoCommunicationScore !== undefined ? c.ZekoCommunicationScore.toString() : '',
    FinalStatus: c.FinalStatus || '',
    TechRoundOne: c.TechRoundOne || '',
    TechRoundTwo: c.TechRoundTwo || '',
    TechRoundThree: c.TechRoundThree || '',
    ManagerialOrCEOFeedback: c.ManagerialOrCEOFeedback || '',
    HRInterview: c.HRInterview || '',
  };
}

/**
 * Map frontend update payload to database candidate schema.
 * @param {Object} data - camelCase update fields
 * @returns {Object} PascalCase/DB fields
 */
export function unmapCandidate(data) {
  const c = {};
  if (data.name !== undefined) c.Name = data.name;
  if (data.email !== undefined) c.EmailID = data.email;
  if (data.phone !== undefined) c.ContactNumber = data.phone;
  if (data.location !== undefined) c.CurrentLocation = data.location;
  if (data.position !== undefined) c.PositionApplied = data.position;
  if (data.experience !== undefined) c.TotalExperienceYears = data.experience;
  if (data.status !== undefined) c.statusActive = data.status;
  if (data.education !== undefined) c.HighestQualification = data.education;
  if (data.noticePeriod !== undefined) c.NoticePeriod = data.noticePeriod;
  if (data.expectedCTC !== undefined) c.ExpectedCTC_LPA = data.expectedCTC;
  if (data.currentCTC !== undefined) c.CTC_LPA = data.currentCTC;
  if (data.gender !== undefined) c.Gender = data.gender;
  if (data.reasonForJobChange !== undefined) c.ReasonForJobChange = data.reasonForJobChange;
  if (data.cvFileUrl !== undefined) c.cvFileUrl = data.cvFileUrl;
  if (data.resumeTextQuality !== undefined) c.resume_text_quality = data.resumeTextQuality;
  if (data.resumeTechnicalTerms !== undefined) c.resume_technical_terms = data.resumeTechnicalTerms;
  if (data.resumeTermUpdatedAt !== undefined) c.resume_term_updated_at = data.resumeTermUpdatedAt;

  // Expose CurrentCompany serialization
  if (data.currentCompany !== undefined) {
    if (typeof data.currentCompany === 'object' && data.currentCompany !== null) {
      c.CurrentCompany = JSON.stringify({
        Name: data.currentCompany.Name || data.currentCompany.name || '',
        Website: data.currentCompany.Website || data.currentCompany.website || '',
      });
    } else {
      c.CurrentCompany = data.currentCompany;
    }
  }

  // Additional fields
  if (data.lastCompanyExperience !== undefined) c.LastCompanyExperienceYears = data.lastCompanyExperience;
  if (data.jobSource !== undefined) c.JobSource = data.jobSource;
  if (data.recruiterInfo !== undefined) c.RecruiterInfoAAPNA = data.recruiterInfo;
  if (data.englishCommunicationRating !== undefined) c.EnglishCommunicationRating = data.englishCommunicationRating;
  if (data.preferredShift !== undefined) c.PreferredShift = data.preferredShift;
  if (data.willingToTakeOnlineTest !== undefined) c.WillingToTakeOnlineTest = data.willingToTakeOnlineTest;
  if (data.hasLaptopForInitialDays !== undefined) c.HasLaptopForInitialDays = data.hasLaptopForInitialDays;
  if (data.top5KeySkills !== undefined) c.Top5KeySkills = data.top5KeySkills;

  // Education fields
  if (data.a10th !== undefined) c.a10th = data.a10th;
  if (data.a12th !== undefined) c.a12th = data.a12th;
  if (data.graduation !== undefined) c.graduation = data.graduation;
  if (data.postGraduation !== undefined) c.postGraduation = data.postGraduation;
  if (data.graduationdegree !== undefined) c.graduationdegree = data.graduationdegree;
  if (data.graduationspecialization !== undefined) c.graduationspecialization = data.graduationspecialization;
  if (data.postgraduationdegree !== undefined) c.postgraduationdegree = data.postgraduationdegree;
  if (data.postgraduationspecialization !== undefined) c.postgraduationspecialization = data.postgraduationspecialization;
  if (data.LinkedInProfile !== undefined) c.LinkedInProfile = data.LinkedInProfile;

  // Employment history JSON
  if (data.employment_history !== undefined) c.employment_history = data.employment_history;

  // Assessment & Interview fields
  if (data.Heat !== undefined) c.Heat = data.Heat;
  if (data.HRQuickcomments !== undefined) c.HRQuickcomments = data.HRQuickcomments;
  if (data.IQScore !== undefined) c.IQScore = data.IQScore;
  if (data.TechScore !== undefined) c.TechScore = data.TechScore;
  if (data.ZekoInterviewScore !== undefined) c.ZekoInterviewScore = data.ZekoInterviewScore ? parseFloat(data.ZekoInterviewScore) : null;
  if (data.ZekoCodingScore !== undefined) c.ZekoCodingScore = data.ZekoCodingScore ? parseFloat(data.ZekoCodingScore) : null;
  if (data.ZekoCommunicationScore !== undefined) c.ZekoCommunicationScore = data.ZekoCommunicationScore ? parseFloat(data.ZekoCommunicationScore) : null;
  if (data.FinalStatus !== undefined) c.FinalStatus = data.FinalStatus;
  if (data.TechRoundOne !== undefined) c.TechRoundOne = data.TechRoundOne;
  if (data.TechRoundTwo !== undefined) c.TechRoundTwo = data.TechRoundTwo;
  if (data.TechRoundThree !== undefined) c.TechRoundThree = data.TechRoundThree;
  if (data.ManagerialOrCEOFeedback !== undefined) c.ManagerialOrCEOFeedback = data.ManagerialOrCEOFeedback;
  if (data.HRInterview !== undefined) c.HRInterview = data.HRInterview;

  return c;
}

/**
 * Search candidates with pagination, filtering, and sorting.
 *
 * @param {Object} filters - Filter criteria
 * @param {string} [filters.search] - Free-text search across name, email, skills
 * @param {string} [filters.status] - Filter by statusActive
 * @param {string} [filters.finalStatus] - Filter by FinalStatus
 * @param {string} [filters.vendorEmail] - Filter by vendor
 * @param {string} [filters.position] - Filter by PositionApplied
 * @param {string} [filters.location] - Filter by CurrentLocation
 * @param {number} [page=1] - Page number (1-indexed)
 * @param {number} [limit=20] - Items per page
 * @param {string} [sort='createdAt'] - Sort field
 * @param {string} [order='desc'] - Sort order: 'asc' | 'desc'
 * @returns {Promise<{ data: Array, total: number }>}
 */
/**
 * The referral columns, as a Prisma `omit` fragment.
 *
 * Dropped from the QUERY for vendor callers rather than stripped from the
 * result: this endpoint returns nearly every rpa_cv column, so a field added to
 * mapCandidate() later would otherwise reach a vendor by default. Not selecting
 * them means there is nothing to forget to hide.
 */
const REFERRAL_COLUMNS = Object.freeze({
  is_referral: true,
  referred_by: true,
  referral_note: true,
  referral_set_by: true,
  referral_set_at: true,
});

export async function search(filters = {}, page = 1, limit = 20, sort = 'createdAt', order = 'desc', { redactReferral = false } = {}) {
  const where = buildWhereClause(filters);

  // Shared with the CSV export so both order rows identically.
  const dbSortField = resolveSortField(sort);

  const [data, total] = await Promise.all([
    prisma.rpa_cv.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [dbSortField]: order },
      // `rpa_cv` is ~80 columns wide and these two are by far the heaviest: the
      // full plain-text resume and the AI insights blob. A list page reads
      // neither — mapCandidate() ignores them, and the screening service pulls
      // them through its own raw queries — so shipping them made every page of
      // results far larger over the wire than the rows it actually renders.
      omit: {
        resume_full_text: true,
        ai_profile_insights: true,
        ...(redactReferral ? REFERRAL_COLUMNS : {}),
      },
    }),
    prisma.rpa_cv.count({ where }),
  ]);

  return {
    data: data.map(mapCandidate),
    total,
  };
}

/**
 * Build the candidate scope for vendor stats. With a vendorEmail → that vendor;
 * without one → ALL vendor-sourced candidates (VendorEmail set), for the recruiter's
 * "all vendors" overview.
 */
function vendorScopeWhere(vendorEmail) {
  if (vendorEmail) {
    return { VendorEmail: { equals: vendorEmail, mode: 'insensitive' } };
  }
  return { AND: [{ VendorEmail: { not: null } }, { VendorEmail: { not: '' } }] };
}

/**
 * The live pipeline journey for each of a set of candidates, keyed by cv_id.
 *
 * The Vendor Dashboard used to derive everything from `rpa_cv.FinalStatus` and
 * a client-side keyword matcher (`classifyStatus` in VendorDashboard.jsx), which
 * reads a string the stage engine writes back rather than the stage engine
 * itself — so it lagged, and could not distinguish "no journey yet" from
 * "journey with no outcome recorded".
 *
 * A candidate can hold several journeys (one per MRF, Q13/Q24). The most
 * recently touched one is the honest answer to "where are they now?" on a
 * per-candidate dashboard; the per-MRF breakdown lives on the Pipeline Tracker,
 * which is the screen built for it.
 *
 * @param {Array<bigint|number>} cvIds
 * @returns {Promise<Map<string, { stage_key: string, stage_status: string, stage_label: string|null, final_outcome: string|null }>>}
 */
export async function vendorPipelineByCvId(cvIds) {
  const byCv = new Map();
  if (!cvIds || cvIds.length === 0) return byCv;

  const [journeys, stages] = await Promise.all([
    prisma.rpa_candidate_pipeline.findMany({
      where: { cv_id: { in: cvIds.map((id) => BigInt(id)) } },
      orderBy: { modified_at: 'desc' },
      select: {
        cv_id: true,
        current_stage_key: true,
        current_stage_status: true,
        final_outcome: true,
      },
    }),
    prisma.rpa_pipeline_stages.findMany({ select: { stage_key: true, label: true } }),
  ]);

  const labelByKey = new Map(stages.map((s) => [s.stage_key, s.label]));
  for (const j of journeys) {
    const key = String(j.cv_id);
    if (byCv.has(key)) continue; // ordered desc — first hit is the most recent
    byCv.set(key, {
      stage_key: j.current_stage_key,
      stage_status: j.current_stage_status,
      stage_label: labelByKey.get(j.current_stage_key) || j.current_stage_key,
      final_outcome: j.final_outcome,
    });
  }
  return byCv;
}

/**
 * Attaches the real pipeline stage to a list of mapped candidates.
 *
 * Rows with no journey keep `stage: null` and are marked `stage_source:
 * 'legacy'`, which is the signal for the dashboard to fall back to
 * classifyStatus(FinalStatus). Candidates uploaded before the stage engine
 * existed will never have a journey, so the fallback is permanent, not
 * transitional.
 *
 * @param {Array<object>} candidates - already through mapCandidate()
 * @returns {Promise<Array<object>>}
 */
export async function attachPipelineStage(candidates) {
  if (!candidates || candidates.length === 0) return candidates || [];
  const byCv = await vendorPipelineByCvId(candidates.map((c) => c.id));
  return candidates.map((c) => {
    const journey = byCv.get(String(c.id));
    return journey
      ? { ...c, stage: journey, stage_source: 'pipeline' }
      : { ...c, stage: null, stage_source: 'legacy' };
  });
}

/**
 * Compute lifetime upload stats for a single vendor, or across all vendors when
 * vendorEmail is omitted.
 * @param {string} [vendorEmail] - Vendor email (exact, case-insensitive); omit for all vendors
 * @returns {Promise<{ total: number, withPosition: number, thisMonth: number }>}
 */
export async function vendorStats(vendorEmail) {
  const base = vendorScopeWhere(vendorEmail);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total, withPosition, thisMonth] = await Promise.all([
    prisma.rpa_cv.count({ where: base }),
    prisma.rpa_cv.count({
      where: { AND: [base, { PositionApplied: { not: null, notIn: [''] } }] },
    }),
    prisma.rpa_cv.count({
      where: { AND: [base, { createdAt: { gte: monthStart } }] },
    }),
  ]);

  return { total, withPosition, thisMonth };
}

/**
 * Status summary for the vendor dashboard. Scoped to one vendor when vendorEmail is
 * given, otherwise aggregated across all vendors (recruiter "all vendors" overview).
 * @param {string} [vendorEmail]
 * @returns {Promise<{ total: number, withPosition: number, thisMonth: number, byFinalStatus: Array<{ status: string, count: number }> }>}
 */
export async function vendorStatusSummary(vendorEmail) {
  const base = vendorScopeWhere(vendorEmail);

  const [stats, grouped, byStage] = await Promise.all([
    vendorStats(vendorEmail),
    prisma.rpa_cv.groupBy({
      by: ['FinalStatus'],
      where: base,
      _count: { _all: true },
    }),
    vendorStageBreakdown(base),
  ]);

  const byFinalStatus = grouped
    .map((g) => ({
      status: g.FinalStatus && g.FinalStatus.trim() !== '' ? g.FinalStatus : 'Awaiting Screening',
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  return { ...stats, byFinalStatus, byStage };
}

/**
 * Real stage counts for the vendor's candidates, straight from
 * rpa_candidate_pipeline — the M6 replacement for inferring a pipeline from
 * FinalStatus keyword matching.
 *
 * `untracked` is deliberately part of the result rather than dropped: it is the
 * count of vendor candidates with no journey at all, which is exactly the
 * population the dashboard's legacy fallback covers. Hiding it would make the
 * stage tiles silently under-count and look like data loss.
 *
 * @param {object} candidateWhere - the vendor scope from vendorScopeWhere()
 * @returns {Promise<{ stages: Array<{stage_key, stage_label, count}>, closed: number, untracked: number }>}
 */
async function vendorStageBreakdown(candidateWhere) {
  const [scopedCandidates, stages] = await Promise.all([
    prisma.rpa_cv.findMany({ where: candidateWhere, select: { id: true } }),
    prisma.rpa_pipeline_stages.findMany({
      where: { is_active: true },
      orderBy: { sort_order: 'asc' },
      select: { stage_key: true, label: true },
    }),
  ]);
  if (scopedCandidates.length === 0) return { stages: [], closed: 0, untracked: 0 };

  const byCv = await vendorPipelineByCvId(scopedCandidates.map((c) => c.id));

  const counts = new Map();
  let closed = 0;
  for (const journey of byCv.values()) {
    if (journey.final_outcome) { closed += 1; continue; }
    counts.set(journey.stage_key, (counts.get(journey.stage_key) || 0) + 1);
  }

  return {
    // Stage order comes from the admin-configured sort_order, so a stage added
    // through PipelineConfigPanel shows up here without a code change.
    stages: stages
      .map((s) => ({ stage_key: s.stage_key, stage_label: s.label, count: counts.get(s.stage_key) || 0 }))
      .filter((s) => s.count > 0),
    closed,
    untracked: scopedCandidates.length - byCv.size,
  };
}

/**
 * Find a single candidate by ID.
 * @param {number|string} id
 * @returns {Promise<Object>}
 * @throws {AppError} If not found
 */
export async function findById(id, { redactReferral = false } = {}) {
  const candidate = await prisma.rpa_cv.findUnique({
    where: { id: BigInt(id) },
    ...(redactReferral ? { omit: REFERRAL_COLUMNS } : {}),
  });

  if (!candidate) {
    throw new AppError('Candidate not found.', 404);
  }

  return mapCandidate(candidate);
}

/**
 * Update a candidate record.
 *
 * `actor` is the authenticated user, threaded through so an edit is attributable
 * in the log. It is deliberately NOT written to `last_action_by`: that column is
 * what dashboard.service.js groups on to count how many candidates each recruiter
 * ADDED, so stamping it on every edit would credit whoever last touched a record
 * with having sourced it. Editing is not adding.
 *
 * The referral fields are not settable here — unmapCandidate() is an allowlist
 * and does not map them. See referral.service.js for the one way in.
 *
 * @param {number|string} id
 * @param {Object} data - Fields to update
 * @param {Object} [actor] - The authenticated user (req.user), for attribution in the log
 * @returns {Promise<Object>} Updated candidate
 * @throws {AppError} If not found
 */
export async function update(id, data, actor = null) {
  // Verify existence first
  await findById(id);

  const dbData = unmapCandidate(data);

  if (dbData.TotalExperienceYears !== undefined) {
    dbData.TotalExperienceYearsNumeric = parseExperienceNumeric(dbData.TotalExperienceYears);
  }
  if (dbData.ExpectedCTC_LPA !== undefined) {
    dbData.ExpectedCTCNumeric = parseExpectedCTCNumeric(dbData.ExpectedCTC_LPA);
  }
  if (dbData.NoticePeriod !== undefined) {
    dbData.NoticePeriodDays = parseNoticePeriodDays(dbData.NoticePeriod);
  }

  const updated = await prisma.rpa_cv.update({
    where: { id: BigInt(id) },
    data: {
      ...dbData,
      modifiedAt: new Date(),
    },
  });

  logger.info(`Candidate ${id} updated`, {
    fields: Object.keys(dbData),
    by: actor?.username || actor?.email || 'unknown',
  });

  // Pre-generate AI insights in the background on update (fire-and-forget)
  setImmediate(async () => {
    try {
      logger.info(`Regenerating AI insights for manually updated candidate ${id}`);
      const aiInsights = await preGenerateCandidateInsights(updated);
      if (aiInsights) {
        await prisma.rpa_cv.update({
          where: { id: BigInt(id) },
          data: { ai_profile_insights: aiInsights }
        });
        logger.info(`Successfully regenerated and saved AI insights for candidate ${id}`);
      }
    } catch (err) {
      logger.error(`Failed to regenerate AI insights for updated candidate ${id}: ${err.message}`);
    }
  });

  return mapCandidate(updated);
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Build Prisma `where` clause from filter params.
 *
 * Every supplied filter is AND'ed, so each one can only ever narrow the result.
 * The name/email/phone trio stays OR'ed *with each other* inside its own group,
 * which is the legacy "search by any identifier" behaviour.
 *
 * Previously each group assigned onto a bare `where` object, so two filters
 * touching the same key silently clobbered one another — `search` overwrote the
 * name/email/phone `OR` entirely, and `filterPosition` and `position` fought
 * over `PositionApplied`. Combining a search term with a name filter therefore
 * dropped the name and returned MORE rows than asked for. Now they compose.
 *
 * @param {Object} filters
 * @returns {Object}
 */
export function buildWhereClause(filters = {}) {
  const and = [];

  // Legacy identifier search — any one of these may match.
  const identityOr = [];
  if (filters.email) {
    identityOr.push({ EmailID: { contains: filters.email, mode: 'insensitive' } });
  }
  if (filters.name) {
    identityOr.push({ Name: { contains: filters.name, mode: 'insensitive' } });
  }
  if (filters.phone) {
    identityOr.push({ ContactNumber: { contains: filters.phone, mode: 'insensitive' } });
  }
  if (identityOr.length > 0) {
    and.push({ OR: identityOr });
  }

  // Free-text search across the profile.
  if (filters.search) {
    and.push({
      OR: [
        { Name: { contains: filters.search, mode: 'insensitive' } },
        { EmailID: { contains: filters.search, mode: 'insensitive' } },
        { Top5KeySkills: { contains: filters.search, mode: 'insensitive' } },
        { CurrentCompany: { contains: filters.search, mode: 'insensitive' } },
      ],
    });
  }

  // Discrete field filters (mirror the n8n vendor "My Uploads" filterName/filterEmail/filterPosition).
  if (filters.filterName) {
    and.push({ Name: { contains: filters.filterName, mode: 'insensitive' } });
  }
  if (filters.filterEmail) {
    and.push({ EmailID: { contains: filters.filterEmail, mode: 'insensitive' } });
  }
  if (filters.filterPosition) {
    and.push({ PositionApplied: { contains: filters.filterPosition, mode: 'insensitive' } });
  }

  if (filters.status) {
    and.push({ statusActive: filters.status });
  }

  if (filters.finalStatus) {
    and.push({ FinalStatus: filters.finalStatus });
  }

  // Vendor isolation: exact (case-insensitive) match so a vendor only ever
  // sees their own uploads — matches the n8n `VendorEmail = <session email>` equality.
  // See enforceVendorScope(), which guarantees this is set for vendor callers.
  if (filters.vendorEmail) {
    and.push({ VendorEmail: { equals: filters.vendorEmail, mode: 'insensitive' } });
  }

  if (filters.position) {
    and.push({ PositionApplied: { contains: filters.position, mode: 'insensitive' } });
  }

  if (filters.location) {
    and.push({ CurrentLocation: { contains: filters.location, mode: 'insensitive' } });
  }

  // Restrict to all vendor-sourced candidates (recruiter "all vendors" overview).
  if (filters.vendorOnly) {
    and.push({ VendorEmail: { not: null } });
    and.push({ VendorEmail: { not: '' } });
  }

  return and.length > 0 ? { AND: and } : {};
}

/**
 * Re-exported from utils/vendorScope.js, where it now lives so it can be tested
 * without loading this service's database and socket dependencies. Callers
 * importing it from here continue to work unchanged.
 */
export { enforceVendorScope } from '../utils/vendorScope.js';

/**
 * Columns the CSV export renders. Deliberately narrow: `rpa_cv` is ~80 columns
 * wide and includes `resume_full_text`, `MetaData` and `ai_profile_insights`.
 * `search()` selects all of them, which is fine for a 20-row page and hundreds
 * of megabytes at the production row count — so the export must not reuse it.
 * Being an allowlist also means no unlisted column can ever leak into a file.
 */
export const EXPORT_SELECT = {
  id: true,
  Name: true,
  EmailID: true,
  ContactNumber: true,
  PositionApplied: true,
  Gender: true,
  CurrentLocation: true,
  TotalExperienceYears: true,
  LastCompanyExperienceYears: true,
  CurrentCompany: true,
  CTC_LPA: true,
  ExpectedCTC_LPA: true,
  NoticePeriod: true,
  HighestQualification: true,
  Top5KeySkills: true,
  EnglishCommunicationRating: true,
  PreferredShift: true,
  ReasonForJobChange: true,
  JobSource: true,
  RecruiterInfoAAPNA: true,
  VendorEmail: true,
  statusActive: true,
  FinalStatus: true,
  ZekoInterviewScore: true,
  LinkedInProfile: true,
  cvFileUrl: true,
  createdAt: true,
  modifiedAt: true,
};

/**
 * Map an API sort key onto a real column. Shared by search() and the export so
 * there is one mapping rather than two that can drift.
 * @param {string} sort
 * @returns {string}
 */
export function resolveSortField(sort) {
  if (sort === 'id') return 'id';
  if (sort === 'name') return 'Name';
  if (sort === 'email') return 'EmailID';
  if (sort === 'position') return 'PositionApplied';
  if (sort === 'modifiedAt') return 'modifiedAt';
  return 'createdAt';
}

/**
 * Every candidate matching the filters, unpaginated, for CSV export.
 * Same `where` as search() — only the pagination and the column set differ.
 *
 * @param {Object} filters
 * @param {{ sort?: string, order?: string, max?: number }} [options]
 * @returns {Promise<Array>}
 */
export async function findAllForExport(filters = {}, { sort = 'createdAt', order = 'desc', max } = {}) {
  const rows = await prisma.rpa_cv.findMany({
    where: buildWhereClause(filters),
    select: EXPORT_SELECT,
    orderBy: { [resolveSortField(sort)]: order === 'asc' ? 'asc' : 'desc' },
    take: max,
  });

  return rows.map(mapCandidate);
}
