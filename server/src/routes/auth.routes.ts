import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { signup, signin, refresh, logout, me } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Tighter limit on credential-guessing surfaces.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});

router.post('/signup', authLimiter, signup);
router.post('/signin', authLimiter, signin);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', requireAuth, me);

export default router;
