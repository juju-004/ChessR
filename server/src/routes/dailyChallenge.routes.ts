import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getDailyChallenges } from '../controllers/dailyChallenge.controller.js';

const router = Router();
router.get('/', requireAuth, getDailyChallenges);
export default router;
