import { Router } from 'express';
import * as companyController from '../controllers/company.controller.js';
import { authenticate, restrictTo } from '../middleware/auth.js';
import { ROLES } from '../config/roles.js';

const router = Router();

// Company management is a global concern — superadmin only.
router.use(authenticate, restrictTo(ROLES.SUPERADMIN));

router.get('/list', companyController.listCompanies);
router.post('/create', companyController.createCompany);
router.post('/update', companyController.updateCompany);
router.post('/toggle-status', companyController.toggleCompanyStatus);

export default router;
