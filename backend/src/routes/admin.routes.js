import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import { authenticate, restrictTo } from '../middleware/auth.js';
import { exportLimiter } from '../middleware/exportRateLimit.js';
import * as systemLogs from '../controllers/systemLogs.controller.js';

const router = Router();

// Restrict all routes to admin and superadmin roles
router.use(authenticate, restrictTo('admin', 'superadmin'));

// Verify token (used by gatekeeper)
router.get('/auth/verify', adminController.verifyToken);

// User Management CRUD
router.get('/users/list', adminController.listUsers);
router.get('/users/export', exportLimiter, adminController.exportUsers);
router.get('/users/check-email', adminController.checkEmail);
router.post('/users/create', adminController.createUser);
router.post('/users/update', adminController.updateUser);
router.post('/users/delete', adminController.deleteUser);
router.post('/users/toggle-status', adminController.toggleStatus);

// Module Access management
router.get('/modules/get-access', adminController.getModulesAccess);
router.post('/modules/set-access', adminController.setModulesAccess);

// Referral Log — the audit trail behind the referral flag.
//
// Admin-tier by inheritance from the router-wide restrictTo above, which is the
// whole access decision. Deliberately here rather than beside the recruiter
// screens: any recruiter may SET a referral, but only admin-tier may remove one
// or read the record of who did (docs/REFERRAL-CANDIDATE-PLAN.md section 6.4).
router.get('/referral-log', adminController.listReferralAudit);
router.get('/referral-log/export', exportLimiter, adminController.exportReferralAudit);

// Logs & errors (N42). Super Admin only, narrower than the router-wide rule
// above: the errors and log lines cover every company.
router.get('/errors', restrictTo('superadmin'), systemLogs.listErrors);
router.get('/logs', restrictTo('superadmin'), systemLogs.findByRef);
router.get('/jobs', restrictTo('superadmin'), systemLogs.listJobs);
router.get('/health/deep', restrictTo('superadmin'), systemLogs.deepHealth);

export default router;
