import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { getMine, submitRequest } from '../controllers/organization.controller.js';

const router = Router();

// Filing a request is rare; this just stops someone hammering the admin queue.
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/mine', requireAuth, getMine);
router.post('/request', requireAuth, requestLimiter, submitRequest);

export default router;
