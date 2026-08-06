import { Router } from 'express';
import * as pipelineController from '../controllers/pipeline.controller.js';
import { authenticate, checkModuleAccess, requireAdmin } from '../middleware/auth.js';
import assessmentImportRoutes from './assessmentImport.routes.js';

const router = Router();

// Phase 3 Module 1 — Stage Engine + Pipeline Tracker.
router.use(authenticate);
router.use(checkModuleAccess('recruitment_pipeline'));

// Stage/outcome/reason config CRUD is admin-only (RT ask 2026-07-13); the gate
// itself now lives in middleware/auth.js so the templates routes share it.

/** GET /api/pipeline — board data (columns + cards), filterable. */
router.get('/', pipelineController.listPipeline);

/** GET /api/pipeline/analytics — real funnel/stuck/rejection/time-to-hire/vendor/source data.
 * Registered before "/:id" so "analytics" is never captured as a pipeline id. */
router.get('/analytics', pipelineController.getPipelineAnalytics);

/** GET /api/pipeline/stages — admin-configurable stage list. */
router.get('/stages', pipelineController.listStages);
/** POST /api/pipeline/stages — create a stage (admin only). */
router.post('/stages', requireAdmin, pipelineController.createStage);
/** PUT /api/pipeline/stages/:key — edit a stage (admin only). */
router.put('/stages/:key', requireAdmin, pipelineController.updateStage);
/** POST /api/pipeline/stages/:key/outcomes — add an outcome to a stage (admin only). */
router.post('/stages/:key/outcomes', requireAdmin, pipelineController.createStageOutcome);
/** PUT /api/pipeline/stages/:key/outcomes/:outcomeKey — edit an outcome (admin only). */
router.put('/stages/:key/outcomes/:outcomeKey', requireAdmin, pipelineController.updateStageOutcome);

/** GET /api/pipeline/reasons — full reason taxonomy. */
router.get('/reasons', pipelineController.listReasons);
/** POST /api/pipeline/reasons — add a reason (admin only). */
router.post('/reasons', requireAdmin, pipelineController.createReason);
/** PUT /api/pipeline/reasons/:id — edit a reason (admin only). */
router.put('/reasons/:id', requireAdmin, pipelineController.updateReason);

/** Interview cancel + its email preview. Registered before "/:id" so
 * "interview" is never captured as a pipeline id. */
router.post('/interview/:scheduleId/cancel', pipelineController.cancelScheduledInterview);
router.get('/interview/:scheduleId/cancel-preview', pipelineController.getCancelPreview);
/** Record whether the interview happened (held/no_show) — the scorecard gate. */
router.post('/interview/:scheduleId/occurrence', pipelineController.recordInterviewOccurrence);
/** Manually send the scorecard link (idempotent; only after 'held'). */
router.post('/interview/:scheduleId/send-scorecard', pipelineController.sendScorecard);
/** Per-document verify/reject. Registered before "/:id" so "documents" is
 * never captured as a pipeline id. */
router.post('/documents/:docId/verify', pipelineController.verifyDocument);
router.post('/documents/:docId/reject', pipelineController.rejectDocument);
/** /api/pipeline/assessment-import/* — Phase 3 M2, Evalground bulk-CSV import.
 * Registered before "/:id" so "assessment-import" is never captured as a pipeline id. */
router.use('/assessment-import', assessmentImportRoutes);

/** GET /api/pipeline/:id — full journey detail (feeds the per-round drawer). */
router.get('/:id', pipelineController.getPipelineDetail);
/** GET /api/pipeline/:id/scorecard-report — per-round scores + overall avg/sum. */
router.get('/:id/scorecard-report', pipelineController.getScorecardReport);
/** POST /api/pipeline/:id/interview — book the interview for a schedulable round. */
router.post('/:id/interview', pipelineController.scheduleInterview);
/** GET /api/pipeline/:id/interview-preview — editable invite email preview. */
router.get('/:id/interview-preview', pipelineController.getSchedulePreview);
/** POST /api/pipeline/:id/interview/reschedule — cancel current booking + rebook. */
router.post('/:id/interview/reschedule', pipelineController.rescheduleInterview);
/** GET /api/pipeline/:id/interview/reschedule-preview — editable reschedule email preview. */
router.get('/:id/interview/reschedule-preview', pipelineController.getReschedulePreview);
/** GET /api/pipeline/:id/outcome-preview?outcome_key=X — compiled email preview, no send. */
router.get('/:id/outcome-preview', pipelineController.getOutcomePreview);
/** POST /api/pipeline/:id/outcome — record Approve/Reject/Hold (reason mandatory); Approve auto-advances. */
router.post('/:id/outcome', pipelineController.setStageOutcome);
/** POST /api/pipeline/:id/advance — move to the next stage (or explicitly skip an optional one). */
router.post('/:id/advance', pipelineController.advanceStage);
/** POST /api/pipeline/:id/closure — set the final/closure outcome (Q12). */
router.post('/:id/closure', pipelineController.setFinalOutcome);

/** Documents round (Module 4) — recruiter-facing half; the candidate uploads
 * through the public token route in document.routes.js. */
router.get('/:id/documents', pipelineController.getDocumentStatus);
router.post('/:id/documents/request', pipelineController.requestDocuments);
router.post('/:id/documents/remind', pipelineController.remindDocuments);

/** Offer round (Module 5) — record-only; the letter itself never enters the ATS. */
router.post('/:id/offer/request-approval', pipelineController.requestOfferApproval);
router.post('/:id/offer/approve', pipelineController.approveOffer);
router.post('/:id/offer/share', pipelineController.recordOfferShared);
router.post('/:id/offer/decision', pipelineController.recordOfferDecision);
/** POST /api/pipeline/:id/email — ad-hoc per-candidate email override (RT ask 2026-07-14). */
router.post('/:id/email', pipelineController.sendAdHocEmail);

export default router;
