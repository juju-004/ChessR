import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  signup,
  signin,
  googleSignin,
  refresh,
  logout,
  me,
  verifyEmail,
  resendVerification,
} from '../controllers/auth.controller.js';
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

// Separate, tighter limiter for "resend verification email" specifically —
// distinct from authLimiter above so a burst of failed signin attempts
// can't also burn through someone's resend budget, and tight enough
// (5/15min) that it can't be used to spam an arbitrary inbox, since this
// route requires being signed in as the account it's mailing.
const resendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many resend attempts, please try again later.' },
});

router.post('/signup', authLimiter, signup);
router.post('/signin', authLimiter, signin);
router.post('/google', authLimiter, googleSignin);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', requireAuth, me);
router.post('/verify-email', authLimiter, verifyEmail);
router.post('/resend-verification', requireAuth, resendLimiter, resendVerification);

export default router;
