import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import {
  getPlans,
  getBalance,
  initPurchase,
  verifyPurchase,
  getBanks,
  resolveAccount,
  withdraw,
  getTransactions,
} from '../controllers/wallet.controller.js';

const router = Router();

// Withdrawals move real money — much tighter limit than the general API.
const withdrawLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many withdrawal attempts, please try again later.' },
});

router.get('/plans', getPlans);
router.get('/balance', requireAuth, getBalance);
router.post('/purchase', requireAuth, initPurchase);
router.post('/purchase/verify', requireAuth, verifyPurchase);
router.get('/banks', requireAuth, getBanks);
router.get('/resolve-account', requireAuth, resolveAccount);
router.post('/withdraw', requireAuth, withdrawLimiter, withdraw);
router.get('/transactions', requireAuth, getTransactions);

export default router;
