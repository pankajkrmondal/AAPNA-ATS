import { Router } from 'express';
import * as settingsController from '../controllers/settings.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Require authentication for all settings operations
router.use(authenticate);

router.get('/reminder', settingsController.getReminderSettings);
router.post('/reminder', settingsController.saveReminderSettings);

// Interview reminder scheduler (on/off + poll interval) for booked technical rounds
router.get('/interview-reminder', settingsController.getInterviewReminderConfig);
router.post('/interview-reminder', settingsController.saveInterviewReminderConfig);

// Interview occurrence sweep (on/off + poll interval + grace) — the post-interview
// "did it happen?" gate that guards scorecard dispatch.
router.get('/interview-occurrence', settingsController.getInterviewOccurrenceConfig);
router.post('/interview-occurrence', settingsController.saveInterviewOccurrenceConfig);
/** Evalground Assessment automation — deadline days + auto-advance/reject toggle. */
router.get('/assessment-automation', settingsController.getAssessmentAutomation);
router.post('/assessment-automation', settingsController.saveAssessmentAutomation);

/** Email flow keys — who receives each kind of mail. Admin-gated in the
 *  controller (same pattern as assessment-automation above). */
router.get('/flow-keys', settingsController.getFlowKeys);
router.post('/flow-keys', settingsController.saveFlowKey);

export default router;
