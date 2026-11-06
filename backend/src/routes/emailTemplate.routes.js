import { Router } from 'express';
import * as emailTemplateController from '../controllers/emailTemplate.controller.js';
import { authenticate, checkModuleAccess, requireAdmin, requireStaff, restrictTo } from '../middleware/auth.js';
import { exportLimiter } from '../middleware/exportRateLimit.js';
import { MODULES, RECRUITER_TIER_ROLES } from '../config/roles.js';

/**
 * Roles allowed to bulk-export delivery logs. Vendors are excluded: the
 * failures table carries candidate `recipient_email` and subject lines, i.e.
 * other people's PII. Vendors have no UI route to Analytics, but that is a
 * client-side confinement — their token can call the API directly.
 */
const MONITORING_EXPORT_ROLES = [...RECRUITER_TIER_ROLES];

const router = Router();

// D-05: staff only. A vendor token could read every template. The reads stay open
// to all staff because the shortlist/reject email dialog and the pipeline config
// load templates; changing one follows the System Configuration toggle.
router.use(authenticate, requireStaff);

router.get('/templates', emailTemplateController.getEmailTemplates);
/** POST /api/email/templates — create a template (admin only). Creating shapes
 * the configuration; editing an existing one stays open to recruiters. */
router.post('/templates', requireAdmin, emailTemplateController.createEmailTemplate);
router.get('/templates/:id', emailTemplateController.getEmailTemplateById);
router.put('/templates/:id', checkModuleAccess(MODULES.SYSTEM_CONFIG), emailTemplateController.updateEmailTemplate);

// Delivery monitoring (send/tracking stats, recent failures, poller status)
router.get('/monitoring', emailTemplateController.getEmailMonitoring);

/** CSV of one Email Delivery table (?table=by_type|failures&days=30). */
router.get('/monitoring/export', restrictTo(...MONITORING_EXPORT_ROLES), exportLimiter, emailTemplateController.exportEmailMonitoring);

export default router;
