import { Router } from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { getMyCageMatches, getCageMatchByCodeHandler } from '../controllers/cageMatch.controller.js';
import { getCageInviteOgCard } from '../controllers/og.controller.js';

const router = Router();

router.get('/mine', requireAuth, getMyCageMatches);
// No auth: fetched by link-preview crawlers (WhatsApp, etc.), which never
// carry a session. See og.controller.ts.
router.get('/invite/:linkId/card', getCageInviteOgCard);
router.get('/code/:code', optionalAuth, getCageMatchByCodeHandler);

export default router;
