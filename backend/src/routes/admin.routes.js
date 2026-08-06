import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import { authenticate, restrictTo } from '../middleware/auth.js';

const router = Router();

// Restrict all routes to admin and superadmin roles
router.use(authenticate, restrictTo('admin', 'superadmin'));

// Verify token (used by gatekeeper)
router.get('/auth/verify', adminController.verifyToken);

// User Management CRUD
router.get('/users/list', adminController.listUsers);
router.get('/users/check-email', adminController.checkEmail);
router.post('/users/create', adminController.createUser);
router.post('/users/update', adminController.updateUser);
router.post('/users/delete', adminController.deleteUser);
router.post('/users/toggle-status', adminController.toggleStatus);

// Module Access management
router.get('/modules/get-access', adminController.getModulesAccess);
router.post('/modules/set-access', adminController.setModulesAccess);

export default router;
