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

export interface ITimeControl {
  // null baseSeconds means untimed / unlimited.
  baseSeconds: number | null;
  incrementSeconds: number;
}

export interface IGame extends Document {
  _id: Types.ObjectId;
  joinCode: string;
  white: Types.ObjectId;
  black: Types.ObjectId | null;
  status: GameStatus;
  result: GameResult;
  endReason: GameEndReason;
  fen: string;
  pgn: string;
  moves: IMove[];
  timeControl: ITimeControl;
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

const timeControlSchema = new Schema<ITimeControl>(
  {
    baseSeconds: { type: Number, default: null },
    incrementSeconds: { type: Number, default: 0 },
  },
  { _id: false },
);

const gameSchema = new Schema<IGame>(
  {
    // Short, shareable, human-typeable identifier — this is what shows up in the
    // URL and what a friend types in to join. The Mongo _id stays internal.
    joinCode: { type: String, required: true, unique: true, index: true },
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
    timeControl: {
      type: timeControlSchema,
      default: () => ({ baseSeconds: 600, incrementSeconds: 0 }),
    },
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
