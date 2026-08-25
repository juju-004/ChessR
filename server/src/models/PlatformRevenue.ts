import mongoose, { Schema, type Document, type Types } from 'mongoose';

// Every time a wagered game, cage match, or tournament registration-fee pool
// settles, the platform's cut (see wallet.service.ts's computeRake) is
// recorded here rather than credited to any User, there's no "platform
// user" account, just this ledger. The admin page's running "admin wallet"
// balance is the sum of every row's `tokens` field (see admin.controller.ts's
// getRevenueSummary), the same way a bank statement's balance is a running
// sum of its line items rather than a separately maintained counter that
// could drift out of sync with it.
export type PlatformRevenueSource = 'game' | 'cage_match' | 'tournament';

export interface IPlatformRevenue extends Document {
  _id: Types.ObjectId;
  source: PlatformRevenueSource;
  // The Game / CageMatch / Tournament this cut came from. Not a strict ref
  // to a single model (source tells you which one), so left un-typed on
  // purpose rather than picking one collection to point at.
  sourceId: Types.ObjectId;
  tokens: number; // the rake actually taken
  grossPotTokens: number; // the full pot/pool it was taken from, for auditability
  ratePercent: number; // RAKE_PERCENT at the moment this was cut, env can change later, this can't
  createdAt: Date;
  updatedAt: Date;
}

const platformRevenueSchema = new Schema<IPlatformRevenue>(
  {
    source: { type: String, enum: ['game', 'cage_match', 'tournament'], required: true, index: true },
    sourceId: { type: Schema.Types.ObjectId, required: true, index: true },
    tokens: { type: Number, required: true, min: 0 },
    grossPotTokens: { type: Number, required: true, min: 0 },
    ratePercent: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

platformRevenueSchema.index({ createdAt: -1 });

export const PlatformRevenue = mongoose.model<IPlatformRevenue>('PlatformRevenue', platformRevenueSchema);
