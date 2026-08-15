import { Router } from 'express';
import {
  adminLogin,
  listReports,
  getReportDetail,
  updateReport,
  setUserReportingBlock,
  getRevenueSummary,
} from '../controllers/admin.controller.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = Router();

router.post('/login', adminLogin);
router.get('/reports', requireAdmin, listReports);
router.get('/reports/:id', requireAdmin, getReportDetail);
router.patch('/reports/:id', requireAdmin, updateReport);
router.patch('/users/:username/reporting-block', requireAdmin, setUserReportingBlock);
router.get('/revenue', requireAdmin, getRevenueSummary);

export default router;
