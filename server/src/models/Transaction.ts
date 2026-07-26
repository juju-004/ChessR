import mongoose, { Schema, type Document, type Types } from 'mongoose';

export type TransactionType =
  | 'purchase'
  | 'withdrawal'
  // Wager ledger entries — these move tokens between a player's balance and a
  // game's escrow, purely internal (no Paystack money movement involved).
  | 'wager_stake'
  | 'wager_payout'
  | 'wager_refund'
  // Tournament entry-fee ledger entries — same idea as the wager_* entries
  // above, just scoped to a Tournament document instead of a Game.
  | 'tournament_entry'
  | 'tournament_payout'
  | 'tournament_refund';
export type TransactionStatus = 'pending' | 'success' | 'failed';

export interface ITransaction extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: TransactionType;
  status: TransactionStatus;
  tokens: number;
  amountKobo: number; // NGN, lowest denomination — matches how Paystack itself works. 0 for wager entries.
  reference: string; // Paystack transaction reference (purchases), our own generated ref (withdrawals), or gameId-derived (wagers)
  planId?: string; // which purchase plan, if type === 'purchase'
  game?: Types.ObjectId; // which game, if type is one of the wager_* entries
  tournament?: Types.ObjectId; // which tournament, if type is one of the tournament_* entries
  paystackRecipientCode?: string; // withdrawals — Paystack transfer recipient
  paystackTransferCode?: string; // withdrawals — Paystack transfer
  bankAccountNumber?: string;
  bankCode?: string;
  accountName?: string;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: [
        'purchase',
        'withdrawal',
        'wager_stake',
        'wager_payout',
        'wager_refund',
        'tournament_entry',
        'tournament_payout',
        'tournament_refund',
      ],
      required: true,
    },
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending', index: true },
    tokens: { type: Number, required: true },
    amountKobo: { type: Number, required: true, default: 0 },
    reference: { type: String, required: true, unique: true, index: true },
    planId: { type: String },
    game: { type: Schema.Types.ObjectId, ref: 'Game', index: true },
    tournament: { type: Schema.Types.ObjectId, ref: 'Tournament', index: true },
    paystackRecipientCode: { type: String },
    paystackTransferCode: { type: String },
    bankAccountNumber: { type: String },
    bankCode: { type: String },
    accountName: { type: String },
    failureReason: { type: String },
  },
  { timestamps: true },
);

transactionSchema.index({ user: 1, createdAt: -1 });

export const Transaction = mongoose.model<ITransaction>('Transaction', transactionSchema);
