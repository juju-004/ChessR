import { Router } from 'express';
import {
  adminLogin,
  listReports,
  getReportDetail,
  updateReport,
} from '../controllers/admin.controller.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = Router();

router.post('/login', adminLogin);
router.get('/reports', requireAdmin, listReports);
router.get('/reports/:id', requireAdmin, getReportDetail);
router.patch('/reports/:id', requireAdmin, updateReport);

export default router;
