import { Router } from 'express';
import { submitReport } from '../controllers/report.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/', requireAuth, submitReport);

export default router;
