import { Router } from 'express';
import authRoutes from './auth.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import candidateRoutes from './candidate.routes.js';
import vendorRoutes from './vendor.routes.js';
import adminRoutes from './admin.routes.js';
import companyRoutes from './company.routes.js';
import mrfRoutes from './mrf.routes.js';
import settingsRoutes from './settings.routes.js';
import hrUploadRoutes from './hrUpload.routes.js';
import screeningRoutes from './screening.routes.js';
import emailTemplateRoutes from './emailTemplate.routes.js';

const router = Router();

// ── Mounted sub-routers ───────────────────────────────────────────────
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/candidates', candidateRoutes);
router.use('/vendor', vendorRoutes);
// Mount the more-specific /admin/companies before /admin so its prefix matches first.
router.use('/admin/companies', companyRoutes);
router.use('/admin', adminRoutes);
router.use('/hr-upload', hrUploadRoutes);
router.use('/screening', screeningRoutes);

// ── Placeholder routes (to be implemented in later phases) ────────────
// Each placeholder returns a friendly "coming soon" message so the
// route namespace is reserved and the frontend won't get 404s.

const placeholder = (moduleName) => (_req, res) => {
  res.status(200).json({
    status: 'success',
    message: `${moduleName} module — coming soon`,
    data: null,
  });
};

router.use('/mrf', mrfRoutes);
router.use('/settings', settingsRoutes);
router.use('/email', emailTemplateRoutes);
router.use('/notifications', Router().get('/', placeholder('Notifications')));
router.use('/zeko', Router().get('/', placeholder('Zeko AI')));
router.use('/analytics', Router().get('/', placeholder('Analytics')));
router.use('/resumes', Router().get('/', placeholder('Resumes')));

export default router;
