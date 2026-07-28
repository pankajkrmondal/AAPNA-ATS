import prisma from '../config/database.js';
import config from '../config/index.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';

/**
 * Structural placeholders that the sending service injects as HTML fragments
 * (a Teams-join button, a cancellation-reason paragraph) rather than content a
 * recruiter edits. They are declared on a template's `placeholders` array so
 * the compiler knows about them, but must NOT be enforced as "required" when a
 * recruiter edits the template — removing them from the body is legitimate.
 * Kept in sync with the same constant in frontend/src/pages/EmailManagement.jsx.
 */
const OPTIONAL_PLACEHOLDERS = new Set(['teams_line', 'reason_line']);

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

    // Inject-only structural fragments are optional — never report them missing.
    if (OPTIONAL_PLACEHOLDERS.has(cleanPlaceholder)) continue;

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

/**
 * @desc    Email delivery monitoring: send/tracking stats, per-type breakdown,
 *          recent failures, and mailbox poller status
 * @route   GET /api/email/monitoring?days=30
 * @access  Private (Recruiter/Admin)
 */
export const getEmailMonitoring = catchAsync(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [logCounts, trackingRows, byTypeCounts, recentFailures, deltaRow, account] = await Promise.all([
    prisma.rpa_email_log.groupBy({
      by: ['status'],
      where: { sent_at: { gte: since } },
      _count: { _all: true },
    }),
    prisma.$queryRaw`
      SELECT
        COUNT(*)                          AS tracked,
        COUNT(*) FILTER (WHERE t.opened)  AS opened,
        COUNT(*) FILTER (WHERE t.replied) AS replied,
        COUNT(*) FILTER (WHERE t.bounced) AS bounced
      FROM rpa_email_tracking t
      JOIN rpa_email_messages m ON m.id = t.message_id
      WHERE COALESCE(m.sent_at, m.created_at) >= ${since}
    `,
    prisma.rpa_email_log.groupBy({
      by: ['email_type', 'status'],
      where: { sent_at: { gte: since } },
      _count: { _all: true },
    }),
    prisma.rpa_email_log.findMany({
      where: { status: 'failed', sent_at: { gte: since } },
      orderBy: { sent_at: 'desc' },
      take: 20,
      select: {
        id: true,
        email_type: true,
        recipient_email: true,
        subject: true,
        error_message: true,
        sent_at: true,
      },
    }),
    prisma.rpa_settings.findUnique({ where: { key: 'mailbox_delta_link' } }),
    prisma.rpa_outlook_accounts.findFirst({
      where: { outlook_email: config.microsoft.defaultSender },
      select: { last_sync_at: true },
    }),
  ]);

  const statusTotal = (status) =>
    logCounts.find((r) => r.status === status)?._count._all || 0;
  const tracking = trackingRows[0] || {};

  // Fold the type×status groupBy into one row per email type.
  const byTypeMap = {};
  for (const row of byTypeCounts) {
    const entry = (byTypeMap[row.email_type] ??= { email_type: row.email_type, sent: 0, failed: 0 });
    if (row.status === 'failed') entry.failed += row._count._all;
    else entry.sent += row._count._all;
  }
  const byType = Object.values(byTypeMap).sort(
    (a, b) => b.sent + b.failed - (a.sent + a.failed)
  );

  return success(
    res,
    {
      window_days: days,
      summary: {
        sent: statusTotal('sent'),
        failed: statusTotal('failed'),
        // Tracking is per outbound conversation message (shortlist/status/
        // reminder/reply sends), a subset of all rpa_email_log rows.
        tracked: Number(tracking.tracked || 0),
        opened: Number(tracking.opened || 0),
        replied: Number(tracking.replied || 0),
        bounced: Number(tracking.bounced || 0),
      },
      by_type: byType,
      recent_failures: recentFailures,
      poller_status: {
        intake_enabled: config.email.intake.enabled,
        inbound_sync_enabled: config.email.inboundSync.enabled,
        cron: config.email.mailboxSync.cron,
        delta_link_present: Boolean(deltaRow?.value),
        last_sync_at: account?.last_sync_at || null,
        mailbox: config.microsoft.defaultSender,
      },
    },
    'Email monitoring data retrieved successfully'
  );
});
