import { nanoid } from 'nanoid';
import { User } from '../models/User.js';
import { Transaction, type ITransaction } from '../models/Transaction.js';
import { PlatformRevenue } from '../models/PlatformRevenue.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
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

  // A pending report against this account blocks withdrawals the instant
  // it's filed — before anyone's actually looked into it — so funds can't
  // be pulled out ahead of a review. Cleared only by an admin, from the
  // report review screen, once they've looked into it. See User.withdrawalBlocked.
  const reportedUser = await User.findById(userId).select('withdrawalBlocked').lean();
  if (reportedUser?.withdrawalBlocked) {
    throw ApiError.forbidden(
      'Withdrawals are on hold for this account pending a review. Contact support if you believe this is a mistake.',
    );
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

// --- Platform rake ---------------------------------------------------------------
// A cut of every wagered pot (normal games, cage matches) and every
// tournament registration-fee pool goes to the platform instead of whoever
// would otherwise receive the whole thing — the winner for a wager, the
// organizer for a reg-fee pool. Rate is operator-configurable via
// RAKE_PERCENT in the server .env (see config/env.ts), so it can be tuned
// without a code change/redeploy involving this file.

export interface RakeSplit {
  rakeTokens: number;
  netTokens: number; // grossTokens - rakeTokens — what actually reaches the recipient
}

/** Splits a gross pot/pool into the platform's cut and the remainder. Floors
 *  the rake (never rounds up) so the platform's cut can't ever exceed the
 *  configured percentage, even on an odd total — any lost fraction of a
 *  token from the floor just stays with whoever the remainder goes to. */
export function computeRake(grossTokens: number): RakeSplit {
  if (grossTokens <= 0) return { rakeTokens: 0, netTokens: 0 };
  const rakeTokens = Math.floor((grossTokens * env.RAKE_PERCENT) / 100);
  return { rakeTokens, netTokens: grossTokens - rakeTokens };
}

/** Records the platform's cut of a settled pot/pool. Never touches a user's
 *  balance — there's no "platform user" account, just this ledger — and is
 *  a no-op for a zero-percent/zero-token cut so a disabled rake doesn't
 *  clutter the admin page with $0 rows. Not wrapped in the same
 *  wagerSettled-style atomic guard as the payout it accompanies, since it's
 *  always called immediately after that guard already succeeded — see
 *  settleWager, settleWinnerTakesAll, and distributePrize, the only three
 *  callers. */
export async function recordRake(
  source: 'game' | 'cage_match' | 'tournament',
  sourceId: string,
  rakeTokens: number,
  grossPotTokens: number,
): Promise<void> {
  if (rakeTokens <= 0) return;
  await PlatformRevenue.create({
    source,
    sourceId,
    tokens: rakeTokens,
    grossPotTokens,
    ratePercent: env.RAKE_PERCENT,
  });
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

// --- Tournament escrow ----------------------------------------------------
// Same atomic-conditional-update pattern as the wager helpers above, just
// scoped to a Tournament document (and its own transaction types/reference
// prefixes) instead of a single Game. Two independent flows — see the
// ITournament doc comment in Tournament.ts for why they're kept separate:
// a registration fee (player-funded, ends up with the creator) and a prize
// fund (creator-funded, ends up with the top finishers).

/** Debits a player's registration fee when they join a tournament (creator
 *  included, if the tournament they're creating charges one). Throws if
 *  their balance can't cover it. */
export async function debitTournamentRegFee(userId: string, tournamentId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;

  const debited = await User.findOneAndUpdate(
    { _id: userId, tokenBalance: { $gte: tokens } },
    { $inc: { tokenBalance: -tokens } },
    { new: true },
  );
  if (!debited) throw ApiError.badRequest('Insufficient R token balance for that registration fee');

  await Transaction.create({
    user: userId,
    type: 'tournament_reg_fee',
    status: 'success',
    tokens,
    amountKobo: 0,
    reference: `TRN-REG-${tournamentId}-${userId}`,
    tournament: tournamentId,
  });
}

/** Debits the CREATOR's balance for the full prize schedule they set at
 *  creation time — the whole committed total, up front, so payout at the end
 *  is never blocked on the creator still having the funds. Throws if their
 *  balance can't cover it (the tournament creation itself should be rolled
 *  back by the caller if this throws). */
export async function debitTournamentPrizeFund(userId: string, tournamentId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;

  const debited = await User.findOneAndUpdate(
    { _id: userId, tokenBalance: { $gte: tokens } },
    { $inc: { tokenBalance: -tokens } },
    { new: true },
  );
  if (!debited) throw ApiError.badRequest('Insufficient R token balance to fund that prize pool');

  await Transaction.create({
    user: userId,
    type: 'tournament_prize_fund',
    status: 'success',
    tokens,
    amountKobo: 0,
    reference: `TRN-PRZ-${tournamentId}-${userId}`,
    tournament: tournamentId,
  });
}

/** Refunds (leave before start / cancelled / deleted event, or an unused
 *  prize tier with no player to claim it) or pays out (prize distribution, or
 *  the reg-fee pool reaching the creator) tokens tied to a tournament.
 *  Reference is deterministic per tournament+user+kind+suffix so a retry
 *  can't double-credit; `suffix` lets, e.g., a rank-3 prize payout be
 *  distinguished from a rank-1 one for the same person if that ever happens
 *  (a bye-heavy small field, say) — it shouldn't overlap, but cheap
 *  insurance. */
export async function creditTournamentReturn(
  userId: string,
  tournamentId: string,
  tokens: number,
  kind: 'tournament_refund' | 'tournament_payout' | 'tournament_reg_revenue',
  suffix = '',
): Promise<void> {
  if (tokens <= 0) return;

  await User.updateOne({ _id: userId }, { $inc: { tokenBalance: tokens } });

  const prefix = kind === 'tournament_payout' ? 'WIN' : kind === 'tournament_reg_revenue' ? 'REV' : 'RFD';
  await Transaction.create({
    user: userId,
    type: kind,
    status: 'success',
    tokens,
    amountKobo: 0,
    reference: `TRN-${prefix}-${tournamentId}-${userId}${suffix ? `-${suffix}` : ''}`,
    tournament: tournamentId,
  });
}

/** Settles the balance change from editing a pending tournament's prize
 *  pool or registration fee (only possible while the creator is still the
 *  sole player — see updateTournament in tournament.service.ts) — a single
 *  call handles both directions: deltaTokens > 0 debits the creator for the
 *  increase, < 0 refunds them the decrease, 0 is a no-op. Uses a
 *  timestamped reference rather than the deterministic ones the debit/credit
 *  helpers above use, since an editable amount can change more than once
 *  and each change needs its own distinct ledger entry — a fixed reference
 *  would collide with itself (or with the eventual real debit/refund) the
 *  second time the same tournament+user+kind combination came up. */
export async function adjustTournamentEscrow(
  userId: string,
  tournamentId: string,
  deltaTokens: number,
  kind: 'tournament_prize_fund' | 'tournament_reg_fee',
): Promise<void> {
  if (deltaTokens === 0) return;

  const label = kind === 'tournament_prize_fund' ? 'PRZ' : 'REG';
  const reference = `TRN-EDIT-${label}-${tournamentId}-${userId}-${Date.now()}`;

  if (deltaTokens > 0) {
    const debited = await User.findOneAndUpdate(
      { _id: userId, tokenBalance: { $gte: deltaTokens } },
      { $inc: { tokenBalance: -deltaTokens } },
      { new: true },
    );
    if (!debited) throw ApiError.badRequest('Insufficient R token balance for that change');
    await Transaction.create({
      user: userId,
      type: kind,
      status: 'success',
      tokens: deltaTokens,
      amountKobo: 0,
      reference,
      tournament: tournamentId,
    });
  } else {
    await User.updateOne({ _id: userId }, { $inc: { tokenBalance: -deltaTokens } });
    await Transaction.create({
      user: userId,
      type: 'tournament_refund',
      status: 'success',
      tokens: -deltaTokens,
      amountKobo: 0,
      reference,
      tournament: tournamentId,
    });
  }
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
