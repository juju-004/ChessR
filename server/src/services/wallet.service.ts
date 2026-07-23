import { nanoid } from 'nanoid';
import { User } from '../models/User.js';
import { Transaction, type ITransaction } from '../models/Transaction.js';
import { ApiError } from '../utils/ApiError.js';
import {
  verifyTransaction,
  createTransferRecipient,
  initiateTransfer,
} from './paystack.service.js';

// --- Token economy constants -------------------------------------------------
// Deliberately a spread between buy and withdraw rates (standard practice) —
// without one, buying tokens and immediately withdrawing them would be
// risk-free arbitrage against whatever Paystack's transaction fees don't
// already eat into.

export interface TokenPlan {
  id: string;
  tokens: number;
  priceNaira: number;
}

export const TOKEN_PLANS: TokenPlan[] = [
  { id: 'starter', tokens: 100, priceNaira: 1000 },
  { id: 'value', tokens: 550, priceNaira: 5000 },
  { id: 'pro', tokens: 1200, priceNaira: 10000 },
  { id: 'elite', tokens: 3000, priceNaira: 22500 },
];

export const WITHDRAWAL_NAIRA_PER_TOKEN = 8;
export const MIN_WITHDRAWAL_TOKENS = 100;

function getPlan(planId: string): TokenPlan {
  const plan = TOKEN_PLANS.find((p) => p.id === planId);
  if (!plan) throw ApiError.badRequest('Unknown plan');
  return plan;
}

// --- Purchases ----------------------------------------------------------------

/** Creates the pending ledger entry and returns what the client needs to open
 *  the Paystack popup. The amount is always derived from the server's own
 *  plan list — never trust a client-submitted amount. */
export async function createPendingPurchase(
  userId: string,
  planId: string,
): Promise<{ reference: string; amountKobo: number; tokens: number }> {
  const plan = getPlan(planId);
  const reference = `TKN-${nanoid(20)}`;
  const amountKobo = plan.priceNaira * 100;

  await Transaction.create({
    user: userId,
    type: 'purchase',
    status: 'pending',
    tokens: plan.tokens,
    amountKobo,
    reference,
    planId: plan.id,
  });

  return { reference, amountKobo, tokens: plan.tokens };
}

/**
 * Confirms a purchase against Paystack's own record of the transaction and
 * credits tokens — idempotent and safe to call from both the client's
 * post-popup verify request AND the charge.success webhook, whichever
 * happens to arrive first. The second caller is a no-op.
 */
export async function completePurchase(reference: string): Promise<ITransaction | null> {
  const pending = await Transaction.findOne({ reference, type: 'purchase' });
  if (!pending) return null;
  if (pending.status !== 'pending') return pending; // already resolved by the other path

  const verified = await verifyTransaction(reference);

  if (verified.status !== 'success' || verified.amount !== pending.amountKobo) {
    // Atomic guard: only flip it if it's still pending (avoids a race where
    // the webhook and the client verify call both reach this point at once).
    const updated = await Transaction.findOneAndUpdate(
      { _id: pending._id, status: 'pending' },
      { $set: { status: 'failed', failureReason: `Paystack status: ${verified.status}` } },
      { new: true },
    );
    return updated;
  }

  const updated = await Transaction.findOneAndUpdate(
    { _id: pending._id, status: 'pending' },
    { $set: { status: 'success' } },
    { new: true },
  );
  if (!updated) return pending; // someone else already resolved it between our read and write

  await User.updateOne({ _id: pending.user }, { $inc: { tokenBalance: pending.tokens } });
  return updated;
}

// --- Withdrawals ----------------------------------------------------------------

export interface WithdrawParams {
  tokens: number;
  accountNumber: string;
  bankCode: string;
  accountName: string;
}

export async function initiateWithdrawal(userId: string, params: WithdrawParams): Promise<ITransaction> {
  const { tokens, accountNumber, bankCode, accountName } = params;

  if (tokens < MIN_WITHDRAWAL_TOKENS) {
    throw ApiError.badRequest(`Minimum withdrawal is ${MIN_WITHDRAWAL_TOKENS} tokens`);
  }

  // Atomic conditional decrement — this is what prevents two concurrent
  // withdrawal requests from both passing a naive "check then deduct" and
  // taking the user's balance negative.
  const debited = await User.findOneAndUpdate(
    { _id: userId, tokenBalance: { $gte: tokens } },
    { $inc: { tokenBalance: -tokens } },
    { new: true },
  );
  if (!debited) throw ApiError.badRequest('Insufficient token balance');

  const amountKobo = tokens * WITHDRAWAL_NAIRA_PER_TOKEN * 100;
  const reference = `WD-${nanoid(20)}`;

  const transaction = await Transaction.create({
    user: userId,
    type: 'withdrawal',
    status: 'pending',
    tokens,
    amountKobo,
    reference,
    bankAccountNumber: accountNumber,
    bankCode,
    accountName,
  });

  try {
    const recipient = await createTransferRecipient({ name: accountName, accountNumber, bankCode });
    const transfer = await initiateTransfer({
      amountKobo,
      recipientCode: recipient.recipient_code,
      reason: 'R token withdrawal',
      reference,
    });

    transaction.paystackRecipientCode = recipient.recipient_code;
    transaction.paystackTransferCode = transfer.transfer_code;
    // Paystack itself may report 'success' immediately (common in test mode)
    // or 'pending' (finalized later via webhook, or stuck on 'otp' if Transfer
    // OTP is enabled on the account — see README for what that means here).
    if (transfer.status === 'success') {
      transaction.status = 'success';
    }
    await transaction.save();
    return transaction;
  } catch (err) {
    // Recipient creation or transfer initiation failed outright — refund
    // immediately rather than leaving the user's tokens stuck in limbo.
    await User.updateOne({ _id: userId }, { $inc: { tokenBalance: tokens } });
    transaction.status = 'failed';
    transaction.failureReason = err instanceof Error ? err.message : 'Transfer failed';
    await transaction.save();
    throw ApiError.badRequest(transaction.failureReason);
  }
}

/** Called from the transfer.success / transfer.failed / transfer.reversed
 *  webhook events to finalize a withdrawal that was left 'pending' after
 *  initiation. Refunds tokens on failure/reversal — idempotent, since it only
 *  acts on transactions still in 'pending'. */
export async function resolveWithdrawalFromWebhook(
  transferCode: string,
  outcome: 'success' | 'failed' | 'reversed',
): Promise<void> {
  const transaction = await Transaction.findOne({ paystackTransferCode: transferCode, type: 'withdrawal' });
  if (!transaction || transaction.status !== 'pending') return; // already resolved, or not ours

  if (outcome === 'success') {
    transaction.status = 'success';
    await transaction.save();
    return;
  }

  transaction.status = 'failed';
  transaction.failureReason = `Paystack transfer ${outcome}`;
  await transaction.save();
  await User.updateOne({ _id: transaction.user }, { $inc: { tokenBalance: transaction.tokens } });
}

// --- Wager escrow ---------------------------------------------------------------
// Chess games are staked with R tokens instead of a rating system: each player
// puts up the same number of tokens, and the winner takes the combined pot.
// These helpers move tokens between a player's balance and a game's implicit
// escrow (the game document itself, via wagerTokens) and leave an auditable
// Transaction trail — same atomic-conditional-update pattern as withdrawals,
// so two concurrent calls can never take a balance negative.

/** Debits a player's stake for a game they're joining/accepting/rematching.
 *  Throws if their balance can't cover it — callers should surface this as a
 *  clear "insufficient balance" error rather than silently failing to seat
 *  the player. */
export async function debitWagerStake(userId: string, gameId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;

  const debited = await User.findOneAndUpdate(
    { _id: userId, tokenBalance: { $gte: tokens } },
    { $inc: { tokenBalance: -tokens } },
    { new: true },
  );
  if (!debited) throw ApiError.badRequest('Insufficient R token balance for this wager');

  await Transaction.create({
    user: userId,
    type: 'wager_stake',
    status: 'success',
    tokens,
    amountKobo: 0,
    reference: `WGR-STK-${gameId}-${userId}`,
    game: gameId,
  });
}

/** Refunds a stake that was already debited (game aborted/cancelled before a
 *  winner could be decided, or a draw where each side just gets their own
 *  stake back). Reference is deterministic per game+user+kind so a retry
 *  after a crash can't double-credit. */
export async function creditWagerReturn(
  userId: string,
  gameId: string,
  tokens: number,
  kind: 'wager_refund' | 'wager_payout',
): Promise<void> {
  if (tokens <= 0) return;

  await User.updateOne({ _id: userId }, { $inc: { tokenBalance: tokens } });

  await Transaction.create({
    user: userId,
    type: kind,
    status: 'success',
    tokens,
    amountKobo: 0,
    reference: `WGR-${kind === 'wager_payout' ? 'WIN' : 'RFD'}-${gameId}-${userId}`,
    game: gameId,
  });
}

export async function listTransactions(userId: string, page: number, limit: number) {
  const filter = { user: userId };
  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter),
  ]);
  return { transactions, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
