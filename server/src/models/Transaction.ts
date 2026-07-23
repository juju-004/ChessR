import mongoose, { Schema, type Document, type Types } from 'mongoose';

export type TransactionType = 'purchase' | 'withdrawal';
export type TransactionStatus = 'pending' | 'success' | 'failed';

export interface ITransaction extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: TransactionType;
  status: TransactionStatus;
  tokens: number;
  amountKobo: number; // NGN, lowest denomination — matches how Paystack itself works
  reference: string; // Paystack transaction reference (purchases) or our own generated ref (withdrawals)
  planId?: string; // which purchase plan, if type === 'purchase'
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
    type: { type: String, enum: ['purchase', 'withdrawal'], required: true },
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending', index: true },
    tokens: { type: Number, required: true },
    amountKobo: { type: Number, required: true },
    reference: { type: String, required: true, unique: true, index: true },
    planId: { type: String },
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
