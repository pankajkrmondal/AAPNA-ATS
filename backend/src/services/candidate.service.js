import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { parseExperienceNumeric, parseExpectedCTCNumeric, parseNoticePeriodDays } from '../utils/candidateParser.js';
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
    createdAt: c.createdAt,
    modifiedAt: c.modifiedAt,
    resumeTextQuality: c.resume_text_quality || 'unknown',
    resumeTechnicalTerms: c.resume_technical_terms || [],
    resumeTermUpdatedAt: c.resume_term_updated_at || null,

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
export async function search(filters = {}, page = 1, limit = 20, sort = 'createdAt', order = 'desc') {
  const where = buildWhereClause(filters);

  // Validate sort field exists on model
  const allowedSorts = ['id', 'Name', 'EmailID', 'PositionApplied', 'createdAt', 'modifiedAt'];
  let dbSortField = 'createdAt';
  if (sort === 'name') dbSortField = 'Name';
  else if (sort === 'email') dbSortField = 'EmailID';
  else if (sort === 'position') dbSortField = 'PositionApplied';
  else if (sort === 'modifiedAt') dbSortField = 'modifiedAt';
  
  if (!allowedSorts.includes(dbSortField)) {
    dbSortField = 'createdAt';
  }

  const [data, total] = await Promise.all([
    prisma.rpa_cv.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [dbSortField]: order },
    }),
    prisma.rpa_cv.count({ where }),
  ]);

  return {
    data: data.map(mapCandidate),
    total,
  };
}

/**
 * Find a single candidate by ID.
 * @param {number|string} id
 * @returns {Promise<Object>}
 * @throws {AppError} If not found
 */
export async function findById(id) {
  const candidate = await prisma.rpa_cv.findUnique({
    where: { id: BigInt(id) },
  });

  if (!candidate) {
    throw new AppError('Candidate not found.', 404);
  }

  return mapCandidate(candidate);
}

/**
 * Update a candidate record.
 * @param {number|string} id
 * @param {Object} data - Fields to update
 * @returns {Promise<Object>} Updated candidate
 * @throws {AppError} If not found
 */
export async function update(id, data) {
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

  logger.info(`Candidate ${id} updated`, { fields: Object.keys(dbData) });

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
 * Uses logical OR for name, email, and phone search criteria to align with legacy search functionality.
 * @param {Object} filters
 * @returns {Object}
 */
function buildWhereClause(filters) {
  const where = {};

  const orConditions = [];
  if (filters.email) {
    orConditions.push({ EmailID: { contains: filters.email, mode: 'insensitive' } });
  }
  if (filters.name) {
    orConditions.push({ Name: { contains: filters.name, mode: 'insensitive' } });
  }
  if (filters.phone) {
    orConditions.push({ ContactNumber: { contains: filters.phone, mode: 'insensitive' } });
  }

  if (orConditions.length > 0) {
    where.OR = orConditions;
  }

  if (filters.search) {
    where.OR = [
      { Name: { contains: filters.search, mode: 'insensitive' } },
      { EmailID: { contains: filters.search, mode: 'insensitive' } },
      { Top5KeySkills: { contains: filters.search, mode: 'insensitive' } },
      { CurrentCompany: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  if (filters.status) {
    where.statusActive = filters.status;
  }

  if (filters.finalStatus) {
    where.FinalStatus = filters.finalStatus;
  }

  if (filters.vendorEmail) {
    where.VendorEmail = { contains: filters.vendorEmail, mode: 'insensitive' };
  }

  if (filters.position) {
    where.PositionApplied = { contains: filters.position, mode: 'insensitive' };
  }

  if (filters.location) {
    where.CurrentLocation = { contains: filters.location, mode: 'insensitive' };
  }

  return where;
}
