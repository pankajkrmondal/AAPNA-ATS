import prisma from '../config/database.js';
import { success, paginated } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';

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
        OR: [
          { mrfstatus: { equals: 'pending', mode: 'insensitive' } },
          { mrfstatus: { equals: 'pendingfromleader', mode: 'insensitive' } },
        ],
      });
    } else if (statusLower === 'manager submitted' || statusLower === 'managersubmitted') {
      andConditions.push({
        OR: [
          { mrfstatus: { equals: 'managersubmitted', mode: 'insensitive' } },
          { mrfstatus: { equals: 'manager submitted', mode: 'insensitive' } },
        ],
      });
    } else {
      andConditions.push({
        mrfstatus: {
          equals: status.trim(),
          mode: 'insensitive',
        },
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
