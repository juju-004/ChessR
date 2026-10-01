import mongoose, { Schema, type Document, type Types } from 'mongoose';
import type { SuspicionSignal } from '../services/anticheat.service.js';

export type GameFlagStatus = 'pending_review' | 'cleared' | 'actioned';

export interface IGameFlag extends Document {
  _id: Types.ObjectId;
  game: Types.ObjectId;
  /** Denormalized so the admin list can render without an extra populate
   *  for the common case, mirrors Report.gameCode. */
  gameCode: string;
  flaggedUser: Types.ObjectId;
  side: 'white' | 'black';
  score: number;
  signals: SuspicionSignal[];
  status: GameFlagStatus;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const signalSchema = new Schema<SuspicionSignal>(
  {
    type: { type: String, required: true },
    detail: { type: String, required: true },
  },
  { _id: false },
);

const gameFlagSchema = new Schema<IGameFlag>(
  {
    game: { type: Schema.Types.ObjectId, ref: 'Game', required: true },
    gameCode: { type: String, required: true, uppercase: true },
    flaggedUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    side: { type: String, enum: ['white', 'black'], required: true },
    score: { type: Number, required: true },
    signals: { type: [signalSchema], default: [] },
    status: {
      type: String,
      enum: ['pending_review', 'cleared', 'actioned'],
      default: 'pending_review',
    },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    reviewNotes: { type: String, maxlength: 2000, trim: true },
  },
  { timestamps: true },
);

// One flag per (game, flaggedUser): the auto-check in finalizeGame is
// fire-and-forget and could in principle run more than once for the same
// game (e.g. a retried job), this stops that from ever producing
// duplicate queue entries for the same suspicion.
gameFlagSchema.index({ game: 1, flaggedUser: 1 }, { unique: true });
gameFlagSchema.index({ status: 1, createdAt: -1 });
gameFlagSchema.index({ flaggedUser: 1, status: 1 });

export const GameFlag = mongoose.model<IGameFlag>('GameFlag', gameFlagSchema);
