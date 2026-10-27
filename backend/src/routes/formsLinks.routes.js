/**
 * /api/forms-links — Forms & Links (L08): every link the ATS has sent, with
 * Copy, Re-send, Renew and Revoke.
 *
 * Staff only: vendors never see this page or its data. The pipeline-backed
 * link types are further limited, inside the service, to people who can open
 * the Candidate Pipeline (the recruitment_pipeline module), the board's rule.
 */
import { Router } from 'express';
import { authenticate, requireStaff } from '../middleware/auth.js';
import * as controller from '../controllers/formsLinks.controller.js';

const router = Router();

router.use(authenticate);
router.use(requireStaff);

router.get('/', controller.list);
router.get('/summary', controller.summary);
router.get('/standing', controller.standing);
router.post('/:type/:id/copy', controller.copy);
router.post('/:type/:id/resend', controller.resend);
router.post('/:type/:id/renew', controller.renew);
router.post('/:type/:id/revoke', controller.revoke);

export default router;
