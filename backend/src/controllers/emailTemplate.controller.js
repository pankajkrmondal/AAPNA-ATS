import prisma from '../config/database.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';

/**
 * @desc    Get all email templates
 * @route   GET /api/email/templates
 * @access  Private (Recruiter/Admin)
 */
export const getEmailTemplates = catchAsync(async (req, res) => {
  const templates = await prisma.rpa_email_templates.findMany({
    orderBy: { name: 'asc' },
  });
  return success(res, templates, 'Email templates retrieved successfully');
});

/**
 * @desc    Get details of a single email template
 * @route   GET /api/email/templates/:id
 * @access  Private (Recruiter/Admin)
 */
export const getEmailTemplateById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const template = await prisma.rpa_email_templates.findUnique({
    where: { id: parseInt(id, 10) },
  });

  if (!template) {
    throw new AppError('Email template not found', 404);
  }

  return success(res, template, 'Email template retrieved successfully');
});

/**
 * @desc    Update template subject and body
 * @route   PUT /api/email/templates/:id
 * @access  Private (Recruiter/Admin)
 */
export const updateEmailTemplate = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { subject, body_html } = req.body;

  if (!subject || !body_html) {
    throw new AppError('Subject and body_html are required fields.', 400);
  }

  const template = await prisma.rpa_email_templates.findUnique({
    where: { id: parseInt(id, 10) },
  });

  if (!template) {
    throw new AppError('Email template not found', 404);
  }

  // Pre-save validation: verify required placeholders are present
  const contentToValidate = (subject + ' ' + body_html).toLowerCase();
  const missingPlaceholders = [];

  for (const placeholder of template.placeholders) {
    // Clean brackets: e.g. "{candidate_name}" -> "candidate_name", "candidate_name" -> "candidate_name"
    const cleanPlaceholder = placeholder.replace(/[{}]/g, '').toLowerCase();
    
    // Check for both double and single curly braces: e.g. {{candidate_name}} and {candidate_name}
    const hasDouble = contentToValidate.includes(`{{${cleanPlaceholder}}}`);
    const hasSingle = contentToValidate.includes(`{${cleanPlaceholder}}`);
    
    // Also support aliases: e.g. job_title vs position
    let hasAlias = false;
    if (cleanPlaceholder === 'job_title' || cleanPlaceholder === 'position') {
      hasAlias = 
        contentToValidate.includes('{{job_title}}') || 
        contentToValidate.includes('{job_title}') || 
        contentToValidate.includes('{{position}}') || 
        contentToValidate.includes('{position}');
    }

    if (!hasDouble && !hasSingle && !hasAlias) {
      missingPlaceholders.push(placeholder);
    }
  }

  if (missingPlaceholders.length > 0) {
    throw new AppError(
      `Validation Failed: The following required placeholders are missing: ${missingPlaceholders.join(', ')}`,
      400
    );
  }

  const updatedTemplate = await prisma.rpa_email_templates.update({
    where: { id: parseInt(id, 10) },
    data: {
      subject,
      body_html,
      modified_at: new Date(),
    },
  });

  return success(res, updatedTemplate, 'Email template updated successfully');
});
