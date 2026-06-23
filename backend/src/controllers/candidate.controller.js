import * as candidateService from '../services/candidate.service.js';
import { success, paginated } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import prisma from '../config/database.js';
import AppError from '../utils/AppError.js';
import { saveCandidateVector } from '../services/vectorStore.service.js';
import logger from '../config/logger.js';
import { extractTextFromFile, parseResumeWithOpenRouter } from '../services/hrUpload.service.js';
import { updateJobByCvId } from '../services/uploadJob.service.js';
import { getApprovedRoles } from '../services/screening.service.js';
import * as onedriveService from '../services/onedrive.service.js';
import { parseExperienceNumeric, parseExpectedCTCNumeric, parseNoticePeriodDays } from '../utils/candidateParser.js';
import path from 'path';

/**
 * @desc    Search candidates with pagination and filters
 * @route   GET /api/candidates
 * @access  Private
 */
export const searchCandidates = catchAsync(async (req, res) => {
  const {
    search,
    status,
    finalStatus,
    vendorEmail,
    position,
    location,
    name,
    email,
    phone,
    page = 1,
    limit = 20,
    sort = 'createdAt',
    order = 'desc',
  } = req.query;

  const filters = { search, status, finalStatus, vendorEmail, position, location, name, email, phone };
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));

  const result = await candidateService.search(filters, pageNum, limitNum, sort, order);

  return paginated(res, result.data, pageNum, limitNum, result.total, 'Candidates retrieved');
});

/**
 * @desc    Get a single candidate by ID
 * @route   GET /api/candidates/:id
 * @access  Private
 */
export const getCandidate = catchAsync(async (req, res) => {
  const candidate = await candidateService.findById(req.params.id);
  return success(res, candidate, 'Candidate retrieved');
});

/**
 * @desc    Update a candidate record
 * @route   PATCH /api/candidates/:id
 * @access  Private
 */
export const updateCandidate = catchAsync(async (req, res) => {
  const candidate = await candidateService.update(req.params.id, req.body);
  return success(res, candidate, 'Candidate updated');
});

/**
 * @desc    Get email conversations associated with a candidate
 * @route   GET /api/candidates/:id/emails
 * @access  Private
 */
export const getCandidateEmails = catchAsync(async (req, res) => {
  const candidateId = req.params.id;

  const emails = await prisma.rpa_email_messages.findMany({
    where: {
      candidate_id: BigInt(candidateId),
    },
    orderBy: {
      sent_at: 'desc',
    },
  });

  // Safe BigInt serialization
  const serializedEmails = emails.map((email) => ({
    ...email,
    id: email.id.toString(),
    candidate_id: email.candidate_id ? email.candidate_id.toString() : null,
    mrf_id: email.mrf_id ? email.mrf_id.toString() : null,
    account_id: email.account_id ? email.account_id.toString() : null,
    sent_by_user_id: email.sent_by_user_id ? email.sent_by_user_id.toString() : null,
  }));

  return success(res, serializedEmails, 'Candidate email communications retrieved');
});

/**
 * @desc    Get approved MRF roles for the public missing-JD form dropdown
 * @route   GET /api/candidates/public/roles
 * @access  Public
 *
 * The missing-JD form is served to logged-out candidates, so it cannot use the
 * authenticated /api/screening/roles endpoint. This exposes the same approved
 * roles publicly (read-only) for the "Position Applied" dropdown.
 */
export const getPublicRoles = catchAsync(async (req, res) => {
  const roles = await getApprovedRoles();
  return success(res, roles, 'Approved roles retrieved successfully');
});

/**
 * @desc    Get candidate's missing data fields via public token
 * @route   GET /api/candidates/public/missing-data
 * @access  Public
 */
export const getPublicMissingData = catchAsync(async (req, res) => {
  const { token } = req.query;
  if (!token) {
    throw new AppError('Token is required.', 400);
  }

  // Decode base64 email
  let email;
  try {
    email = Buffer.from(token, 'base64').toString('utf-8').trim();
  } catch (err) {
    throw new AppError('Invalid token format.', 400);
  }

  if (!email || !email.includes('@')) {
    throw new AppError('Invalid token content.', 400);
  }

  // Find candidate by EmailID
  const candidate = await prisma.rpa_cv.findFirst({
    where: {
      EmailID: { equals: email, mode: 'insensitive' }
    }
  });

  if (!candidate) {
    throw new AppError('Candidate not found.', 404);
  }

  // Parse missingData
  let missingFields = {};
  if (candidate.missingData) {
    try {
      missingFields = typeof candidate.missingData === 'string' 
        ? JSON.parse(candidate.missingData) 
        : candidate.missingData;
    } catch {
      missingFields = {};
    }
  }

  // Return basic candidate info and missing fields
  return success(res, {
    id: candidate.id.toString(),
    Name: candidate.Name,
    EmailID: candidate.EmailID,
    missingFields
  }, 'Candidate missing data fields retrieved successfully');
});

/**
 * @desc    Submit candidate's missing data fields via public token
 * @route   POST /api/candidates/public/missing-data
 * @access  Public
 */
export const submitPublicMissingData = catchAsync(async (req, res) => {
  const { token } = req.query;
  const submissions = req.body || {};

  if (!token) {
    throw new AppError('Token is required.', 400);
  }

  // Decode base64 email
  let email;
  try {
    email = Buffer.from(token, 'base64').toString('utf-8').trim();
  } catch (err) {
    throw new AppError('Invalid token format.', 400);
  }

  // Find candidate by EmailID
  const candidate = await prisma.rpa_cv.findFirst({
    where: {
      EmailID: { equals: email, mode: 'insensitive' }
    }
  });

  if (!candidate) {
    throw new AppError('Candidate not found.', 404);
  }

  // Update candidate fields based on submitted values
  const updateData = {};
  const fieldMapping = {
    'NoticePeriod': 'NoticePeriod',
    'ContactNumber': 'ContactNumber',
    'HighestQualification': 'HighestQualification',
    'CurrentLocation': 'CurrentLocation',
    'CTC_LPA': 'CTC_LPA',
    'ExpectedCTC_LPA': 'ExpectedCTC_LPA',
    'JobSource': 'JobSource',
    'RecruiterInfoAAPNA': 'RecruiterInfoAAPNA',
    'PositionApplied': 'PositionApplied',
    'Gender': 'Gender',
    'EnglishCommunicationRating': 'EnglishCommunicationRating',
    'graduationdegree': 'graduationdegree',
    'graduationspecialization': 'graduationspecialization',
    'postgraduationdegree': 'postgraduationdegree',
    'postgraduationspecialization': 'postgraduationspecialization',
    'PreferredShift': 'PreferredShift',
    'ReasonForJobChange': 'ReasonForJobChange',
    'WillingToTakeOnlineTest': 'WillingToTakeOnlineTest',
    'HasLaptopForInitialDays': 'HasLaptopForInitialDays',
    'LinkedInProfile': 'LinkedInProfile',
    'Top5KeySkills': 'Top5KeySkills',
    'Name': 'Name',
    'TotalExperienceYears': 'TotalExperienceYears',
    'LastCompanyExperienceYears': 'LastCompanyExperienceYears',
    
    // Scores mapping
    '10th (in percentage)': 'a10th',
    '12th (in percentage)': 'a12th',
    'Graduation (in percentage)': 'graduation',
    'PostGraduation (in percentage)': 'postGraduation'
  };

  // Iterate over submissions and map them to db fields
  Object.keys(submissions).forEach(key => {
    const dbField = fieldMapping[key];
    if (dbField) {
      const value = submissions[key];
      if (value !== undefined && value !== null && value !== '') {
        // Special type parsing for specific columns
        if (dbField === 'EnglishCommunicationRating') {
          updateData[dbField] = String(value);
        } else if (dbField === 'NoticePeriod') {
          updateData[dbField] = String(value);
          updateData.NoticePeriodDays = parseInt(value, 10) || null;
        } else if (dbField === 'ExpectedCTC_LPA') {
          updateData[dbField] = String(value);
          const parsedVal = parseFloat(value);
          updateData.ExpectedCTCNumeric = isNaN(parsedVal) ? null : parsedVal;
        } else if (dbField === 'TotalExperienceYears') {
          updateData[dbField] = String(value);
          updateData.TotalExperienceYearsNumeric = parseExperienceNumeric(String(value));
        } else if (dbField === 'Top5KeySkills') {
          updateData[dbField] = Array.isArray(value) ? value.join(', ') : String(value);
        } else {
          updateData[dbField] = String(value);
        }
      }
    }
  });

  // Handle CurrentCompany if provided
  if (submissions.CurrentCompany) {
    updateData.CurrentCompany = typeof submissions.CurrentCompany === 'object'
      ? JSON.stringify(submissions.CurrentCompany)
      : String(submissions.CurrentCompany);
  }

  // Check if a resume file was uploaded
  let parsedResume = null;
  let cvUrl = null;

  if (req.file) {
    logger.info(`File uploaded in missing JD submission: ${req.file.originalname}. Size: ${req.file.size} bytes.`);
    
    // 1) Upload to MS OneDrive
    cvUrl = `/uploads/${path.basename(req.file.path)}`;
    try {
      const onedriveUrl = await onedriveService.uploadFileToOneDrive(req.file.path, req.file.originalname);
      if (onedriveUrl) {
        cvUrl = onedriveUrl;
      }
    } catch (odErr) {
      logger.warn(`OneDrive: Failed to upload missing JD resume for candidate ${candidate.id}, using local fallback: ${odErr.message}`);
    }

    // 2) Parse using OpenRouter
    try {
      const text = await extractTextFromFile(req.file.path, req.file.originalname);
      if (text && text.trim().length > 0) {
        parsedResume = await parseResumeWithOpenRouter(text, req.file.originalname, candidate.VendorEmail, candidate.vendorName);
        logger.info(`Successfully parsed missing JD resume using OpenRouter for candidate: ${candidate.id}`);
        
        const fullText = text.trim();
        const resume_text_quality = fullText.length === 0 ? 'failed' : (fullText.length < 200 ? 'lossy' : 'extracted');
        const rawTerms = parsedResume.ResumeTechnicalTerms;
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

        resumeData.resume_full_text = fullText;
        resumeData.resume_text_quality = resume_text_quality;
        resumeData.resume_technical_terms = resume_technical_terms;
        resumeData.resume_term_updated_at = resume_term_updated_at;
      } else {
        logger.warn(`Extracted text from uploaded resume was empty for candidate: ${candidate.id}`);
      }
    } catch (parseErr) {
      logger.error(`OpenRouter parsing failed during missing JD upload for candidate ${candidate.id}: ${parseErr.message}`);
    }
  }

  // Merge parsed fields from resume
  const resumeData = {};
  if (parsedResume) {
    const resumeFields = [
      'Name', 'NoticePeriod', 'ContactNumber', 'EmailID',
      'HighestQualification', 'TotalExperienceYears', 'LastCompanyExperienceYears',
      'CurrentLocation', 'CurrentCompany', 'Top5KeySkills', 'Gender',
      'EnglishCommunicationRating', 'PreferredShift', 'ReasonForJobChange',
      'WillingToTakeOnlineTest', 'HasLaptopForInitialDays', 'LinkedInProfile',
      'graduationdegree', 'graduationspecialization', 'postgraduationdegree',
      'postgraduationspecialization'
    ];

    resumeFields.forEach(field => {
      const val = parsedResume[field];
      if (val !== undefined && val !== null && val !== '' && val !== 'null') {
        if (field === 'Top5KeySkills') {
          resumeData[field] = Array.isArray(val) ? val.join(', ') : String(val);
        } else if (field === 'CurrentCompany') {
          resumeData[field] = typeof val === 'object' ? JSON.stringify(val) : String(val);
        } else {
          resumeData[field] = String(val);
        }
      }
    });

    if (resumeData.TotalExperienceYears) {
      resumeData.TotalExperienceYearsNumeric = parseExperienceNumeric(resumeData.TotalExperienceYears);
    }
    if (resumeData.ExpectedCTC_LPA) {
      resumeData.ExpectedCTCNumeric = parseExpectedCTCNumeric(resumeData.ExpectedCTC_LPA);
    }
    if (resumeData.NoticePeriod) {
      resumeData.NoticePeriodDays = parseNoticePeriodDays(resumeData.NoticePeriod);
    }
  }

  // Merge form submissions on top of resume data (form overrides parsed resume)
  const finalUpdateData = {
    ...resumeData,
    ...updateData
  };

  if (cvUrl) {
    finalUpdateData.cvFileUrl = cvUrl;
  }

  // Recheck what fields are still missing
  let missingFields = {};
  if (candidate.missingData) {
    try {
      missingFields = typeof candidate.missingData === 'string'
        ? JSON.parse(candidate.missingData)
        : candidate.missingData;
    } catch {
      missingFields = {};
    }
  }

  // Remove keys that have been submitted with non-empty values
  // Also remove 'uploadResume' if a file was successfully uploaded
  Object.keys(submissions).forEach(key => {
    const val = submissions[key];
    if (val !== undefined && val !== null && val !== '') {
      delete missingFields[key];
    }
  });

  if (req.file) {
    delete missingFields['uploadResume'];
  }

  // Determine if it is active now
  const stillMissingCount = Object.keys(missingFields).length;
  finalUpdateData.missingData = JSON.stringify(missingFields);
  finalUpdateData.statusActive = stillMissingCount > 0 ? 'INACTIVE' : 'ACTIVE';
  
  if (stillMissingCount === 0) {
    finalUpdateData.cvMissingTokenStatus = 'RECEIVED';
  }

  finalUpdateData.modifiedAt = new Date();

  // Save candidate
  const updatedCandidate = await prisma.rpa_cv.update({
    where: { id: candidate.id },
    data: finalUpdateData
  });

  // If the candidate has now supplied all missing details, advance the originating
  // upload job from "Awaiting Candidate Details" to "Saved to Database". Matched by
  // cv_id and candidate email (the job may have been linked by either).
  logger.info(`[missing-data] submit for candidate ${candidate.id} (${email}): stillMissingCount=${stillMissingCount}`
    + (stillMissingCount > 0 ? `, remaining=[${Object.keys(missingFields).join(', ')}]` : ''));
  if (stillMissingCount === 0) {
    try {
      const advanced = await updateJobByCvId(
        candidate.id,
        { status: 'Completed', action_required: false },
        ['Missing_Information'],
        email,
      );
      logger.info(`[missing-data] job advance: ${advanced ? `job ${advanced.id} → ${advanced.status}` : 'no matching Missing_Information job found'}`);
    } catch (e) {
      logger.warn(`Failed to advance upload job after missing-info submission: ${e.message}`);
    }
  }

  // Regenerate vector and update candidate metadata asynchronously in the background
  setImmediate(async () => {
    try {
      logger.info(`Starting background vector regeneration for candidate ID ${updatedCandidate.id}`);
      
      const existingVector = await prisma.rpa_cv_vectors.findFirst({
        where: { candidate_id: Number(updatedCandidate.id) }
      });

      let parsedData = {};
      if (existingVector && existingVector.text) {
        try {
          parsedData = JSON.parse(existingVector.text);
        } catch (err) {
          logger.warn(`Failed to parse existing vector text for candidate ${updatedCandidate.id}: ${err.message}`);
        }
      }

      if (Object.keys(parsedData).length === 0) {
        parsedData = {
          Name: updatedCandidate.Name,
          EmailID: updatedCandidate.EmailID,
          ContactNumber: updatedCandidate.ContactNumber,
          PositionApplied: updatedCandidate.PositionApplied,
          HighestQualification: updatedCandidate.HighestQualification,
          TotalExperienceYears: updatedCandidate.TotalExperienceYears,
          LastCompanyExperienceYears: updatedCandidate.LastCompanyExperienceYears,
          CurrentLocation: updatedCandidate.CurrentLocation,
          CurrentCompany: updatedCandidate.CurrentCompany,
          Top5KeySkills: updatedCandidate.Top5KeySkills,
          Gender: updatedCandidate.Gender,
          EnglishCommunicationRating: updatedCandidate.EnglishCommunicationRating,
          PreferredShift: updatedCandidate.PreferredShift,
          ReasonForJobChange: updatedCandidate.ReasonForJobChange,
          WillingToTakeOnlineTest: updatedCandidate.WillingToTakeOnlineTest,
          HasLaptopForInitialDays: updatedCandidate.HasLaptopForInitialDays,
          LinkedInProfile: updatedCandidate.LinkedInProfile,
          EducationalScoresPercentage: {}
        };

        if (updatedCandidate.a10th) parsedData.EducationalScoresPercentage['10th'] = updatedCandidate.a10th;
        if (updatedCandidate.a12th) parsedData.EducationalScoresPercentage['12th'] = updatedCandidate.a12th;
        if (updatedCandidate.graduation) parsedData.EducationalScoresPercentage['Graduation'] = updatedCandidate.graduation;
        if (updatedCandidate.postGraduation) parsedData.EducationalScoresPercentage['PostGraduation'] = updatedCandidate.postGraduation;
      }

      // Merge newly parsed fields from resume (if file was uploaded)
      if (parsedResume) {
        Object.keys(parsedResume).forEach(field => {
          const val = parsedResume[field];
          if (val !== undefined && val !== null && val !== '' && val !== 'null') {
            parsedData[field] = val;
          }
        });
      }

      // Merge newly submitted fields
      Object.keys(submissions).forEach(key => {
        const dbField = fieldMapping[key];
        if (dbField && !['a10th', 'a12th', 'graduation', 'postGraduation'].includes(dbField)) {
          const value = submissions[key];
          if (value !== undefined && value !== null && value !== '') {
            parsedData[dbField] = value;
          }
        }
      });

      if (!parsedData.EducationalScoresPercentage) {
        parsedData.EducationalScoresPercentage = {};
      }
      if (submissions['10th (in percentage)']) parsedData.EducationalScoresPercentage['10th'] = String(submissions['10th (in percentage)']);
      if (submissions['12th (in percentage)']) parsedData.EducationalScoresPercentage['12th'] = String(submissions['12th (in percentage)']);
      if (submissions['Graduation (in percentage)']) parsedData.EducationalScoresPercentage['Graduation'] = String(submissions['Graduation (in percentage)']);
      if (submissions['PostGraduation (in percentage)']) parsedData.EducationalScoresPercentage['PostGraduation'] = String(submissions['PostGraduation (in percentage)']);

      // Generate vector embedding and save it
      const metadata = await saveCandidateVector(updatedCandidate.id, parsedData);

      if (metadata) {
        await prisma.rpa_cv.update({
          where: { id: updatedCandidate.id },
          data: {
            MetaData: JSON.stringify(metadata)
          }
        });
      }
      logger.info(`Successfully regenerated vector and updated metadata for candidate ID ${updatedCandidate.id}`);
    } catch (err) {
      logger.error(`Error regenerating vector for candidate ID ${updatedCandidate.id}: ${err.message}`);
    }
  });

  // Safe serialization for response
  const serialized = {
    ...updatedCandidate,
    id: updatedCandidate.id.toString(),
    missingFields
  };

  return success(res, serialized, 'Candidate profile updated successfully');
});
