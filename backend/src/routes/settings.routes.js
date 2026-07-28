import { Router } from 'express';
import * as settingsController from '../controllers/settings.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Require authentication for all settings operations
router.use(authenticate);

router.get('/reminder', settingsController.getReminderSettings);
router.post('/reminder', settingsController.saveReminderSettings);

/** Evalground Assessment automation — deadline days + auto-advance/reject toggle. */
router.get('/assessment-automation', settingsController.getAssessmentAutomation);
router.post('/assessment-automation', settingsController.saveAssessmentAutomation);

export default router;
