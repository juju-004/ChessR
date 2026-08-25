import { z } from 'zod';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { env } from '../config/env.js';
import {
  PURCHASE_NAIRA_PER_TOKEN,
  MIN_PURCHASE_TOKENS,
  WITHDRAWAL_NAIRA_PER_TOKEN,
  MIN_WITHDRAWAL_TOKENS,
  createPendingPurchase,
  completePurchase,
  initiateWithdrawal,
  resolveWithdrawalFromWebhook,
  listTransactions,
} from '../services/wallet.service.js';
import { listBanks, resolveAccountNumber, verifyWebhookSignature } from '../services/paystack.service.js';

// 7-digit sanity ceiling, same convention/value as MAX_PURCHASE_TOKENS in
// wallet.service.ts (kept as a separate local constant here rather than
// exported, matching how MAX_WAGER_TOKENS is duplicated per-file elsewhere
// in this codebase), only used here to report the ceiling to the client,
// the actual enforcement lives in wallet.service.ts.
const MAX_PURCHASE_TOKENS = 9_999_999;

export const getPlans = asyncHandler(async (_req, res) => {
  res.json({
    purchase: {
      nairaPerToken: PURCHASE_NAIRA_PER_TOKEN,
      minTokens: MIN_PURCHASE_TOKENS,
      maxTokens: MAX_PURCHASE_TOKENS,
    },
    withdrawal: { nairaPerToken: WITHDRAWAL_NAIRA_PER_TOKEN, minTokens: MIN_WITHDRAWAL_TOKENS },
    paystackPublicKey: env.PAYSTACK_PUBLIC_KEY,
  });
});

export const getBalance = asyncHandler(async (req: AuthedRequest, res) => {
  const user = await User.findById(req.user!.id).select('tokenBalance').lean();
  if (!user) throw ApiError.notFound('User not found');
  res.json({ tokenBalance: user.tokenBalance });
});

// tokens replaces the old planId, see wallet.service.ts's
// createPendingPurchase for why this was "Validation failed"-ing before:
// this schema still required `planId` from a fixed-tier system the client
// (BuyTokens.tsx) had already moved off of, so every request, which only
// ever sent `{ tokens }`, failed to parse before it got anywhere near
// Paystack.
const initPurchaseSchema = z.object({ tokens: z.number().int().positive() });

export const initPurchase = asyncHandler(async (req: AuthedRequest, res) => {
  const { tokens } = initPurchaseSchema.parse(req.body);
  const result = await createPendingPurchase(req.user!.id, tokens);
  res.status(201).json({ ...result, paystackPublicKey: env.PAYSTACK_PUBLIC_KEY });
});

const verifySchema = z.object({ reference: z.string() });

// Fast-path verification triggered right after the Paystack popup closes, 
// gives the user instant feedback instead of waiting on the webhook, which
// can lag by a few seconds. The webhook (below) is still what's authoritative
// if this never fires (e.g. the tab closed mid-payment).
export const verifyPurchase = asyncHandler(async (req: AuthedRequest, res) => {
  const { reference } = verifySchema.parse(req.body);
  const transaction = await completePurchase(reference);
  if (!transaction) throw ApiError.notFound('Transaction not found');
  if (transaction.user.toString() !== req.user!.id) throw ApiError.forbidden();

  const user = await User.findById(req.user!.id).select('tokenBalance').lean();
  res.json({ status: transaction.status, tokenBalance: user?.tokenBalance ?? 0 });
});

export const getBanks = asyncHandler(async (_req, res) => {
  const banks = await listBanks();
  res.json({ banks });
});

const resolveAccountSchema = z.object({
  accountNumber: z.string().length(10),
  bankCode: z.string().min(1),
});

export const resolveAccount = asyncHandler(async (req, res) => {
  const { accountNumber, bankCode } = resolveAccountSchema.parse(req.query);
  const result = await resolveAccountNumber(accountNumber, bankCode);
  res.json(result);
});

const withdrawSchema = z.object({
  tokens: z.number().int().positive(),
  accountNumber: z.string().length(10),
  bankCode: z.string().min(1),
  accountName: z.string().min(1),
});

export const withdraw = asyncHandler(async (req: AuthedRequest, res) => {
  const params = withdrawSchema.parse(req.body);
  const transaction = await initiateWithdrawal(req.user!.id, params);
  res.status(201).json({
    status: transaction.status,
    reference: transaction.reference,
    tokens: transaction.tokens,
    amountNaira: transaction.amountKobo / 100,
  });
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const getTransactions = asyncHandler(async (req: AuthedRequest, res) => {
  const { page, limit } = listQuerySchema.parse(req.query);
  const result = await listTransactions(req.user!.id, page, limit);
  res.json(result);
});

/**
 * Paystack webhook, the actual source of truth for both purchases and
 * withdrawals. Requires the RAW request body for signature verification
 * (see app.ts: this route is registered before the global JSON parser).
 */
export const handleWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-paystack-signature'] as string | undefined;
  const rawBody = (req as any).rawBody as Buffer | undefined;

  if (!rawBody || !verifyWebhookSignature(rawBody, signature)) {
    // Deliberately vague + 400, not 401/403, don't help an attacker
    // distinguish "bad signature" from "missing body" from anything else.
    throw ApiError.badRequest('Invalid webhook signature');
  }

  const event = JSON.parse(rawBody.toString('utf8'));

  switch (event.event) {
    case 'charge.success':
      await completePurchase(event.data.reference);
      break;
    case 'transfer.success':
      await resolveWithdrawalFromWebhook(event.data.transfer_code, 'success');
      break;
    case 'transfer.failed':
      await resolveWithdrawalFromWebhook(event.data.transfer_code, 'failed');
      break;
    case 'transfer.reversed':
      await resolveWithdrawalFromWebhook(event.data.transfer_code, 'reversed');
      break;
    default:
      break; // ignore anything else Paystack sends
  }

  // Paystack expects a fast 200 acknowledging receipt, it retries on
  // non-2xx, which would otherwise double-process events we already handled
  // (harmless here since everything above is idempotent, but no reason to
  // invite the extra load).
  res.sendStatus(200);
});
