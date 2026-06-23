import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import mammoth from 'mammoth';
import XLSX from 'xlsx';
import { GoogleGenerativeAI } from '@google/generative-ai';

import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError, { AIModelError } from '../utils/AppError.js';
import config from '../config/index.js';
import * as onedriveService from './onedrive.service.js';
import { saveCandidateVector } from './vectorStore.service.js';
import { generateContentWithFallback } from '../utils/geminiHelper.js';
import { parseExperienceNumeric, parseExpectedCTCNumeric, parseNoticePeriodDays } from '../utils/candidateParser.js';
import {
  sendWelcomeEmail,
  sendMissingDataEmail,
  sendEmailIdNullAlert,
  sendDuplicateAlertEmail,
  sendSameVendorDuplicateAlert,
  sendDifferentVendorDuplicateAlert,
  sendResumeErrorAlert
} from './emailNotification.service.js';
import { setJobStatus, JOB_STATUS, updateJobByCvTmpId, jobsModelReady } from './uploadJob.service.js';

// Shared fields between rpa_cv_tmp and rpa_cv
const CV_SHARED_FIELDS = [
  'Name', 'NoticePeriod', 'ContactNumber', 'EmailID',
  'HighestQualification', 'TotalExperienceYears', 'LastCompanyExperienceYears',
  'CurrentLocation', 'CTC_LPA', 'ExpectedCTC_LPA', 'JobSource',
  'RecruiterInfoAAPNA', 'PositionApplied', 'Top5KeySkills', 'CurrentCompany',
  'Gender', 'EnglishCommunicationRating', 'PreferredShift',
  'ReasonForJobChange', 'WillingToTakeOnlineTest', 'HasLaptopForInitialDays',
  'EducationalScoresPercentage', 'LinkedInProfile', 'MetaData',
  'statusActive', 'missingData', 'cvMissingToken', 'cvMissingTokenStatus',
  'vendorName', 'lockForNinetyDays', 'VendorEmail',
  'a10th', 'a12th', 'graduation', 'postGraduation',
  'Heat', 'HRQuickcomments', 'IQScore', 'TechScore',
  'FinalStatus', 'TechRoundOne', 'TechRoundTwo', 'TechRoundThree',
  'ManagerialOrCEOFeedback', 'HRInterview',
  'ZekoInterviewScore', 'ZekoCodingScore', 'ZekoCommunicationScore',
  'graduationdegree', 'graduationspecialization',
  'postgraduationdegree', 'postgraduationspecialization',
  'employment_history', 'cvVectorLock', 'cvFileUrl',
  'resume_full_text', 'resume_text_quality', 'resume_technical_terms', 'resume_term_updated_at'
];

// Initialize Google Gemini info log
if (config.gemini.apiKey) {
  logger.info(`Google Gemini AI initialized using model: ${config.gemini.model}`);
} else {
  logger.warn('Google Gemini API Key is not configured. Resume parsing will fall back to simulation heuristics.');
}

/**
 * Safely convert BigInt or Decimal to standard numbers/JSON values.
 */
function serializeRecord(record) {
  if (!record) return null;
  const copy = { ...record };
  if (copy.id !== undefined && copy.id !== null) {
    copy.id = Number(copy.id);
  }
  // Decimal fields
  if (copy.ZekoInterviewScore !== undefined && copy.ZekoInterviewScore !== null) {
    copy.ZekoInterviewScore = Number(copy.ZekoInterviewScore);
  }
  if (copy.ZekoCodingScore !== undefined && copy.ZekoCodingScore !== null) {
    copy.ZekoCodingScore = Number(copy.ZekoCodingScore);
  }
  if (copy.ZekoCommunicationScore !== undefined && copy.ZekoCommunicationScore !== null) {
    copy.ZekoCommunicationScore = Number(copy.ZekoCommunicationScore);
  }
  return copy;
}

/**
 * Extract text from PDF / DOCX / XLSX files.
 */
export async function extractTextFromFile(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  
  if (ext === '.pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    const uint8Array = new Uint8Array(dataBuffer);
    const pdfFn = typeof pdf === 'function' ? pdf : (pdf.default || pdf);
    
    if (typeof pdfFn === 'function') {
      const data = await pdfFn(dataBuffer);
      return data.text || '';
    } else if (pdf.PDFParse) {
      const pdfParseInstance = new pdf.PDFParse(uint8Array);
      const textResult = await pdfParseInstance.getText();
      return textResult.text || '';
    }
    throw new Error('PDF-parse package structure is unsupported.');
  }
  
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  }
  
  if (ext === '.doc') {
    throw new Error('.doc format not supported. Please convert to .docx or .pdf.');
  }

  if (ext === '.xlsx' || ext === '.xls') {
    throw new Error('.xlsx/.xls format not supported for direct text parsing.');
  }

  throw new Error(`Unsupported file extension: ${ext}`);
}

/**
 * Parse email and name from filename (fallback heuristic).
 */
function parseResumeDetails(filePath, originalName, extractedText = '') {
  let email = null;
  let name = null;

  const segments = originalName.split(/[_\s-]+/);
  let emailSegment = null;
  
  for (const segment of segments) {
    const cleanSegment = segment.replace(/\.[^/.]+$/, "");
    if (cleanSegment.includes('@') && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(cleanSegment)) {
      email = cleanSegment.toLowerCase();
      emailSegment = segment;
      break;
    }
  }

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  if (!email && extractedText) {
    const fileEmails = extractedText.match(emailRegex);
    if (fileEmails && fileEmails.length > 0) {
      email = fileEmails[0].toLowerCase();
    }
  }

  if (!email && fs.existsSync(filePath)) {
    try {
      const buffer = fs.readFileSync(filePath);
      const text = buffer.toString('utf-8', 0, Math.min(buffer.length, 102400));
      const fileEmails = text.match(emailRegex);
      if (fileEmails && fileEmails.length > 0) {
        email = fileEmails[0].toLowerCase();
      }
    } catch (err) {
      logger.error('Error scanning file buffer for email', { error: err.message });
    }
  }

  const filteredSegments = segments.filter(seg => {
    if (seg === emailSegment) return false;
    const clean = seg.replace(/\.[^/.]+$/, "").toLowerCase();
    return !['resume', 'cv', 'updated', 'new', 'draft', 'aapna', 'copy'].includes(clean);
  });

  let cleanName = filteredSegments
    .map(seg => seg.replace(/\.[^/.]+$/, ""))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const toTitleCase = (str) =>
    str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());

  if (cleanName.length > 1) {
    name = toTitleCase(cleanName);
  } else {
    name = "Candidate";
  }

  if (!email) {
    const randomHash = Math.random().toString(36).substring(2, 8);
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    email = `${sanitizedName || "candidate"}.${randomHash}@example.com`;
  }

  return { email: email.toLowerCase(), name };
}

/**
 * Call Google Gemini API to parse the resume text.
 */
/**
 * Call OpenRouter / Google Gemini API to parse the resume text.
 */
export async function parseResumeWithOpenRouter(text, originalName, vendorEmail, vendorName) {
  const prompt = `You are a strict JSON resume parser.
Rules (IMPORTANT):
1. Return ONLY valid JSON matching the schema below.
2. Do NOT add explanations, markdown, or comments.
3. Follow the schema exactly.
4. If a value is not mentioned in the resume, assign it as null.
5. EmailID must be treated as a unique identifier and returned as "unique_key".
6. If VendorEmail or VendorName is already provided below and is not empty, you MUST use it as-is and MUST NOT override it from resume text.

Input Details:
- Original File Name: ${originalName}
- Vendor Email (if provided): ${vendorEmail || 'null'}
- Vendor Name (if provided): ${vendorName || 'null'}

Schema:
- Name (string)
- NoticePeriod (string, e.g. "15 Days" or "Immediate" or "3 Months" or "0")
- ContactNumber (string, supports multiple comma-separated numbers)
- EmailID (string)
- HighestQualification (string)
- TotalExperienceYears (string, e.g. "5.5" or "3" or "Fresher")
- LastCompanyExperienceYears (string, e.g. "5.5" or "3" or "Fresher")
- CurrentLocation (string)
- CTC_LPA (string, e.g. "12" or "12.5" or "1500000")
- ExpectedCTC_LPA (string, e.g. "12" or "12.5" or "1500000")
- JobSource (string)
- RecruiterInfoAAPNA (string)
- PositionApplied (string)
- Top5KeySkills (array of strings, e.g. ["Java", "Spring Boot"])
- CurrentCompany (string, company name or null)
- Gender (string, e.g. "Male", "Female", "Other" or null)
- EnglishCommunicationRating (string, rate from 1 to 5, e.g. "3" or "4" or null)
- PreferredShift (string, e.g. "2pm - 11pm/3pm - 12am" or "4pm - 1am" or null)
- ReasonForJobChange (string)
- WillingToTakeOnlineTest (string, e.g. "Yes", "No", or null)
- HasLaptopForInitialDays (string, e.g. "Yes", "No", or null)
- EducationalScoresPercentage:
    - 10th (string or null)
    - 12th (string or null)
    - Graduation (string or null)
    - PostGraduation (string or null)
- LinkedInProfile (string)
- unique_key (string, always use the candidate's email address here)
- VendorEmail (string)
- VendorName (string)
- Heat (string)
- HRQuickcomments (string)
- IQScore (string)
- TechScore (string)
- FinalStatus (string)
- TechRoundOne (string)
- TechRoundTwo (string)
- TechRoundThree (string)
- ManagerialOrCEOFeedback (string)
- HRInterview (string)
- EmploymentHistory (array of objects):
    - CompanyName
    - StartDate (string exactly as mentioned in resume, e.g. "06/2022" or "June 2022")
    - EndDate (string exactly as mentioned in resume, e.g. "Present" or "02/2025")
- GraduationDegree
- GraduationSpecialization
- PostGraduationDegree
- PostGraduationSpecialization
- ResumeTechnicalTerms (array of strings, max 15): Return named technical tools, platforms, languages, frameworks, databases, software products, and methodologies that a recruiter would search for. STRICT INCLUSION – ONLY extract items that are explicitly written. Do not infer. No parent projects. No counts. Example: ["React", "PostgreSQL", "AWS", "Docker", "Google Analytics"].

Resume text content:
---
${text}
---
`;

  try {
    const rawText = await generateContentWithFallback(prompt, {
      generationConfig: { responseMimeType: 'application/json' }
    });
    
    const startIdx = rawText.indexOf('{');
    const endIdx = rawText.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1) {
      throw new Error('No JSON found in LLM output');
    }
    
    const jsonStr = rawText.slice(startIdx, endIdx + 1);
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new AIModelError(err.message);
  }
}

/**
 * Date parse helper
 */
function parseDate(value) {
  if (!value) return null;
  const v = String(value).toLowerCase().trim();
  if (['present','current','till date','now'].some(k => v.includes(k))) return new Date();
  
  // MM/YYYY or MM-YYYY
  let m = v.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (m) return new Date(Number(m[2]), Number(m[1]) - 1, 1);
  
  // YYYY/MM or YYYY-MM
  m = v.match(/^(\d{4})[\/\-](\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1);
  
  // Month Name YYYY
  m = v.match(/^([a-z]{3,})\s(\d{4})$/);
  if (m) return new Date(m[1] + ' 1, ' + m[2]);
  
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

/**
 * Months between helper
 */
function monthsBetween(start, end) {
  if (!start || !end) return 0;
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

/**
 * Calculate candidate experience from employment history.
 */
function calculateExperience(employmentHistory) {
  const history = Array.isArray(employmentHistory) ? employmentHistory : [];
  let totalMonths = 0;
  let lastCompanyMonths = 0;
  
  history.forEach((job, index) => {
    const start = parseDate(job.StartDate);
    const end = parseDate(job.EndDate);
    const months = monthsBetween(start, end);
    if (months > 0) {
      totalMonths += months;
      if (index === 0) {
        lastCompanyMonths = months;
      }
    }
  });
  
  return {
    totalExperienceYears: history.length > 0 ? (totalMonths / 12).toFixed(2) : null,
    lastCompanyExperienceYears: history.length > 0 ? (lastCompanyMonths / 12).toFixed(2) : null
  };
}

/**
 * Compute missing data fields matching n8n constraints.
 */
function getMissingFields(parsed) {
  const missing = {};
  
  // Determine if candidate is a Post-Graduate (PG) based on HighestQualification
  const qual = String(parsed.HighestQualification || '').toLowerCase().replace(/\./g, '');
  const pgKeywords = ['mtech', 'mca', 'mba', 'msc', 'me', 'ms', 'pgdm', 'post graduation', 'post graduate', 'master', 'pg'];
  const isPG = pgKeywords.some(k => qual.includes(k));

  const keysToCheck = [
    'Name',
    'NoticePeriod',
    'ContactNumber',
    'EmailID',
    'HighestQualification',
    'TotalExperienceYears',
    'LastCompanyExperienceYears',
    'CurrentLocation',
    'CTC_LPA',
    'ExpectedCTC_LPA',
    'JobSource',
    'RecruiterInfoAAPNA',
    'PositionApplied',
    'Top5KeySkills',
    'CurrentCompany',
    'Gender',
    'EnglishCommunicationRating',
    'graduationdegree',
    'graduationspecialization',
    'postgraduationdegree',
    'postgraduationspecialization'
  ];

  keysToCheck.forEach(key => {
    // Skip PG fields if candidate is NOT a PG candidate
    if (!isPG && (key === 'postgraduationdegree' || key === 'postgraduationspecialization')) {
      return;
    }

    // Mapping for CamelCase support
    const mapping = {
      'graduationdegree': 'GraduationDegree',
      'graduationspecialization': 'GraduationSpecialization',
      'postgraduationdegree': 'PostGraduationDegree',
      'postgraduationspecialization': 'PostGraduationSpecialization'
    };

    const camelKey = mapping[key] || (key.charAt(0).toUpperCase() + key.slice(1));
    const v = parsed[key] !== undefined ? parsed[key] : parsed[camelKey];

    // Normalize the key in the parsed object for DB compatibility
    if (parsed[key] === undefined && parsed[camelKey] !== undefined) {
      parsed[key] = parsed[camelKey];
    }

    if (
      v === undefined ||
      v === null ||
      v === '' ||
      v === 'Null' ||
      v === 'null' ||
      (Array.isArray(v) && v.length === 0)
    ) {
      missing[key] = 'Null';
    }
  });

  const edu = parsed.EducationalScoresPercentage || {};
  if (!edu['10th'] || edu['10th'] === '' || edu['10th'] === 'Null') {
    missing['10th (in percentage)'] = 'Null';
  }
  if (!edu['12th'] || edu['12th'] === '' || edu['12th'] === 'Null') {
    missing['12th (in percentage)'] = 'Null';
  }
  if (!edu['Graduation'] || edu['Graduation'] === '' || edu['Graduation'] === 'Null') {
    missing['Graduation (in percentage)'] = 'Null';
  }
  
  // Only validate PG score if candidate is a Post-Graduate
  if (isPG) {
    const pgScore = edu['PostGraduation'];
    if (!pgScore || pgScore === '' || pgScore === 'Null') {
      missing['PostGraduation (in percentage)'] = 'Null';
    }
  }

  const otherKeys = [
    'PreferredShift',
    'ReasonForJobChange',
    'WillingToTakeOnlineTest',
    'HasLaptopForInitialDays',
    'LinkedInProfile'
  ];
  
  otherKeys.forEach(key => {
    const v = parsed[key];
    if (
      v === undefined ||
      v === null ||
      v === '' ||
      v === 'Null' ||
      v === 'null' ||
      (Array.isArray(v) && v.length === 0)
    ) {
      missing[key] = 'Null';
    }
  });

  return missing;
}

/**
 * Service methods
 */

export async function searchDuplicates({ filterName, filterEmail, page = 1, perPage = 5 }) {
  const pageNum = Math.max(1, page);
  const limitNum = Math.max(1, perPage);
  const skip = (pageNum - 1) * limitNum;

  const where = {};
  if (filterName) {
    where.Name = { contains: filterName, mode: 'insensitive' };
  }
  if (filterEmail) {
    where.EmailID = { contains: filterEmail, mode: 'insensitive' };
  }

  const [data, total] = await Promise.all([
    prisma.rpa_cv_tmp.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
      skip,
      take: limitNum,
    }),
    prisma.rpa_cv_tmp.count({ where }),
  ]);

  return {
    data: data.map(serializeRecord),
    total,
    page: pageNum,
    perPage: limitNum,
  };
}

// Helper: append unique comma-separated values (used for ContactNumber & EmailID)
function appendUnique(existing, newValue) {
  const existingStr = existing ? String(existing).trim() : '';
  const newStr = newValue ? String(newValue).trim() : '';

  if (existingStr === '') return newStr;
  if (newStr === '' || newStr.toLowerCase() === 'null') return existingStr;

  const existingValues = existingStr.split(',').map(v => v.trim()).filter(v => v !== '' && v.toLowerCase() !== 'null');
  const newValues = newStr.split(',').map(v => v.trim()).filter(v => v !== '' && v.toLowerCase() !== 'null');

  for (const val of newValues) {
    if (!existingValues.some(ev => ev.toLowerCase() === val.toLowerCase())) {
      existingValues.push(val);
    }
  }

  return existingValues.join(', ');
}

// Helper: prefer newly parsed value; fall back to existing DB value only when parsed is null/empty/literal "null"
function prefer(parsedVal, existingVal) {
  if (parsedVal !== null && parsedVal !== undefined) {
    const s = String(parsedVal).trim();
    if (s !== '' && s.toLowerCase() !== 'null') {
      return parsedVal;
    }
  }
  return existingVal;
}

// Helper: check if a JSON value is empty (null, undefined, empty array or empty object)
function isJsonEmpty(val) {
  if (val === null || val === undefined) return true;
  if (Array.isArray(val) && val.length === 0) return true;
  if (typeof val === 'object' && Object.keys(val).length === 0) return true;
  return false;
}

export async function mergeDuplicates(ids, token, user = {}) {
  const hrEmail = user.email || 'unknown@hr.com';
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError('An array of IDs is required for merge.', 400);
  }

  logger.info(`Starting synchronous database merge for ${ids.length} candidates.`);
  const results = [];
  const postMergeTasks = [];

  try {
    await prisma.$transaction(async (tx) => {
      for (const tempId of ids) {
        // 1) Fetch candidate from rpa_cv_tmp
        const tempCandidate = await tx.rpa_cv_tmp.findUnique({
          where: { id: BigInt(tempId) }
        });

        if (!tempCandidate) {
          throw new Error(`Temporary candidate with ID ${tempId} not found in queue.`);
        }

        // 2) Search for matching candidate in rpa_cv (by ContactNumber and EmailID arrays intersection)
        const cleanContactNumbers = (tempCandidate.ContactNumber || '')
          .split(',')
          .map(num => num.replace(/\s+/g, ''))
          .filter(num => num.length > 0);

        const cleanEmails = (tempCandidate.EmailID || '')
          .split(',')
          .map(email => email.trim().toLowerCase())
          .filter(email => email.length > 0);

        let existingCandidate = null;
        if (cleanContactNumbers.length > 0 || cleanEmails.length > 0) {
          const matches = await tx.$queryRaw`
            SELECT id FROM public.rpa_cv
            WHERE
              (
                coalesce(cardinality(${cleanContactNumbers}::text[]), 0) > 0 AND
                string_to_array(replace(coalesce("ContactNumber", ''), ' ', ''), ',') && ${cleanContactNumbers}::text[]
              ) OR (
                coalesce(cardinality(${cleanEmails}::text[]), 0) > 0 AND
                string_to_array(lower(replace(coalesce("EmailID", ''), ' ', '')), ',') && ${cleanEmails}::text[]
              )
            LIMIT 1
          `;
          if (matches && matches.length > 0) {
            const matchId = matches[0].id;
            existingCandidate = await tx.rpa_cv.findUnique({
              where: { id: matchId }
            });
          }
        }

        // 3) Merge fields
        if (existingCandidate) {
          const updateData = {};
          for (const field of CV_SHARED_FIELDS) {
            if (field === 'ContactNumber') {
              updateData.ContactNumber = appendUnique(existingCandidate.ContactNumber, tempCandidate.ContactNumber);
            } else if (field === 'EmailID') {
              updateData.EmailID = appendUnique(existingCandidate.EmailID, tempCandidate.EmailID);
            } else if (field === 'employment_history') {
              updateData.employment_history = !isJsonEmpty(tempCandidate.employment_history)
                ? tempCandidate.employment_history
                : existingCandidate.employment_history;
            } else {
              updateData[field] = prefer(tempCandidate[field], existingCandidate[field]);
            }
          }
          updateData.modifiedAt = new Date();
          updateData.TotalExperienceYearsNumeric = parseExperienceNumeric(updateData.TotalExperienceYears);
          updateData.ExpectedCTCNumeric = parseExpectedCTCNumeric(updateData.ExpectedCTC_LPA);
          updateData.NoticePeriodDays = parseNoticePeriodDays(updateData.NoticePeriod);

          // Update candidate in rpa_cv
          await tx.rpa_cv.update({
            where: { id: existingCandidate.id },
            data: updateData
          });
          logger.info(`Candidate "${tempCandidate.Name || tempCandidate.EmailID}" merged: updated existing candidate ID ${existingCandidate.id}`);
          
          postMergeTasks.push({
            id: existingCandidate.id,
            tempId,
            data: updateData
          });
        } else {
          // No match found - insert new candidate
          const insertData = {};
          for (const field of CV_SHARED_FIELDS) {
            insertData[field] = tempCandidate[field];
          }
          insertData.createdAt = tempCandidate.createdAt || new Date();
          insertData.modifiedAt = new Date();
          insertData.TotalExperienceYearsNumeric = parseExperienceNumeric(insertData.TotalExperienceYears);
          insertData.ExpectedCTCNumeric = parseExpectedCTCNumeric(insertData.ExpectedCTC_LPA);
          insertData.NoticePeriodDays = parseNoticePeriodDays(insertData.NoticePeriod);

          const newCv = await tx.rpa_cv.create({
            data: insertData
          });
          logger.info(`Candidate "${tempCandidate.Name || tempCandidate.EmailID}" merged: created new candidate ID ${newCv.id}`);
          
          postMergeTasks.push({
            id: newCv.id,
            tempId,
            data: insertData
          });
        }

        // 4) Delete from rpa_cv_tmp
        await tx.rpa_cv_tmp.delete({
          where: { id: tempCandidate.id }
        });

        // 5) Log to rpa_processing_log
        const fileName = tempCandidate.Name ? `${tempCandidate.Name}_Resume.pdf` : 'candidate_resume.pdf';
        await tx.rpa_processing_log.create({
          data: {
            fileName: fileName,
            source: 'HR_APPROVED_MERGE',
            status: 'merged',
            logMessage: `HR duplicate approved and merged into rpa_cv by admin. Tmp ID: ${tempCandidate.id}`,
            createdAt: new Date()
          }
        });

        results.push(tempId.toString());
      }
    });

    // Run post-merge tasks outside transaction to prevent holding locks during Gemini API calls
    for (const task of postMergeTasks) {
      try {
        const metadata = await saveCandidateVector(task.id, task.data);
        
        let lockForNinetyDays = null;
        const vendorName = task.data.vendorName || null;
        const vendorEmail = task.data.VendorEmail || null;
        if (vendorName && vendorEmail) {
          const date = new Date();
          date.setDate(date.getDate() + 90);
          lockForNinetyDays = date.toISOString().split('T')[0];
        }

        // Pre-generate AI profile insights post-merge
        let aiInsights = null;
        try {
          const candidateDbObj = await prisma.rpa_cv.findUnique({ where: { id: BigInt(task.id) } });
          if (candidateDbObj) {
            aiInsights = await preGenerateCandidateInsights(candidateDbObj);
          }
        } catch (aiErr) {
          logger.warn(`Failed to pre-generate AI insights for merged candidate ${task.id}: ${aiErr.message}`);
        }

        const updatedCv = await prisma.rpa_cv.update({
          where: { id: BigInt(task.id) },
          data: {
            MetaData: metadata ? JSON.stringify(metadata) : '',
            lockForNinetyDays,
            ai_profile_insights: aiInsights
          }
        });

        // Send welcome and missing data emails post-merge
        try {
          const candidateObj = {
            id: Number(task.id),
            Name: updatedCv.Name || task.data.Name || 'Candidate',
            EmailID: updatedCv.EmailID || task.data.EmailID || ''
          };
          
          await sendWelcomeEmail(candidateObj, hrEmail);
          
          const missingFields = updatedCv.missingData ? JSON.parse(updatedCv.missingData) : {};
          if (Object.keys(missingFields).length > 0) {
            await sendMissingDataEmail(candidateObj, hrEmail);
          }
        } catch (mailErr) {
          logger.error(`Failed to send candidate email notifications during merge: ${mailErr.message}`);
        }

        // Resolve the review: the job becomes "Saved to Database", unless the merged
        // candidate still has missing fields (a missing-data email was sent) — then it
        // waits as "Awaiting Candidate Details" until the candidate submits them.
        if (task.tempId != null) {
          let mergedMissing = {};
          try {
            mergedMissing = updatedCv.missingData ? JSON.parse(updatedCv.missingData) : {};
          } catch { mergedMissing = {}; }
          const mergedStatus = Object.keys(mergedMissing).length > 0
            ? JOB_STATUS.MISSING_INFORMATION
            : JOB_STATUS.COMPLETED;
          await updateJobByCvTmpId(task.tempId, {
            status: mergedStatus,
            action_required: false,
            cv_id: task.id,
          }).catch((e) => logger.warn(`Failed to flip job after merge: ${e.message}`));
        }
      } catch (err) {
        logger.error(`Failed to update vector/lock info for candidate ${task.id}: ${err.message}`);
      }
    }

    // 6) Asynchronously trigger the n8n merge webhook in the background if configured
    const prefix = config.n8nWebhookUrlPrefix;
    if (prefix) {
      const url = `${prefix}/webhook/hr-upload/merge/staging`;
      logger.info(`Triggering background n8n merge webhook (asynchronous/best-effort) via: ${url}`);
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, token })
      }).catch(err => {
        logger.warn(`Background n8n merge webhook call failed: ${err.message}`);
      });
    } else {
      logger.info('Skipping background n8n merge webhook trigger (n8nWebhookUrlPrefix is not configured).');
    }

    return {
      success: true,
      message: 'Successfully merged all selected duplicate candidate(s).',
      mergedIds: results
    };
  } catch (err) {
    logger.error('Error during candidate merge transaction:', { error: err.message });
    throw new AppError(`Merge operation failed: ${err.message}`, 500);
  }
}

export async function deleteDuplicates(ids, token) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError('An array of IDs is required for delete.', 400);
  }

  logger.info(`Starting synchronous database deletion for ${ids.length} candidates from rpa_cv_tmp.`);

  try {
    const bigIntIds = ids.map(id => BigInt(id));

    // Audit each cancellation and flip the originating upload job(s) to Cancelled
    // before the staging rows are removed.
    for (const id of bigIntIds) {
      const tmp = await prisma.rpa_cv_tmp.findUnique({ where: { id } });
      await prisma.rpa_processing_log.create({
        data: {
          fileName: tmp?.Name ? `${tmp.Name}_Resume.pdf` : 'candidate_resume.pdf',
          source: 'REVIEW_CANCELLED',
          status: 'cancelled',
          logMessage: `Recruiter cancelled/rejected duplicate review. Tmp ID: ${id}` +
            (tmp?.VendorEmail ? ` (vendor: ${tmp.VendorEmail})` : ''),
          createdAt: new Date(),
        },
      }).catch((e) => logger.warn(`Failed to write cancel audit log: ${e.message}`));

      await updateJobByCvTmpId(id, {
        status: JOB_STATUS.CANCELLED,
        action_required: false,
      }).catch((e) => logger.warn(`Failed to flip job to Cancelled: ${e.message}`));
    }

    const deleteResult = await prisma.rpa_cv_tmp.deleteMany({
      where: {
        id: { in: bigIntIds }
      }
    });

    logger.info(`Successfully deleted ${deleteResult.count} candidates from rpa_cv_tmp.`);

    // Asynchronously trigger the n8n delete webhook in the background if configured
    const prefix = config.n8nWebhookUrlPrefix;
    if (prefix) {
      const url = `${prefix}/webhook/hr-upload/delete/staging`;
      logger.info(`Triggering background n8n delete webhook (asynchronous/best-effort) via: ${url}`);
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, token })
      }).catch(err => {
        logger.warn(`Background n8n delete webhook call failed: ${err.message}`);
      });
    } else {
      logger.info('Skipping background n8n delete webhook trigger (n8nWebhookUrlPrefix is not configured).');
    }

    return {
      success: true,
      message: `${deleteResult.count} candidate(s) permanently removed from the review queue.`,
      deletedCount: deleteResult.count
    };
  } catch (err) {
    logger.error('Error during candidate deletion:', { error: err.message });
    throw new AppError(`Delete operation failed: ${err.message}`, 500);
  }
}

export async function getUploadSummary(executionId) {
  const batchSummary = await prisma.rpa_upload_batch_summary.findUnique({
    where: { execution_id: executionId }
  });

  if (!batchSummary) {
    throw new AppError(`Batch with execution ID ${executionId} not found`, 404);
  }

  const logs = await prisma.rpa_upload_log.findMany({
    where: { execution_id: executionId },
    orderBy: { processed_at: 'asc' }
  });

  const files = logs.map(log => {
    let detail = 'Pending processing...';
    if (log.status === 'success' || log.status === 'added') {
      detail = 'Successfully parsed and added to database';
    } else if (log.status === 'duplicate') {
      detail = 'Duplicate candidate found - sent to review queue';
    } else if (log.status === 'failed' || log.status === 'error') {
      const detailsObj = batchSummary.details ? (typeof batchSummary.details === 'string' ? JSON.parse(batchSummary.details) : batchSummary.details) : null;
      const fileDetail = (detailsObj && Array.isArray(detailsObj.files))
        ? detailsObj.files.find(f => f.name === log.file_name)
        : null;
      detail = fileDetail?.error ? `Failed: ${fileDetail.error}` : 'Failed to parse resume';
    } else if (log.status === 'processing') {
      detail = 'Extracting resume details...';
    }

    return {
      id: log.id,
      execution_id: log.execution_id,
      name: log.file_name,
      status: log.status,
      detail,
      processed_at: log.processed_at
    };
  });

  const allProcessed = logs.every(log => log.status !== 'pending' && log.status !== 'processing');
  const status = allProcessed ? 'completed' : 'processing';

  // Compute counts dynamically to avoid race conditions
  const success_count = logs.filter(log => log.status === 'success' || log.status === 'added').length;
  const duplicate_count = logs.filter(log => log.status === 'duplicate').length;
  const failed_count = logs.filter(log => log.status === 'failed' || log.status === 'error').length;

  return {
    ...batchSummary,
    success_count,
    duplicate_count,
    failed_count,
    status,
    files
  };
}

/**
 * Pre-generate general profile insights using Gemini
 * @param {Object} candidate - The candidate database record
 * @returns {Promise<Object|null>} The generated insights object
 */
export async function preGenerateCandidateInsights(candidate) {
  if (!config.gemini.apiKey) {
    logger.warn('Gemini API is not configured. Skipping pre-generation of AI insights.');
    return null;
  }

  const parsedHistory = (() => {
    try {
      const raw = candidate.employment_history;
      return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    } catch {
      return null;
    }
  })();

  const prompt = `
You are a recruitment profile analyst. Generate general profile insights JSON object for the candidate based on their resume data below.

Candidate data:
${JSON.stringify({
  id: Number(candidate.id),
  Name: candidate.Name,
  TotalExperienceYears: candidate.TotalExperienceYears,
  CurrentCompany: candidate.CurrentCompany,
  ExpectedCTC_LPA: candidate.ExpectedCTC_LPA,
  NoticePeriod: candidate.NoticePeriod,
  Top5KeySkills: candidate.Top5KeySkills,
  EnglishCommunicationRating: candidate.EnglishCommunicationRating,
  graduationdegree: candidate.graduationdegree,
  postgraduationdegree: candidate.postgraduationdegree,
  a10th: candidate.a10th,
  a12th: candidate.a12th,
  graduation: candidate.graduation,
  EmploymentHistory: parsedHistory,
  resume_technical_terms: candidate.resume_technical_terms
}, null, 2)}

Generate a detailed profile block. The summary must be a detailed 3-4 sentences detailing the total experience, key skills, current/expected CTC, notice period readiness, and availability of employment history.
Return ONLY a valid JSON object in this exact structure - no markdown, no explanation, no preamble:
{
  "skillMatchScore": 7,
  "skillMatchReason": "General profile evaluation based on listed skills.",
  "profile": {
    "summary": "<A detailed 3-4 sentence recruiter-friendly candidate summary. Specifically mention their total experience, key skills, current/expected CTC, notice period readiness, and whether their employment history is available.>",
    "fitVerdict": "Candidate has strong general matching skills.",
    "shortlistRecommendation": "Maybe - requires specific job matching",
    "redFlags": ["<specific red flag with data, or empty array if none>"],
    "skillGap": {
      "mandatory": {
        "present": ["<top key skills present in resume>"],
        "missing": []
      },
      "goodToHave": {
        "present": [],
        "missing": []
      }
    },
    "careerProgression": "<one sentence summarizing career timeline progression>",
    "scoreReasons": {
      "totalExperience": "Candidate has <X> years of total experience",
      "relevantExperience": "Shows relevant experience in key skills",
      "jobStability": "Acceptable tenures",
      "education": "Meets general qualification requirements",
      "communication": "Adequate English capabilities",
      "jdMatching": "General evaluation conducted",
      "ctcAlignment": "Expected CTC is <X> LPA",
      "availability": "Notice period is <X>"
    }
  }
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
    return JSON.parse(cleanText);
  } catch (err) {
    logger.error(`Failed to pre-generate profile insights via Gemini for candidate ${candidate.id}:`, { error: err.message });
    return null;
  }
}

/**
 * Background parsing worker.
 * Extracts text, calls Gemini API, handles fallback, updates DB.
 */
export async function runBatchParsing(executionId, files, user, source = 'hr_manual_upload', attribution = null) {
  const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'User';
  const email = user.email || 'unknown@user.com';

  // Vendor attribution for the candidates in this batch. An explicit attribution
  // (e.g. staff uploading on behalf of a vendor) wins; otherwise vendor self-uploads
  // fall back to the uploader's own identity. Non-vendor sources have no attribution.
  const attr = attribution
    || (source === 'vendor_portal' ? { vendorEmail: email, vendorName: fullName } : null);
  const attrEmail = attr?.vendorEmail || null;
  const attrName = attr?.vendorName || null;

  await (async () => {
    logger.info(`Starting background resume parsing for batch: ${executionId}`);
    
    let successCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;
    const batchErrors = []; // accumulates per-file errors across the whole batch for the error alert

    for (const file of files) {
      const rowErrors = [];
      const rowDuplicates = [];
      // Per-file job-tracking state (last candidate item wins for multi-row files).
      const jobInfo = {
        candidate_name: null,
        candidate_email: null,
        cv_id: null,
        cv_tmp_id: null,
        missingInfo: false,
      };

      try {
        // 1) Set log + job to processing
        await prisma.rpa_upload_log.update({
          where: {
            execution_id_file_name: {
              execution_id: executionId,
              file_name: file.originalname,
            }
          },
          data: { status: 'processing' }
        });
        await setJobStatus(executionId, file.originalname, JOB_STATUS.PROCESSING).catch(() => {});

        // 2) Determine if file is Excel
        const ext = path.extname(file.originalname).toLowerCase();
        const isExcel = ext === '.xlsx';
        let candidateItems = [];

        if (isExcel) {
          try {
            const workbook = XLSX.readFile(file.path);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet);
            if (rows.length === 0) {
              throw new Error('Spreadsheet contains no data.');
            }
            candidateItems = rows.map((row, idx) => {
              const text = Object.entries(row)
                .map(([k, v]) => `${k}: ${v ?? ''}`)
                .join('\n');
              return {
                text,
                filename: `${file.originalname} (Row ${idx + 2})`
              };
            });
            logger.info(`Excel: Read ${candidateItems.length} candidate rows from file ${file.originalname}`);
          } catch (xlsxErr) {
            throw new Error(`Failed to read spreadsheet: ${xlsxErr.message}`);
          }
        } else {
          const text = await extractTextFromFile(file.path, file.originalname);
          if (!text || text.trim().length === 0) {
            throw new Error('Extracted resume text was empty.');
          }
          candidateItems = [{ text, filename: file.originalname }];
        }

        // Upload original file to OneDrive once
        let cvUrl = `/uploads/${path.basename(file.path)}`;
        try {
          const onedriveUrl = await onedriveService.uploadFileToOneDrive(file.path, file.originalname);
          if (onedriveUrl) {
            cvUrl = onedriveUrl;
          }
        } catch (odErr) {
          logger.warn(`OneDrive: Failed to upload to OneDrive for file ${file.originalname}, using local fallback: ${odErr.message}`);
        }
        jobInfo.file_url = cvUrl;

        // Process each item (row or file text)
        for (const item of candidateItems) {
          let parsed = null;
          try {
            parsed = await parseResumeWithOpenRouter(item.text, item.filename, attrEmail || email, attrName || fullName);
            logger.info(`Successfully parsed candidate using OpenRouter: ${item.filename}`);
          } catch (err) {
            logger.error(`Gemini parsing failed for ${item.filename}: ${err.message}`);
            rowErrors.push(`${item.filename}: ${err.message}`);
            failedCount++;
            continue;
          }

          // 4) Compute experience history and calculate years
          const historyInput = Array.isArray(parsed.EmploymentHistory) ? parsed.EmploymentHistory : [];
          const formattedHistory = historyInput.map(job => {
            const start = parseDate(job.StartDate);
            const end = parseDate(job.EndDate);
            const months = monthsBetween(start, end);
            return {
              CompanyName: job.CompanyName || null,
              StartDate: job.StartDate || null,
              EndDate: job.EndDate || null,
              YearsWorked: historyInput.length > 0 ? +(months / 12).toFixed(2) : null
            };
          });

          let totalMonths = 0;
          let lastCompanyMonths = 0;
          formattedHistory.forEach((job, index) => {
            const start = parseDate(job.StartDate);
            const end = parseDate(job.EndDate);
            const months = monthsBetween(start, end);
            if (months > 0) {
              totalMonths += months;
              if (index === 0) lastCompanyMonths = months;
            }
          });

          if (formattedHistory.length > 0) {
            parsed.TotalExperienceYears = String(+(totalMonths / 12).toFixed(2));
            parsed.LastCompanyExperienceYears = String(+(lastCompanyMonths / 12).toFixed(2));
          } else {
            parsed.TotalExperienceYears = parsed.TotalExperienceYears ? String(parsed.TotalExperienceYears) : null;
            parsed.LastCompanyExperienceYears = parsed.LastCompanyExperienceYears ? String(parsed.LastCompanyExperienceYears) : null;
          }

          const employmentHistoryDb = {
            companies: formattedHistory,
            total_companies: formattedHistory.length
          };

          const fullText = (item.text || '').trim();
          const resume_text_quality = fullText.length === 0 ? 'failed' : (fullText.length < 200 ? 'lossy' : 'extracted');
          const rawTerms = parsed.ResumeTechnicalTerms;
          let resume_technical_terms = [];
          if (Array.isArray(rawTerms) && rawTerms.length > 0 && fullText.length > 0) {
            const fullTextLower = fullText.toLowerCase();
            resume_technical_terms = rawTerms
              .map(term => {
                const safeTerm = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`\\b${safeTerm}\\b`, 'gi');
                const matches = fullTextLower.match(regex);
                return {
                  term: String(term),
                  count: matches ? matches.length : 1
                };
              })
              .sort((a, b) => b.count - a.count);
          }
          const resume_term_updated_at = resume_technical_terms.length > 0 ? new Date() : null;

          const missingFields = getMissingFields(parsed);
          if (isExcel) {
            missingFields.uploadResume = 'Null';
          }
          const missingDataJson = JSON.stringify(missingFields);
          const statusActive = Object.keys(missingFields).length > 0 ? 'INACTIVE' : 'ACTIVE';

          // 5) Check if candidate email already exists in main database (by Email or ContactNumber arrays)
          const emailToSearch = parsed.EmailID || parsed.unique_key;

          if (!emailToSearch || emailToSearch === '' || emailToSearch.toLowerCase() === 'null') {
            logger.warn(`Candidate EmailID is missing for ${item.filename}. Alerting HR...`);
            sendEmailIdNullAlert(parsed.Name || item.filename, email).catch(mailErr => {
              logger.error(`Failed to send EmailID NULL alert: ${mailErr.message}`);
            });
            rowErrors.push(`${item.filename}: Missing EmailID`);
            failedCount++;
            continue;
          }

          const cleanContactNumbers = (parsed.ContactNumber || '')
            .split(',')
            .map(num => num.replace(/\s+/g, ''))
            .filter(num => num.length > 0);

          const cleanEmails = (emailToSearch || '')
            .split(',')
            .map(email => email.trim().toLowerCase())
            .filter(email => email.length > 0);

          let existingCandidate = null;
          if (cleanContactNumbers.length > 0 || cleanEmails.length > 0) {
            const matches = await prisma.$queryRaw`
              SELECT id FROM public.rpa_cv
              WHERE
                (
                  coalesce(cardinality(${cleanContactNumbers}::text[]), 0) > 0 AND
                  string_to_array(replace(coalesce("ContactNumber", ''), ' ', ''), ',') && ${cleanContactNumbers}::text[]
                ) OR (
                  coalesce(cardinality(${cleanEmails}::text[]), 0) > 0 AND
                  string_to_array(lower(replace(coalesce("EmailID", ''), ' ', '')), ',') && ${cleanEmails}::text[]
                )
              LIMIT 1
            `;
            if (matches && matches.length > 0) {
              existingCandidate = await prisma.rpa_cv.findUnique({
                where: { id: matches[0].id }
              });
            }
          }

          if (existingCandidate) {
            if (source === 'vendor_portal' || source === 'hr_manual_upload') {
              // Duplicate of an existing candidate → route to the rpa_cv_tmp review
              // queue for recruiter Merge/Cancel. Vendor uploads carry their vendor
              // attribution so a later merge stamps VendorEmail + the 90-day lock.
              const isVendorSource = source === 'vendor_portal';
              const tempCandidate = await prisma.rpa_cv_tmp.create({
                data: {
                  Name: parsed.Name || "Candidate",
                  EmailID: emailToSearch,
                  ContactNumber: parsed.ContactNumber || existingCandidate.ContactNumber || "9876543210",
                  PositionApplied: parsed.PositionApplied || existingCandidate.PositionApplied || "Software Engineer",
                  HighestQualification: parsed.HighestQualification || existingCandidate.HighestQualification || "B.Tech",
                  TotalExperienceYears: parsed.TotalExperienceYears ? String(parsed.TotalExperienceYears) : (existingCandidate.TotalExperienceYears || "3"),
                  LastCompanyExperienceYears: parsed.LastCompanyExperienceYears ? String(parsed.LastCompanyExperienceYears) : (existingCandidate.LastCompanyExperienceYears || "0"),
                  CurrentLocation: parsed.CurrentLocation || existingCandidate.CurrentLocation || "Delhi",
                  CurrentCompany: (parsed.CurrentCompany && typeof parsed.CurrentCompany === 'object') ? JSON.stringify(parsed.CurrentCompany) : (parsed.CurrentCompany || existingCandidate.CurrentCompany || "AAPNA Infotech"),
                  Top5KeySkills: Array.isArray(parsed.Top5KeySkills) ? parsed.Top5KeySkills.join(', ') : (parsed.Top5KeySkills || existingCandidate.Top5KeySkills || ""),
                  EducationalScoresPercentage: typeof parsed.EducationalScoresPercentage === 'object' ? JSON.stringify(parsed.EducationalScoresPercentage) : (parsed.EducationalScoresPercentage || existingCandidate.EducationalScoresPercentage || null),
                  a10th: parsed.EducationalScoresPercentage?.['10th'] ? String(parsed.EducationalScoresPercentage['10th']) : (existingCandidate.a10th || null),
                  a12th: parsed.EducationalScoresPercentage?.['12th'] ? String(parsed.EducationalScoresPercentage['12th']) : (existingCandidate.a12th || null),
                  graduation: parsed.EducationalScoresPercentage?.['Graduation'] ? String(parsed.EducationalScoresPercentage['Graduation']) : (existingCandidate.graduation || null),
                  postGraduation: parsed.EducationalScoresPercentage?.['PostGraduation'] ? String(parsed.EducationalScoresPercentage['PostGraduation']) : (existingCandidate.postGraduation || null),
                  graduationdegree: parsed.GraduationDegree || existingCandidate.graduationdegree || null,
                  graduationspecialization: parsed.GraduationSpecialization || existingCandidate.graduationspecialization || null,
                  postgraduationdegree: parsed.PostGraduationDegree || existingCandidate.postgraduationdegree || null,
                  postgraduationspecialization: parsed.PostGraduationSpecialization || existingCandidate.postgraduationspecialization || null,
                  employment_history: historyInput.length > 0 ? employmentHistoryDb : (existingCandidate.employment_history || null),
                  Gender: parsed.Gender || existingCandidate.Gender || null,
                  EnglishCommunicationRating: parsed.EnglishCommunicationRating ? String(parsed.EnglishCommunicationRating) : (existingCandidate.EnglishCommunicationRating || null),
                  PreferredShift: parsed.PreferredShift || existingCandidate.PreferredShift || null,
                  ReasonForJobChange: parsed.ReasonForJobChange || existingCandidate.ReasonForJobChange || null,
                  WillingToTakeOnlineTest: parsed.WillingToTakeOnlineTest || existingCandidate.WillingToTakeOnlineTest || null,
                  HasLaptopForInitialDays: parsed.HasLaptopForInitialDays || existingCandidate.HasLaptopForInitialDays || null,
                  LinkedInProfile: parsed.LinkedInProfile || existingCandidate.LinkedInProfile || null,
                  cvFileUrl: cvUrl,
                  uploadedByHRName: fullName,
                  uploadSource: isVendorSource ? 'Vendor Portal' : 'HR Manual Upload',
                  // New review-queue columns — only sent when provisioned (table + client).
                  ...(jobsModelReady() ? { source, reviewStatus: 'pending_review' } : {}),
                  VendorEmail: isVendorSource ? attrEmail : null,
                  vendorName: isVendorSource ? attrName : null,
                  statusActive: statusActive,
                  missingData: missingDataJson,
                  resume_full_text: fullText,
                  resume_text_quality: resume_text_quality,
                  resume_technical_terms: resume_technical_terms,
                  resume_term_updated_at: resume_term_updated_at,
                  createdAt: new Date(),
                  modifiedAt: new Date(),
                }
              });

              logger.info(`Duplicate resume routed to review queue (rpa_cv_tmp ID: ${tempCandidate.id}, source: ${source})`);
              rowDuplicates.push(`${item.filename}: Duplicate - pending recruiter review`);
              duplicateCount++;
              jobInfo.candidate_name = parsed.Name || 'Candidate';
              jobInfo.candidate_email = emailToSearch;
              jobInfo.cv_tmp_id = tempCandidate.id;

              // Notify recruiter/HR by email; the in-app socket notification fires via
              // the job's action_required transition at the per-file aggregate below.
              const serialTemp = { ...tempCandidate, id: Number(tempCandidate.id) };
              sendDuplicateAlertEmail(serialTemp, email).catch(mailErr => {
                logger.error(`Failed to send duplicate alert email: ${mailErr.message}`);
              });
            } else {
              // Outlook Trigger or other automated email ingest: directly update the existing candidate in public.rpa_cv
              logger.info(`Duplicate resume found from Outlook/other source. Directly updating candidate ID ${existingCandidate.id}`);
              
              const updateData = {};
              for (const field of CV_SHARED_FIELDS) {
                if (field === 'ContactNumber') {
                  updateData.ContactNumber = appendUnique(existingCandidate.ContactNumber, parsed.ContactNumber);
                } else if (field === 'EmailID') {
                  updateData.EmailID = appendUnique(existingCandidate.EmailID, emailToSearch);
                } else if (field === 'employment_history') {
                  updateData.employment_history = employmentHistoryDb;
                } else {
                  // Keep vendor fields from the existing candidate
                  if (field === 'vendorName' || field === 'VendorEmail') {
                    updateData[field] = existingCandidate[field];
                  } else {
                    const val = prefer(parsed[field], existingCandidate[field]);
                    if (val !== null && val !== undefined) {
                      if (['ZekoInterviewScore', 'ZekoCodingScore', 'ZekoCommunicationScore'].includes(field)) {
                        updateData[field] = val;
                      } else {
                        updateData[field] = String(val);
                      }
                    } else {
                      updateData[field] = null;
                    }
                  }
                }
              }

              // Preserve existing vendor email and name (don't overwrite them)
              updateData.VendorEmail = existingCandidate.VendorEmail;
              updateData.vendorName = existingCandidate.vendorName;
              updateData.cvFileUrl = cvUrl;
              updateData.statusActive = statusActive;
              updateData.missingData = missingDataJson;
              updateData.modifiedAt = new Date();
              updateData.TotalExperienceYearsNumeric = parseExperienceNumeric(updateData.TotalExperienceYears);
              updateData.ExpectedCTCNumeric = parseExpectedCTCNumeric(updateData.ExpectedCTC_LPA);
              updateData.NoticePeriodDays = parseNoticePeriodDays(updateData.NoticePeriod);
              updateData.resume_full_text = fullText;
              updateData.resume_text_quality = resume_text_quality;
              updateData.resume_technical_terms = (resume_technical_terms.length > 0) ? resume_technical_terms : existingCandidate.resume_technical_terms;
              updateData.resume_term_updated_at = (resume_technical_terms.length > 0) ? resume_term_updated_at : existingCandidate.resume_term_updated_at;

              const updatedCv = await prisma.rpa_cv.update({
                where: { id: existingCandidate.id },
                data: updateData
              });

              successCount++;
              jobInfo.candidate_name = parsed.Name || updatedCv.Name || 'Candidate';
              jobInfo.candidate_email = emailToSearch;
              jobInfo.cv_id = updatedCv.id;
              jobInfo.missingInfo = Object.keys(missingFields).length > 0;
              runPostProcessing(updatedCv.id, parsed, source, fullName, email, missingFields, attr);
            }
          } else {
            // New candidate! Create directly in main rpa_cv table
            const newCv = await prisma.rpa_cv.create({
              data: {
                Name: parsed.Name || "Candidate",
                EmailID: emailToSearch,
                ContactNumber: parsed.ContactNumber || "9876543210",
                PositionApplied: parsed.PositionApplied || "Software Developer",
                HighestQualification: parsed.HighestQualification || "B.Tech",
                TotalExperienceYears: parsed.TotalExperienceYears ? String(parsed.TotalExperienceYears) : "2",
                LastCompanyExperienceYears: parsed.LastCompanyExperienceYears ? String(parsed.LastCompanyExperienceYears) : "0",
                CurrentLocation: parsed.CurrentLocation || "Delhi",
                CurrentCompany: (parsed.CurrentCompany && typeof parsed.CurrentCompany === 'object') ? JSON.stringify(parsed.CurrentCompany) : (parsed.CurrentCompany || "N/A"),
                Top5KeySkills: Array.isArray(parsed.Top5KeySkills) ? parsed.Top5KeySkills.join(', ') : (parsed.Top5KeySkills || ""),
                EducationalScoresPercentage: typeof parsed.EducationalScoresPercentage === 'object' ? JSON.stringify(parsed.EducationalScoresPercentage) : (parsed.EducationalScoresPercentage || null),
                a10th: parsed.EducationalScoresPercentage?.['10th'] ? String(parsed.EducationalScoresPercentage['10th']) : null,
                a12th: parsed.EducationalScoresPercentage?.['12th'] ? String(parsed.EducationalScoresPercentage['12th']) : null,
                graduation: parsed.EducationalScoresPercentage?.['Graduation'] ? String(parsed.EducationalScoresPercentage['Graduation']) : null,
                postGraduation: parsed.EducationalScoresPercentage?.['PostGraduation'] ? String(parsed.EducationalScoresPercentage['PostGraduation']) : null,
                graduationdegree: parsed.GraduationDegree || null,
                graduationspecialization: parsed.GraduationSpecialization || null,
                postgraduationdegree: parsed.PostGraduationDegree || null,
                postgraduationspecialization: parsed.PostGraduationSpecialization || null,
                employment_history: employmentHistoryDb,
                Gender: parsed.Gender || null,
                EnglishCommunicationRating: parsed.EnglishCommunicationRating ? String(parsed.EnglishCommunicationRating) : null,
                PreferredShift: parsed.PreferredShift || null,
                ReasonForJobChange: parsed.ReasonForJobChange || null,
                WillingToTakeOnlineTest: parsed.WillingToTakeOnlineTest || null,
                HasLaptopForInitialDays: parsed.HasLaptopForInitialDays || null,
                LinkedInProfile: parsed.LinkedInProfile || null,
                cvFileUrl: cvUrl,
                statusActive: statusActive,
                missingData: missingDataJson,
                VendorEmail: attrEmail,
                vendorName: attrName,
                createdAt: new Date(),
                modifiedAt: new Date(),
                TotalExperienceYearsNumeric: parseExperienceNumeric(parsed.TotalExperienceYears ? String(parsed.TotalExperienceYears) : "2"),
                ExpectedCTCNumeric: parseExpectedCTCNumeric(parsed.ExpectedCTC_LPA ? String(parsed.ExpectedCTC_LPA) : null),
                NoticePeriodDays: parseNoticePeriodDays(parsed.NoticePeriod ? String(parsed.NoticePeriod) : null),
                resume_full_text: fullText,
                resume_text_quality: resume_text_quality,
                resume_technical_terms: resume_technical_terms,
                resume_term_updated_at: resume_term_updated_at,
              }
            });

            successCount++;
            jobInfo.candidate_name = parsed.Name || 'Candidate';
            jobInfo.candidate_email = emailToSearch;
            jobInfo.cv_id = newCv.id;
            jobInfo.missingInfo = Object.keys(missingFields).length > 0;

            // Run post-processing asynchronously (non-blocking)
            runPostProcessing(newCv.id, parsed, source, fullName, email, missingFields, attr);
          }
        }
      } catch (err) {
        logger.error(`Error processing file ${file.originalname} in batch ${executionId}`, { error: err.message });
        rowErrors.push(err.message);
        failedCount++;
      }

      // Update file log to final aggregate status
      let finalStatus = 'success';
      if (rowErrors.length > 0) {
        finalStatus = 'failed';
      } else if (rowDuplicates.length > 0) {
        finalStatus = 'duplicate';
      }

      // Accumulate failures for the batch-level error alert
      if (rowErrors.length > 0) {
        batchErrors.push(`${file.originalname}: ${rowErrors.join(' | ')}`);
      }

      // Map the per-file outcome to a persistent job status + emit live update.
      let jobStatus;
      if (rowErrors.length > 0) jobStatus = JOB_STATUS.FAILED;
      else if (rowDuplicates.length > 0) jobStatus = JOB_STATUS.DUPLICATE_PENDING_REVIEW;
      else if (jobInfo.missingInfo) jobStatus = JOB_STATUS.MISSING_INFORMATION;
      else jobStatus = JOB_STATUS.COMPLETED;

      await setJobStatus(executionId, file.originalname, jobStatus, {
        candidate_name: jobInfo.candidate_name,
        candidate_email: jobInfo.candidate_email,
        cv_id: jobInfo.cv_id,
        cv_tmp_id: jobInfo.cv_tmp_id,
        file_url: jobInfo.file_url || null,
        is_duplicate: rowDuplicates.length > 0,
        action_required: jobStatus === JOB_STATUS.DUPLICATE_PENDING_REVIEW,
        error_message: rowErrors.length > 0 ? rowErrors.join(' | ') : null,
      }).catch((e) => logger.warn(`Failed to update upload job status: ${e.message}`));

      try {
        await prisma.rpa_upload_log.update({
          where: {
            execution_id_file_name: {
              execution_id: executionId,
              file_name: file.originalname,
            }
          },
          data: {
            status: finalStatus,
            processed_at: new Date()
          }
        });

        // Store aggregate status/error in batch details
        const batchObj = await prisma.rpa_upload_batch_summary.findUnique({
          where: { execution_id: executionId }
        });
        if (batchObj && batchObj.details) {
          const details = typeof batchObj.details === 'string' ? JSON.parse(batchObj.details) : batchObj.details;
          if (Array.isArray(details.files)) {
            const fileItem = details.files.find(f => f.name === file.originalname);
            if (fileItem) {
              fileItem.status = finalStatus;
              if (rowErrors.length > 0) {
                fileItem.error = rowErrors.join(' | ');
              } else if (rowDuplicates.length > 0) {
                fileItem.error = rowDuplicates.join(' | ');
              }
            }
          }
          await prisma.rpa_upload_batch_summary.update({
            where: { execution_id: executionId },
            data: { details }
          });
        }
      } catch (logErr) {
        logger.error('Failed to update upload log status in database', { error: logErr.message });
      }

      // 6) Incrementally update batch summary stats
      try {
        await prisma.rpa_upload_batch_summary.update({
          where: { execution_id: executionId },
          data: {
            success_count: successCount,
            duplicate_count: duplicateCount,
            failed_count: failedCount,
          }
        });
      } catch (sumErr) {
        logger.error('Failed to update incremental batch summary stats', { error: sumErr.message });
      }
    }

    logger.info(`Completed background resume parsing for batch: ${executionId}. Success: ${successCount}, Duplicates: ${duplicateCount}, Failed: ${failedCount}`);

    // Send a single error-alert email if any files failed (mirrors n8n "Error Alert — Resume Processing")
    if (failedCount > 0) {
      sendResumeErrorAlert({
        executionId,
        failedCount,
        totalCount: files.length,
        errors: batchErrors,
        source,
      }).catch(mailErr => {
        logger.error(`Failed to send resume error alert for batch ${executionId}: ${mailErr.message}`);
      });
    }
  })();
}

/**
 * Fire-and-forget, in-process batch parser. Schedules runBatchParsing on the next
 * tick so the HTTP request returns immediately. Used when the durable BullMQ queue
 * is disabled (USE_RESUME_QUEUE !== 'true'); otherwise controllers enqueue jobs and
 * the resumeWorker calls runBatchParsing per file.
 */
export function startBackgroundParsing(executionId, files, user, source = 'hr_manual_upload', attribution = null) {
  setImmediate(() => {
    runBatchParsing(executionId, files, user, source, attribution).catch((err) => {
      logger.error(`Background parsing failed for batch ${executionId}: ${err.message}`);
    });
  });
}

/**
 * Dispatch a batch for processing. When the durable queue is enabled
 * (USE_RESUME_QUEUE === 'true') each file is enqueued as a BullMQ job (durable,
 * concurrent, retried); otherwise it runs in-process via startBackgroundParsing.
 */
export async function dispatchBatchParsing(executionId, files, user, source = 'hr_manual_upload', attribution = null) {
  if (process.env.USE_RESUME_QUEUE === 'true') {
    // Lazy-import so Redis/BullMQ is only touched when the queue is enabled.
    const { addResumeJob } = await import('../queues/resumeQueue.js');
    const slimUser = {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      role: user.role,
    };
    for (const file of files) {
      await addResumeJob({ executionId, file, user: slimUser, source, attribution });
      await setJobStatus(executionId, file.originalname, JOB_STATUS.QUEUED).catch(() => {});
    }
    logger.info(`Enqueued ${files.length} resume job(s) for batch ${executionId} (durable queue).`);
  } else {
    startBackgroundParsing(executionId, files, user, source, attribution);
  }
}

/**
 * Run candidate post-processing (vector generation, AI insights, and emails) asynchronously.
 */
function runPostProcessing(cvId, parsed, source, fullName, email, missingFields, attr = null) {
  setImmediate(async () => {
    try {
      logger.info(`Starting asynchronous post-processing for candidate ID ${cvId}`);

      // 1) Save vector embedding and get metadata
      const metadata = await saveCandidateVector(cvId, parsed);

      // 2) Calculate lockForNinetyDays — prefer the explicit attribution (vendor the
      // resume was uploaded for), then any vendor parsed from the resume.
      let lockForNinetyDays = null;
      const vendorName = attr?.vendorName || parsed.VendorName || parsed.vendorName || null;
      const vendorEmail = attr?.vendorEmail || parsed.VendorEmail || parsed.vendorEmail || null;
      if (vendorName && vendorEmail) {
        const date = new Date();
        date.setDate(date.getDate() + 90);
        lockForNinetyDays = date.toISOString().split('T')[0];
      }

      // 3) Pre-generate AI profile insights
      let aiInsights = null;
      try {
        const candidate = await prisma.rpa_cv.findUnique({ where: { id: BigInt(cvId) } });
        if (candidate) {
          aiInsights = await preGenerateCandidateInsights(candidate);
        }
      } catch (aiErr) {
        logger.warn(`Failed to pre-generate AI insights for candidate ${cvId}: ${aiErr.message}`);
      }

      // 4) Update candidate with MetaData, lockForNinetyDays, and ai_profile_insights
      const updatedCv = await prisma.rpa_cv.update({
        where: { id: BigInt(cvId) },
        data: {
          MetaData: metadata ? JSON.stringify(metadata) : '',
          lockForNinetyDays,
          ai_profile_insights: aiInsights
        }
      });

      // 5) Send welcome and missing data emails
      const serialCv = serializeRecord(updatedCv);
      if (serialCv) {
        try {
          await sendWelcomeEmail(serialCv, email);
          if (Object.keys(missingFields).length > 0) {
            await sendMissingDataEmail(serialCv, email);
          }
        } catch (mailErr) {
          logger.error(`Failed to send candidate email notifications for candidate ${cvId}: ${mailErr.message}`);
        }
      }

      logger.info(`Successfully completed asynchronous post-processing for candidate ID ${cvId}`);
    } catch (err) {
      logger.error(`Error during asynchronous post-processing for candidate ID ${cvId}: ${err.message}`);
    }
  });
}
