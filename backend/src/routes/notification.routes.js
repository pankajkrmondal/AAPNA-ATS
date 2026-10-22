import { Router } from 'express';
import * as notificationController from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

/**
 * The in-app notification centre. Authenticated but NOT module-gated: the bell
 * sits in the header on every page, so a user who can log in can read their own
 * inbox regardless of which modules they have access to.
 */
router.use(authenticate);

/** GET /api/notifications — the bell's list (+ unread count). */
router.get('/', notificationController.list);

/** GET /api/notifications/unread-count — badge only. */
router.get('/unread-count', notificationController.getUnreadCount);

/** POST /api/notifications/read-all — registered before /:id so it isn't parsed as an id. */
router.post('/read-all', notificationController.markAllRead);

/** POST /api/notifications/:id/read */
router.post('/:id/read', notificationController.markRead);

export default router;
