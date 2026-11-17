/**
 * PUBLIC routes: intentionally NO authenticate middleware (U08).
 *
 * The Zeko interview link in our email is /api/z/<link_token>, one token per
 * booking. A candidate with a phone on file is sent straight on to Zeko; one
 * without is shown the optional /zeko-start page first. The uuid token is the
 * only credential; state is checked on every request in zekoLink.service.js.
 */
import { Router } from 'express';
import { zekoLinkLimiter, zekoPhoneLimiter } from '../middleware/zekoLinkRateLimit.js';
import { redirectZekoLink, zekoLinkInfo, zekoLinkPhone } from '../controllers/zekoLink.controller.js';

const router = Router();

router.get('/:token', zekoLinkLimiter, redirectZekoLink);
router.get('/:token/info', zekoLinkLimiter, zekoLinkInfo);
router.post('/:token/phone', zekoPhoneLimiter, zekoLinkPhone);

export default router;
