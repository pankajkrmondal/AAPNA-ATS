import { Router } from 'express';
import * as emailTemplateController from '../controllers/emailTemplate.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Require authentication for all email template actions
router.use(authenticate);

router.get('/templates', emailTemplateController.getEmailTemplates);
router.get('/templates/:id', emailTemplateController.getEmailTemplateById);
router.put('/templates/:id', emailTemplateController.updateEmailTemplate);

export default router;
