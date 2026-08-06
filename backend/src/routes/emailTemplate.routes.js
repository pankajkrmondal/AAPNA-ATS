import { Router } from 'express';
import * as emailTemplateController from '../controllers/emailTemplate.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

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

export default router;
