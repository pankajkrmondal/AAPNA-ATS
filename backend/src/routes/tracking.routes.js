import { Router } from 'express';
import { trackOpen } from '../controllers/tracking.controller.js';

const router = Router();

// PUBLIC routes — intentionally NO authenticate middleware: the open-tracking
// pixel is fetched by candidates' mail clients, which have no ATS session.
// The token is an unguessable uuid and the handler only ever returns a 1×1 GIF.
router.get('/open/:token', trackOpen);

export default router;
