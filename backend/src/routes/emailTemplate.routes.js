import { Router } from 'express';
import * as emailTemplateController from '../controllers/emailTemplate.controller.js';
import { authenticate, requireAdmin, restrictTo } from '../middleware/auth.js';
import { exportLimiter } from '../middleware/exportRateLimit.js';

/**
 * Roles allowed to bulk-export delivery logs. Vendors are excluded: the
 * failures table carries candidate `recipient_email` and subject lines, i.e.
 * other people's PII. Vendors have no UI route to Analytics, but that is a
 * client-side confinement — their token can call the API directly.
 */
const MONITORING_EXPORT_ROLES = ['admin', 'superadmin', 'recruiter', 'hr'];

const router = Router();

// Require authentication for all email template actions
router.use(authenticate);

router.get('/templates', emailTemplateController.getEmailTemplates);
/** POST /api/email/templates — create a template (admin only). Creating shapes
 * the configuration; editing an existing one stays open to recruiters. */
router.post('/templates', requireAdmin, emailTemplateController.createEmailTemplate);
router.get('/templates/:id', emailTemplateController.getEmailTemplateById);
router.put('/templates/:id', emailTemplateController.updateEmailTemplate);

// Delivery monitoring (send/tracking stats, recent failures, poller status)
router.get('/monitoring', emailTemplateController.getEmailMonitoring);

/** CSV of one Email Delivery table (?table=by_type|failures&days=30). */
router.get('/monitoring/export', restrictTo(...MONITORING_EXPORT_ROLES), exportLimiter, emailTemplateController.exportEmailMonitoring);

export default router;
