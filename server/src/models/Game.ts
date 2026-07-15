import mongoose, { Schema, type Document, type Types } from 'mongoose';

export type GameStatus = 'waiting' | 'active' | 'finished' | 'aborted';
export type GameResult = 'white' | 'black' | 'draw' | null;
export type GameEndReason =
  | 'checkmate'
  | 'resignation'
  | 'timeout'
  | 'stalemate'
  | 'draw_agreement'
  | 'insufficient_material'
  | 'threefold_repetition'
  | 'fifty_move_rule'
  | 'abandoned'
  | null;

export interface IMove {
  san: string;
  from: string;
  to: string;
  promotion?: string;
  fenAfter: string;
  moveNumber: number;
  timestampMs: number;
}

export interface IGame extends Document {
  _id: Types.ObjectId;
  white: Types.ObjectId;
  black: Types.ObjectId | null;
  status: GameStatus;
  result: GameResult;
  endReason: GameEndReason;
  fen: string;
  pgn: string;
  moves: IMove[];
  // Optional: link back to a friend challenge, for auditability.
  challengeId?: string;
  isPrivate: boolean;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}

const moveSchema = new Schema<IMove>(
  {
    san: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    promotion: { type: String },
    fenAfter: { type: String, required: true },
    moveNumber: { type: Number, required: true },
    timestampMs: { type: Number, required: true },
  },
  { _id: false },
);

const gameSchema = new Schema<IGame>(
  {
    white: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    black: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    status: {
      type: String,
      enum: ['waiting', 'active', 'finished', 'aborted'],
      default: 'waiting',
      index: true,
    },
    result: { type: String, enum: ['white', 'black', 'draw', null], default: null },
    endReason: { type: String, default: null },
    fen: {
      type: String,
      default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    },
    pgn: { type: String, default: '' },
    moves: { type: [moveSchema], default: [] },
    challengeId: { type: String },
    isPrivate: { type: Boolean, default: false },
    startedAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Fast lookup of a user's open game to join, and open-game listing.
gameSchema.index({ status: 1, createdAt: -1 });

export const Game = mongoose.model<IGame>('Game', gameSchema);
