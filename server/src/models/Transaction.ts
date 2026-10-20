import mongoose, { Schema, type Document, type Types } from 'mongoose';

export type TransactionType =
  | 'purchase'
  | 'withdrawal'
  // Wager ledger entries, these move tokens between a player's balance and a
  // game's escrow, purely internal (no Paystack money movement involved).
  | 'wager_stake'
  | 'wager_payout'
  | 'wager_refund'
  // Tournament ledger entries, same idea as the wager_* entries above, just
  // scoped to a Tournament document instead of a Game, and split across two
  // independent flows (see the ITournament doc comment in Tournament.ts):
  //  - 'tournament_reg_fee': a player paying to join (held in escrow).
  //  - 'tournament_prize_fund': the CREATOR funding the prize schedule.
  //  - 'tournament_payout': prize money reaching a placed player.
  //  - 'tournament_reg_revenue': the whole reg-fee pool reaching the creator.
  //  - 'tournament_refund': anything given back unused (reg fee on
  //    leave/cancel, prize fund on cancel, unused prize tiers, etc).
  | 'tournament_reg_fee'
  | 'tournament_prize_fund'
  | 'tournament_payout'
  | 'tournament_reg_revenue'
  | 'tournament_refund'
  // Puzzle race ledger entries, scoped to a PuzzleRace document: each player's
  // stake, the winner's payout (pot minus rake), and refunds (a player leaving
  // before the start, a cancelled race, or a race nobody scored in).
  | 'puzzle_race_stake'
  | 'puzzle_race_payout'
  | 'puzzle_race_refund'
  // Free coins paid for completing a day of the daily challenges.
  | 'daily_reward'
  // Season leaderboard prize (see seasonLeaderboard.service.ts).
  | 'season_reward';
export type TransactionStatus = 'pending' | 'success' | 'failed';

export interface ITransaction extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: TransactionType;
  status: TransactionStatus;
  tokens: number;
  amountKobo: number; // NGN, lowest denomination, matches how Paystack itself works. 0 for wager entries.
  reference: string; // Paystack transaction reference (purchases), our own generated ref (withdrawals), or gameId-derived (wagers)
  planId?: string; // which purchase plan, if type === 'purchase'
  game?: Types.ObjectId; // which game, if type is one of the wager_* entries
  tournament?: Types.ObjectId; // which tournament, if type is one of the tournament_* entries
  puzzleRace?: Types.ObjectId; // which puzzle race, if type is one of the puzzle_race_* entries
  paystackRecipientCode?: string; // withdrawals. Paystack transfer recipient
  paystackTransferCode?: string; // withdrawals. Paystack transfer
  bankAccountNumber?: string;
  bankCode?: string;
  accountName?: string;
  bankName?: string; // withdrawals, display only (so the admin sees "GTBank", not just a code)
  failureReason?: string;
  adminNote?: string; // manual withdrawals, optional note the admin left when marking it paid
  resolvedAt?: Date; // manual withdrawals, when an admin marked it paid/declined
  resolvedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: [
        'purchase',
        'withdrawal',
        'wager_stake',
        'wager_payout',
        'wager_refund',
        'tournament_reg_fee',
        'tournament_prize_fund',
        'tournament_payout',
        'tournament_reg_revenue',
        'tournament_refund',
        'puzzle_race_stake',
        'puzzle_race_payout',
        'puzzle_race_refund',
        'daily_reward',
        'season_reward',
      ],
      required: true,
    },
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
    tokens: { type: Number, required: true },
    amountKobo: { type: Number, required: true, default: 0 },
    reference: { type: String, required: true, unique: true, index: true },
    planId: { type: String },
    game: { type: Schema.Types.ObjectId, ref: 'Game' },
    tournament: { type: Schema.Types.ObjectId, ref: 'Tournament' },
    puzzleRace: { type: Schema.Types.ObjectId, ref: 'PuzzleRace' },
    paystackRecipientCode: { type: String },
    paystackTransferCode: { type: String },
    bankAccountNumber: { type: String },
    bankCode: { type: String },
    accountName: { type: String },
    bankName: { type: String },
    failureReason: { type: String },
    adminNote: { type: String },
    resolvedAt: { type: Date },
    resolvedBy: { type: String },
  },
  { timestamps: true },
);

transactionSchema.index({ user: 1, createdAt: -1 });
// Looked up on every Paystack transfer webhook (handleTransferOutcome) and
// previously unindexed, i.e. a full collection scan per webhook. Sparse
// because only withdrawals have one.
transactionSchema.index({ paystackTransferCode: 1 }, { sparse: true });
// Admin withdrawal queue / deposit tracker both filter by type+status and
// sort newest-first.
transactionSchema.index({ type: 1, status: 1, createdAt: -1 });

export const Transaction = mongoose.model<ITransaction>('Transaction', transactionSchema);
