import { Router } from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { getMyCageMatches, getCageMatchByCodeHandler } from '../controllers/cageMatch.controller.js';

const router = Router();

router.get('/mine', requireAuth, getMyCageMatches);
router.get('/code/:code', optionalAuth, getCageMatchByCodeHandler);

export default router;
