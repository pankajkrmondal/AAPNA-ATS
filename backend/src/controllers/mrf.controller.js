import prisma from '../config/database.js';
import { success, paginated } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { uploadFileToOneDrive } from '../services/onedrive.service.js';
import { extractTextFromBuffer } from '../utils/fileExtractor.js';
import { parseJobDescription } from '../services/geminiParser.service.js';
import { sendMrfRequestEmail, sendMrfApprovalEmail, sendMrfSubmissionHrEmail } from '../services/emailNotification.service.js';

/**
 * @desc    Submit a new MRF Request (creates a record in rpa_mrf_jd_send)
 * @route   POST /api/mrf
 * @access  Private
 */
export const createMrfRequest = catchAsync(async (req, res) => {
  const {
    first_name,
    last_name,
    email,
    cc_email,
    role,
    jd_doc_link,
    budget_min,
    budget_max,
    email_body_content,
  } = req.body;

  // Validate required fields
  if (!first_name || !last_name || !email || !role || !jd_doc_link) {
    throw new AppError('Missing required fields: first_name, last_name, email, role, and jd_doc_link are required.', 400);
  }

  // Email validation — same pattern the n8n MRF form enforces.
  const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!EMAIL_PATTERN.test(email.trim())) {
    throw new AppError('Please enter a valid Email.', 400);
  }

  // CC Email validation (optional) — comma-separated, no trailing separator,
  // every entry must be a valid email.
  if (cc_email && cc_email.trim()) {
    const cc = cc_email.trim();
    if (/[;,]\s*$/.test(cc)) {
      throw new AppError('CC Email should not end with comma or semicolon.', 400);
    }
    const cclist = cc.split(',').map((e) => e.trim()).filter((e) => e !== '');
    const invalid = cclist.filter((e) => !EMAIL_PATTERN.test(e));
    if (cclist.length === 0 || invalid.length > 0) {
      throw new AppError(`Invalid CC Email(s): ${invalid.join(', ') || cc}`, 400);
    }
  }

  // Budget validation — Budget Min >= 10,000 and Budget Max > Budget Min.
  const minBudget = Number(budget_min);
  const maxBudget = Number(budget_max);
  if (Number.isNaN(minBudget) || Number.isNaN(maxBudget)) {
    throw new AppError('Budget values must be valid numbers.', 400);
  }
  if (minBudget < 10000) {
    throw new AppError('Budget Min should be at least 10,000.', 400);
  }
  if (maxBudget <= minBudget) {
    throw new AppError('Budget Max must be greater than Budget Min.', 400);
  }

  // Insert into rpa_mrf_jd_send
  const newMrf = await prisma.rpa_mrf_jd_send.create({
    data: {
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      email: email.trim(),
      cc_email: cc_email ? cc_email.trim() : null,
      role: role.trim(),
      jd_doc_link: jd_doc_link.trim(),
      budget_min: budget_min !== undefined && budget_min !== null ? Number(budget_min) : null,
      budget_max: budget_max !== undefined && budget_max !== null ? Number(budget_max) : null,
      email_body_content: email_body_content || null,
      mrfstatus: 'pending',
      created_at: new Date(),
    },
  });

  // Send MRF notification email to hiring manager (and CC recipients) in the background
  sendMrfRequestEmail({
    first_name: newMrf.first_name,
    last_name: newMrf.last_name,
    email: newMrf.email,
    cc_email: newMrf.cc_email,
    role: newMrf.role,
    jd_doc_link: newMrf.jd_doc_link,
    email_body_content: newMrf.email_body_content,
    budget_min: newMrf.budget_min,
    budget_max: newMrf.budget_max,
    reference_id: newMrf.id,
    frontendUrl: req.headers.origin || config.cors.frontendUrl
  }).catch((err) => {
    console.error(`Error sending MRF email in background: ${err.message}`);
  });

  // Safe serialization (BigInt to string)
  const responseData = {
    ...newMrf,
    id: newMrf.id.toString(),
    mrf_id: newMrf.mrf_id ? newMrf.mrf_id.toString() : null,
  };

  return success(res, responseData, 'MRF request submitted successfully', 201);
});

/**
 * @desc    List and search MRF requests (from rpa_mrf_jd_send)
 * @route   GET /api/mrf
 * @access  Private
 */
export const listMrfRequests = catchAsync(async (req, res) => {
  const { search, status, page = 1, limit = 10 } = req.query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

  const where = {};
  const andConditions = [];

  // Status filtering (e.g. pending, manager submitted)
  if (status && status.toLowerCase() !== 'all') {
    const statusLower = status.trim().toLowerCase();
    if (statusLower === 'pending') {
      andConditions.push({
        mrfstatus: { in: ['pending', 'pendingfromleader'] },
      });
    } else if (statusLower === 'manager submitted' || statusLower === 'managersubmitted') {
      andConditions.push({
        mrfstatus: { in: ['managersubmitted', 'manager submitted'] },
      });
    } else {
      andConditions.push({
        mrfstatus: status.trim(),
      });
    }
  }

  // Free text search
  if (search) {
    andConditions.push({
      OR: [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { role: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  // Query records and count in parallel
  const [records, total] = await Promise.all([
    prisma.rpa_mrf_jd_send.findMany({
      where,
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      orderBy: { created_at: 'desc' },
    }),
    prisma.rpa_mrf_jd_send.count({ where }),
  ]);

  // Fetch approval status for all records in parallel
  const mrfIds = records
    .map((r) => r.mrf_id)
    .filter(Boolean)
    .map((id) => BigInt(id));

  const linkedMrfs = mrfIds.length > 0
    ? await prisma.rpa_mrf.findMany({
        where: { id: { in: mrfIds } },
        select: { id: true, approval_status: true },
      })
    : [];

  const mrfStatusMap = {};
  linkedMrfs.forEach((m) => {
    mrfStatusMap[m.id.toString()] = m.approval_status;
  });

  // Safe BigInt serialization
  const serializedRecords = records.map((record) => {
    const mIdStr = record.mrf_id ? record.mrf_id.toString() : null;
    return {
      ...record,
      id: record.id.toString(),
      mrf_id: mIdStr,
      approval_status: mIdStr ? (mrfStatusMap[mIdStr] || 'pending') : 'pending',
    };
  });

  return paginated(res, serializedRecords, pageNum, limitNum, total, 'MRF requests retrieved successfully');
});

/**
 * @desc    Get a single MRF Request by ID
 * @route   GET /api/mrf/:id
 * @access  Private
 */
export const getMrfRequest = catchAsync(async (req, res) => {
  const { id } = req.params;

  const mrfSend = await prisma.rpa_mrf_jd_send.findUnique({
    where: { id: BigInt(id) },
  });

  if (!mrfSend) {
    throw new AppError('MRF Request not found.', 404);
  }

  let approval_status = 'pending';
  if (mrfSend.mrf_id) {
    const linkedMrf = await prisma.rpa_mrf.findUnique({
      where: { id: BigInt(mrfSend.mrf_id) },
      select: { approval_status: true },
    });
    if (linkedMrf) {
      approval_status = linkedMrf.approval_status;
    }
  }

  const responseData = {
    ...mrfSend,
    id: mrfSend.id.toString(),
    mrf_id: mrfSend.mrf_id ? mrfSend.mrf_id.toString() : null,
    approval_status,
  };

  return success(res, responseData, 'MRF Request retrieved successfully');
});

/**
 * @desc    Update an MRF Request by ID
 * @route   PATCH /api/mrf/:id
 * @access  Private
 */
export const updateMrfRequest = catchAsync(async (req, res) => {
  const { id } = req.params;
  const {
    first_name,
    last_name,
    email,
    role,
    budget_min,
    budget_max,
    mrfstatus,
  } = req.body;

  const mrfSend = await prisma.rpa_mrf_jd_send.findUnique({
    where: { id: BigInt(id) },
  });

  if (!mrfSend) {
    throw new AppError('MRF Request not found.', 404);
  }

  const dataToUpdate = {};
  if (first_name !== undefined) dataToUpdate.first_name = first_name.trim();
  if (last_name !== undefined) dataToUpdate.last_name = last_name.trim();
  if (email !== undefined) dataToUpdate.email = email.trim();
  if (role !== undefined) dataToUpdate.role = role.trim();
  if (budget_min !== undefined) dataToUpdate.budget_min = budget_min !== null ? Number(budget_min) : null;
  if (budget_max !== undefined) dataToUpdate.budget_max = budget_max !== null ? Number(budget_max) : null;
  if (mrfstatus !== undefined) dataToUpdate.mrfstatus = mrfstatus.trim();

  const updated = await prisma.rpa_mrf_jd_send.update({
    where: { id: BigInt(id) },
    data: dataToUpdate,
  });

  let approval_status = 'pending';
  if (updated.mrf_id) {
    const linkedMrf = await prisma.rpa_mrf.findUnique({
      where: { id: BigInt(updated.mrf_id) },
      select: { approval_status: true },
    });
    if (linkedMrf) {
      approval_status = linkedMrf.approval_status;
    }
  }

  const responseData = {
    ...updated,
    id: updated.id.toString(),
    mrf_id: updated.mrf_id ? updated.mrf_id.toString() : null,
    approval_status,
  };

  return success(res, responseData, 'MRF Request updated successfully');
});

/**
 * Columns of rpa_mrf that may be edited via the main-MRF patch endpoint.
 * Mirrors the n8n 1.1.A "update-recruiter-main-mrf-details" updatable set.
 * Read-only columns (id, approval_status, submitter_email, date_of_request,
 * approved_by_abhijit, created_at) are intentionally excluded.
 */
const MAIN_MRF_EDITABLE_FIELDS = [
  'hiring_manager_name', 'hiring_manager_designation', 'required_in',
  'position_hiring_for', 'number_of_positions', 'position_reports_to',
  'requirement_for_team', 'requirement_for_team_other', 'desired_qualification',
  'pg_information', 'graduate_other_information', 'other_qualification_more_info',
  'replacement_or_new_role', 'replacement_comments', 'total_years_of_experience',
  'relevant_years_of_experience', 'project_name', 'project_duration', 'employment_type',
  'existing_resource_allocation', 'existing_resource_information', 'roles_responsibilities',
  'roles_responsibilities_other', 'mandatory_skills', 'mandatory_skills_other',
  'good_to_have_skills', 'good_to_have_skills_other', 'first_technical_round',
  'second_technical_round', 'ceo_management_round', 'ceo_panel_details', 'hr_round',
  'client_round', 'client_round_coordinator', 'job_timing', 'first_round_interview_slot',
  'second_round_interview_slot', 'weekly_meeting_slot', 'client_details',
  'additional_information', 'competencies_required', 'question_paper',
  'question_paper_new_owner', 'jd_attachment', 'online_test_paper_attachment',
  'jd_document_link', 'emailbody',
];

/** Integer columns on rpa_mrf — validated as numeric when provided. */
const MAIN_MRF_NUMERIC_FIELDS = [
  'number_of_positions', 'total_years_of_experience', 'relevant_years_of_experience',
];

/** Boolean columns on rpa_mrf — coerced from yes/no/true/false when provided. */
const MAIN_MRF_BOOLEAN_FIELDS = ['existing_resource_allocation'];

/**
 * @desc    Get a submitted main MRF record (rpa_mrf) for authenticated editing
 * @route   GET /api/mrf/main/:id
 * @access  Private
 */
export const getMainMrf = catchAsync(async (req, res) => {
  const { id } = req.params;

  const mrf = await prisma.rpa_mrf.findUnique({ where: { id: BigInt(id) } });
  if (!mrf) {
    throw new AppError('MRF record not found.', 404);
  }

  // Safe serialization (BigInt -> string)
  const responseData = { ...mrf, id: mrf.id.toString() };
  return success(res, responseData, 'Main MRF details retrieved successfully');
});

/**
 * @desc    Edit a submitted main MRF record (rpa_mrf)
 * @route   PATCH /api/mrf/main/:id
 * @access  Private
 *
 * Mirrors n8n 1.1.A: normalizes input (empty string -> null, trims strings),
 * protects read-only fields, validates numeric fields, and updates only the
 * whitelisted columns of rpa_mrf.
 */
export const updateMainMrf = catchAsync(async (req, res) => {
  const { id } = req.params;

  const existing = await prisma.rpa_mrf.findUnique({ where: { id: BigInt(id) } });
  if (!existing) {
    throw new AppError('MRF record not found.', 404);
  }

  const body = req.body || {};
  const dataToUpdate = {};

  for (const field of MAIN_MRF_EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    let value = body[field];

    // Empty string -> null; trim strings
    if (typeof value === 'string') {
      value = value.trim();
      if (value === '') value = null;
    }

    if (value === null) {
      dataToUpdate[field] = null;
      continue;
    }

    if (MAIN_MRF_NUMERIC_FIELDS.includes(field)) {
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new AppError(`Field "${field}" must be numeric.`, 400);
      }
      dataToUpdate[field] = Math.trunc(num);
    } else if (MAIN_MRF_BOOLEAN_FIELDS.includes(field)) {
      const s = String(value).toLowerCase();
      dataToUpdate[field] = s === 'true' || s === 'yes' || s === '1';
    } else {
      dataToUpdate[field] = value;
    }
  }

  if (Object.keys(dataToUpdate).length === 0) {
    throw new AppError('No editable fields provided.', 400);
  }

  const updated = await prisma.rpa_mrf.update({
    where: { id: BigInt(id) },
    data: dataToUpdate,
  });

  return success(
    res,
    { success: true, updated_id: updated.id.toString(), updated_fields: Object.keys(dataToUpdate) },
    'Main MRF details updated successfully'
  );
});

/**
 * Helper to generate the legacy HTML table representation of the MRF data.
 */
const generateMrfEmailTable = (j, jdLink, testPaperLink) => {
  const v = (val) => {
    if (val === null || val === undefined || val === '') return '';
    return String(val);
  };
  
  return `
<table style="border: 1px solid black; border-collapse: collapse; width: 100%; font-family: Calibri, sans-serif; font-size: 14px;">
<thead>
  <tr style="background-color: #f2f2f2;">
    <th style="border: 1px solid black; padding: 8px; text-align: left;"><b>Field Name</b></th>
    <th style="border: 1px solid black; padding: 8px; text-align: left;"><b>User Submitted Data</b></th>
  </tr>
</thead>
<tbody>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Submitter Email:</td><td style="border: 1px solid black; padding: 8px;">${v(j.submitter_email)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Name of the Hiring Manager:</td><td style="border: 1px solid black; padding: 8px;">${v(j.hiring_manager_name)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Designation of the Hiring Manager:</td><td style="border: 1px solid black; padding: 8px;">${v(j.hiring_manager_designation)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Date of Request:</td><td style="border: 1px solid black; padding: 8px;">${v(j.date_of_request)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Required in:</td><td style="border: 1px solid black; padding: 8px;">${v(j.required_in)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Position hiring for:</td><td style="border: 1px solid black; padding: 8px;">${v(j.position_hiring_for)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Number of Positions:</td><td style="border: 1px solid black; padding: 8px;">${v(j.number_of_positions)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Position reports to:</td><td style="border: 1px solid black; padding: 8px;">${v(j.position_reports_to)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Requirement for the team:</td><td style="border: 1px solid black; padding: 8px;">${v(j.requirement_for_team)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Requirement for team (Other):</td><td style="border: 1px solid black; padding: 8px;">${v(j.requirement_for_team_other)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Desired Qualification:</td><td style="border: 1px solid black; padding: 8px;">${v(j.desired_qualification)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">PG Qualification Info:</td><td style="border: 1px solid black; padding: 8px;">${v(j.pg_information)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Graduate / Other Info:</td><td style="border: 1px solid black; padding: 8px;">${v(j.graduate_other_information)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Other Qualification Info:</td><td style="border: 1px solid black; padding: 8px;">${v(j.other_qualification_more_info)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Replacement or New Role:</td><td style="border: 1px solid black; padding: 8px;">${v(j.replacement_or_new_role)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Replacement Comments:</td><td style="border: 1px solid black; padding: 8px;">${v(j.replacement_comments)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Total Years of Experience:</td><td style="border: 1px solid black; padding: 8px;">${v(j.total_years_of_experience)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Relevant Years of Experience:</td><td style="border: 1px solid black; padding: 8px;">${v(j.relevant_years_of_experience)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Project Name:</td><td style="border: 1px solid black; padding: 8px;">${v(j.project_name)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Project Duration:</td><td style="border: 1px solid black; padding: 8px;">${v(j.project_duration)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Employment Type:</td><td style="border: 1px solid black; padding: 8px;">${v(j.employment_type)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Existing Resource Allocation Possible:</td><td style="border: 1px solid black; padding: 8px;">${v(j.existing_resource_allocation ? 'Yes' : 'No')}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Existing Resource Info:</td><td style="border: 1px solid black; padding: 8px;">${v(j.existing_resource_information)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Roles & Responsibilities:</td><td style="border: 1px solid black; padding: 8px;">${v(j.roles_responsibilities)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Roles & Responsibilities (Other):</td><td style="border: 1px solid black; padding: 8px;">${v(j.roles_responsibilities_other)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Mandatory Skills:</td><td style="border: 1px solid black; padding: 8px;">${v(j.mandatory_skills)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Good to Have Skills:</td><td style="border: 1px solid black; padding: 8px;">${v(j.good_to_have_skills)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">1st Technical Round:</td><td style="border: 1px solid black; padding: 8px;">${v(j.first_technical_round)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">2nd Technical Round:</td><td style="border: 1px solid black; padding: 8px;">${v(j.second_technical_round)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">CEO / Management Round:</td><td style="border: 1px solid black; padding: 8px;">${v(j.ceo_management_round)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">CEO Panel Details:</td><td style="border: 1px solid black; padding: 8px;">${v(j.ceo_panel_details)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">HR Round:</td><td style="border: 1px solid black; padding: 8px;">${v(j.hr_round)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Client Round:</td><td style="border: 1px solid black; padding: 8px;">${v(j.client_round)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Client Round Coordinator:</td><td style="border: 1px solid black; padding: 8px;">${v(j.client_round_coordinator)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Job Timing:</td><td style="border: 1px solid black; padding: 8px;">${v(j.job_timing)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Daily Interview Slot (Round 1):</td><td style="border: 1px solid black; padding: 8px;">${v(j.first_round_interview_slot)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Daily Interview Slot (Round 2):</td><td style="border: 1px solid black; padding: 8px;">${v(j.second_round_interview_slot)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Weekly Meeting Slot:</td><td style="border: 1px solid black; padding: 8px;">${v(j.weekly_meeting_slot)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Client Details:</td><td style="border: 1px solid black; padding: 8px;">${v(j.client_details)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Additional Information:</td><td style="border: 1px solid black; padding: 8px;">${v(j.additional_information)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Competencies Required:</td><td style="border: 1px solid black; padding: 8px;">${v(j.competencies_required)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Question Paper Link:</td><td style="border: 1px solid black; padding: 8px;">${testPaperLink ? `<a href="${testPaperLink}">Click here to view Test Paper</a>` : 'Not Uploaded'}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">Question Paper New Owner:</td><td style="border: 1px solid black; padding: 8px;">${v(j.question_paper_new_owner)}</td></tr>
  <tr><td style="border: 1px solid black; padding: 8px; font-weight: bold;">JD Document Link:</td><td style="border: 1px solid black; padding: 8px;">${jdLink ? `<a href="${jdLink}">Click here to view JD</a>` : 'Not Uploaded'}</td></tr>
</tbody>
</table>
  `;
};

/**
 * @desc    Get pre-fill options based on a manager's email (and optionally role)
 * @route   GET /api/mrf/prefill-options
 * @access  Public
 *
 * Mirrors the n8n form behaviour: returns ALL prior submissions matching the
 * submitter email and (when provided) the position being hired for. The form
 * shows these as a dropdown so the user can pick which prior request to copy.
 */
export const getPrefillOptions = catchAsync(async (req, res) => {
  const { email, role } = req.query;
  if (!email) {
    throw new AppError('Email query parameter is required.', 400);
  }

  const where = {
    submitter_email: { equals: email.trim(), mode: 'insensitive' },
  };
  if (role && role.trim()) {
    where.position_hiring_for = { equals: role.trim(), mode: 'insensitive' };
  }

  const records = await prisma.rpa_mrf.findMany({
    where,
    orderBy: { created_at: 'desc' },
  });

  // Safe serialization (BigInt to string)
  const responseData = records.map((record) => ({
    ...record,
    id: record.id.toString(),
  }));

  return success(res, responseData, 'Prefill options retrieved successfully');
});

/**
 * @desc    Submit form by Hiring Manager, parse files, run Gemini, save and send approval mail
 * @route   POST /api/mrf/submit
 * @access  Public
 */
export const submitHiringManagerMrf = catchAsync(async (req, res) => {
  const {
    submitter_email,
    hiring_manager_name,
    hiring_manager_designation,
    date_of_request,
    required_in,
    position_hiring_for,
    number_of_positions,
    position_reports_to,
    requirement_for_team,
    requirement_for_team_other,
    desired_qualification,
    pg_information,
    graduate_other_information,
    other_qualification_more_info,
    replacement_or_new_role,
    replacement_comments,
    total_years_of_experience,
    relevant_years_of_experience,
    project_name,
    project_duration,
    employment_type,
    existing_resource_allocation,
    existing_resource_information,
    roles_responsibilities,
    roles_responsibilities_other,
    mandatory_skills,
    good_to_have_skills,
    first_technical_round,
    second_technical_round,
    ceo_management_round,
    ceo_panel_details,
    hr_round,
    client_round,
    client_round_coordinator,
    job_timing,
    first_round_interview_slot,
    second_round_interview_slot,
    weekly_meeting_slot,
    client_details,
    additional_information,
    competencies_required,
    question_paper_new_owner,
    approved_by_abhijit,
    parent_id
  } = req.body;

  // 1) Handle File Uploads to OneDrive & JD Text Extraction
  const jdFile = req.files && req.files['attach_jd'] ? req.files['attach_jd'][0] : null;
  const testPaperFile = req.files && req.files['attach_online_test_paper'] ? req.files['attach_online_test_paper'][0] : null;

  let jdUrl = null;
  let testPaperUrl = null;
  let jdText = '';
  let parsedJdJson = null;

  // Process JD File
  if (jdFile) {
    try {
      jdUrl = await uploadFileToOneDrive(jdFile.path, jdFile.originalname);
      const fileBuffer = fs.readFileSync(jdFile.path);
      jdText = await extractTextFromBuffer(fileBuffer, jdFile.mimetype);
    } catch (err) {
      logger.warn(`Failed to process JD file upload/extraction: ${err.message}`);
    } finally {
      // Clean up temp file
      if (fs.existsSync(jdFile.path)) {
        fs.unlink(jdFile.path, (e) => e && logger.warn(`Temp clean fail: ${e.message}`));
      }
    }
  }

  // Process Online Test Paper File
  if (testPaperFile) {
    try {
      testPaperUrl = await uploadFileToOneDrive(testPaperFile.path, testPaperFile.originalname);
    } catch (err) {
      logger.warn(`Failed to upload online test paper: ${err.message}`);
    } finally {
      // Clean up temp file
      if (fs.existsSync(testPaperFile.path)) {
        fs.unlink(testPaperFile.path, (e) => e && logger.warn(`Temp clean fail: ${e.message}`));
      }
    }
  }

  // Run Gemini AI parsing on the extracted JD text
  if (jdText) {
    try {
      parsedJdJson = await parseJobDescription(jdText);
    } catch (err) {
      logger.warn(`Failed to parse extracted text with Gemini: ${err.message}`);
    }
  }

  // Format data types
  const parsedNumPositions = number_of_positions ? parseInt(number_of_positions, 10) : null;
  const parsedTotalExp = total_years_of_experience ? parseInt(total_years_of_experience, 10) : null;
  const parsedRelExp = relevant_years_of_experience ? parseInt(relevant_years_of_experience, 10) : null;
  const parsedDate = date_of_request ? new Date(date_of_request) : new Date();
  // The form now sends "Yes"/"No" (matching n8n); keep back-compat with the
  // previous "true"/boolean encoding.
  const parsedExistingResourceAlloc =
    existing_resource_allocation === 'Yes' ||
    existing_resource_allocation === 'true' ||
    existing_resource_allocation === true;

  // Gather fields to store and compile HTML email body representation
  const inputData = {
    submitter_email,
    hiring_manager_name,
    hiring_manager_designation,
    date_of_request: parsedDate.toLocaleDateString(),
    required_in,
    position_hiring_for,
    number_of_positions: parsedNumPositions,
    position_reports_to,
    requirement_for_team,
    requirement_for_team_other,
    desired_qualification,
    pg_information,
    graduate_other_information,
    other_qualification_more_info,
    replacement_or_new_role,
    replacement_comments,
    total_years_of_experience: parsedTotalExp,
    relevant_years_of_experience: parsedRelExp,
    project_name,
    project_duration,
    employment_type,
    existing_resource_allocation: parsedExistingResourceAlloc,
    existing_resource_information,
    roles_responsibilities,
    roles_responsibilities_other,
    mandatory_skills,
    good_to_have_skills,
    first_technical_round,
    second_technical_round,
    ceo_management_round,
    ceo_panel_details,
    hr_round,
    client_round,
    client_round_coordinator,
    job_timing,
    first_round_interview_slot,
    second_round_interview_slot,
    weekly_meeting_slot,
    client_details,
    additional_information,
    competencies_required,
    question_paper_new_owner,
  };

  const compiledHtmlTable = generateMrfEmailTable(inputData, jdUrl, testPaperUrl);

  // 2) Insert record into rpa_mrf
  const newMrf = await prisma.rpa_mrf.create({
    data: {
      submitter_email: submitter_email ? submitter_email.trim() : null,
      hiring_manager_name: hiring_manager_name ? hiring_manager_name.trim() : null,
      hiring_manager_designation: hiring_manager_designation ? hiring_manager_designation.trim() : null,
      date_of_request: parsedDate,
      required_in: required_in || null,
      position_hiring_for: position_hiring_for ? position_hiring_for.trim() : null,
      number_of_positions: parsedNumPositions,
      position_reports_to: position_reports_to || null,
      requirement_for_team: requirement_for_team || null,
      requirement_for_team_other: requirement_for_team_other || null,
      desired_qualification: desired_qualification || null,
      pg_information: pg_information || null,
      graduate_other_information: graduate_other_information || null,
      other_qualification_more_info: other_qualification_more_info || null,
      replacement_or_new_role: replacement_or_new_role || null,
      replacement_comments: replacement_comments || null,
      total_years_of_experience: parsedTotalExp,
      relevant_years_of_experience: parsedRelExp,
      project_name: project_name || null,
      project_duration: project_duration || null,
      employment_type: employment_type || null,
      existing_resource_allocation: parsedExistingResourceAlloc,
      existing_resource_information: existing_resource_information || null,
      roles_responsibilities: roles_responsibilities || null,
      roles_responsibilities_other: roles_responsibilities_other || null,
      mandatory_skills: mandatory_skills || null,
      good_to_have_skills: good_to_have_skills || null,
      first_technical_round: first_technical_round || null,
      second_technical_round: second_technical_round || null,
      ceo_management_round: ceo_management_round || null,
      ceo_panel_details: ceo_panel_details || null,
      hr_round: hr_round || null,
      client_round: client_round || null,
      client_round_coordinator: client_round_coordinator || null,
      job_timing: job_timing || null,
      first_round_interview_slot: first_round_interview_slot || null,
      second_round_interview_slot: second_round_interview_slot || null,
      weekly_meeting_slot: weekly_meeting_slot || null,
      client_details: client_details || null,
      additional_information: additional_information || null,
      competencies_required: competencies_required || null,
      question_paper: testPaperUrl || null,
      question_paper_new_owner: question_paper_new_owner || null,
      approved_by_abhijit: approved_by_abhijit || 'No',
      jd_attachment: jdFile ? jdFile.originalname : null,
      online_test_paper_attachment: testPaperFile ? testPaperFile.originalname : null,
      jd_document_link: jdUrl || null,
      parsed_jd_json: parsedJdJson ? JSON.parse(JSON.stringify(parsedJdJson)) : null,
      emailbody: compiledHtmlTable,
      approval_status: 'pending',
    },
  });

  // 3) Update Parent rpa_mrf_jd_send record status
  let parentRecord = null;
  if (parent_id) {
    parentRecord = await prisma.rpa_mrf_jd_send.findUnique({
      where: { id: BigInt(parent_id) }
    });
  }

  // Fallback to match by email and role if parent_id is missing or record not found by ID
  if (!parentRecord && submitter_email && position_hiring_for) {
    parentRecord = await prisma.rpa_mrf_jd_send.findFirst({
      where: {
        email: { equals: submitter_email.trim(), mode: 'insensitive' },
        role: { equals: position_hiring_for.trim(), mode: 'insensitive' },
        mrfstatus: 'pending'
      },
      orderBy: { created_at: 'desc' }
    });
  }

  if (parentRecord) {
    await prisma.rpa_mrf_jd_send.update({
      where: { id: parentRecord.id },
      data: {
        mrfstatus: 'managersubmitted',
        mrf_id: Number(newMrf.id)
      }
    });
  }

  // 4) Generate secure approval token
  const token = jwt.sign(
    { mrfId: newMrf.id.toString(), email: submitter_email },
    config.jwt.secret,
    { expiresIn: '30d' }
  );

  // 5) Send interactive email notification to Abhijit Roy / Leaders (runs async)
  sendMrfApprovalEmail({
    mrfRecord: newMrf,
    token,
    frontendUrl: req.headers.origin || config.cors.frontendUrl
  }).catch((err) => {
    logger.error(`Failed to send MRF Approval Email in background: ${err.message}`);
  });

  // 5b) Send the HR-team submission notification (n8n "Send a message To HR"), async
  sendMrfSubmissionHrEmail({ mrfRecord: newMrf }).catch((err) => {
    logger.error(`Failed to send MRF submission HR notification in background: ${err.message}`);
  });

  const responseData = {
    id: newMrf.id.toString(),
    approval_status: newMrf.approval_status
  };

  return success(res, responseData, 'MRF successfully submitted and routed for approval', 201);
});

/**
 * @desc    Fetch MRF details for public approval review (validates token first)
 * @route   GET /api/mrf/public-details/:id
 * @access  Public
 */
export const getPublicMrfDetails = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { token } = req.query;

  if (!token) {
    throw new AppError('Approval token is required to view requisition details.', 400);
  }

  // Verify token
  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    throw new AppError('Invalid or expired approval token.', 401);
  }

  if (decoded.mrfId !== id) {
    throw new AppError('Token verification failed: Resource ID mismatch.', 403);
  }

  const mrf = await prisma.rpa_mrf.findUnique({
    where: { id: BigInt(id) }
  });

  if (!mrf) {
    throw new AppError('Requisition request not found.', 404);
  }

  // Safe serialization (BigInt to string)
  const responseData = {
    ...mrf,
    id: mrf.id.toString(),
  };

  return success(res, responseData, 'MRF details retrieved successfully');
});

/**
 * @desc    Confirm approval or rejection of an MRF
 * @route   POST /api/mrf/:id/approve
 * @access  Public
 */
export const handleMrfApproval = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { token, action, comments } = req.body;

  if (!token || !action) {
    throw new AppError('Token and action parameters are required.', 400);
  }

  // Verify token
  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    throw new AppError('Invalid or expired approval token.', 401);
  }

  if (decoded.mrfId !== id) {
    throw new AppError('Token verification failed: Resource ID mismatch.', 403);
  }

  const mrf = await prisma.rpa_mrf.findUnique({
    where: { id: BigInt(id) }
  });

  if (!mrf) {
    throw new AppError('Requisition request not found.', 404);
  }

  const currentStatus = (mrf.approval_status || '').toLowerCase();
  if (currentStatus !== 'pending' && currentStatus !== 'waiting') {
    throw new AppError('This requisition request has already been processed.', 400);
  }

  const isApproved = action.toLowerCase() === 'approve';

  // Update DB status
  const updatedMrf = await prisma.rpa_mrf.update({
    where: { id: BigInt(id) },
    data: {
      approval_status: isApproved ? 'approved' : 'rejected'
    }
  });

  // Update parent rpa_mrf_jd_send status to approved/rejected
  const parentSend = await prisma.rpa_mrf_jd_send.findFirst({
    where: { mrf_id: Number(id) }
  });

  if (parentSend) {
    await prisma.rpa_mrf_jd_send.update({
      where: { id: parentSend.id },
      data: {
        mrfstatus: isApproved ? 'approved' : 'rejected'
      }
    });
  }

  // Import and send the outcome email notification
  import('../services/emailNotification.service.js')
    .then((module) => {
      module.sendMrfOutcomeEmail({
        mrfRecord: updatedMrf,
        approved: isApproved,
        comments: comments || '',
        approverName: decoded.email,
        hmEmail: updatedMrf.submitter_email || (parentSend && parentSend.email) || ''
      }).catch((err) => {
        logger.error(`Error sending MRF outcome email: ${err.message}`);
      });
    })
    .catch((err) => {
      logger.error(`Failed to import email module for outcome notifications: ${err.message}`);
    });

  return success(res, { approval_status: updatedMrf.approval_status }, `Requisition request successfully ${updatedMrf.approval_status}`);
});

