import { Router } from 'express';
import {
  adminLogin,
  listReports,
  getReportDetail,
  updateReport,
  setUserReportingBlock,
  getRevenueSummary,
  listGameFlags,
  updateGameFlag,
} from '../controllers/admin.controller.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = Router();

router.post('/login', adminLogin);
router.get('/reports', requireAdmin, listReports);
router.get('/reports/:id', requireAdmin, getReportDetail);
router.patch('/reports/:id', requireAdmin, updateReport);
router.patch('/users/:username/reporting-block', requireAdmin, setUserReportingBlock);
router.get('/revenue', requireAdmin, getRevenueSummary);
router.get('/game-flags', requireAdmin, listGameFlags);
router.patch('/game-flags/:id', requireAdmin, updateGameFlag);

export default router;
