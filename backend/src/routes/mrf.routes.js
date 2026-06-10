import { Router } from 'express';
import * as mrfController from '../controllers/mrf.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Require authentication for all MRF actions
router.use(authenticate);

router.post('/', mrfController.createMrfRequest);
router.get('/', mrfController.listMrfRequests);
router.get('/:id', mrfController.getMrfRequest);
router.patch('/:id', mrfController.updateMrfRequest);

export default router;
