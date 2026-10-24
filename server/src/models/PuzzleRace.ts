import mongoose, { Schema, type Document, type Types } from 'mongoose';

export type PuzzleRaceStatus = 'waiting' | 'active' | 'finished' | 'cancelled';
export type PuzzleRaceDifficulty = 'easy' | 'medium' | 'hard' | 'mixed';
export type PuzzleRaceEndReason = 'completed' | 'time_limit' | 'cancelled' | null;

export interface IRacePlayer {
  user: Types.ObjectId;
  joinedAt: Date;
  /** How many of the race's puzzles this player has fully solved. */
  solved: number;
  /** Index into the CURRENT puzzle's `moves` of the move this player must
   *  find next. Resets to 1 (move 0 is the opponent's opening move) on each
   *  new puzzle. */
  moveIdx: number;
  /** After a wrong move the player is locked out of moving until this time. */
  penaltyUntil: Date | null;
  mistakes: number;
  lastSolvedAt: Date | null;
  /** Set when the player solved every puzzle. */
  finishedAt: Date | null;
}

/** A snapshot of the puzzle taken when the race starts, so a race never
 *  depends on the puzzle collection changing underneath it. */
export interface IRacePuzzle {
  puzzleId: string;
  fen: string;
  moves: string[];
  rating: number;
}

export interface IPuzzleRace extends Document {
  _id: Types.ObjectId;
  code: string;
  creator: Types.ObjectId;
  status: PuzzleRaceStatus;
  difficulty: PuzzleRaceDifficulty;
  puzzleCount: number;
  maxPlayers: number;
  /** Stake per player in R tokens. 0 = a free race. */
  wagerTokens: number;
  timeLimitSeconds: number;
  players: IRacePlayer[];
  puzzles: IRacePuzzle[];
  startsAt: Date | null;
  endsAt: Date | null;
  finishedAt: Date | null;
  winner: Types.ObjectId | null;
  endReason: PuzzleRaceEndReason;
  /** True once every stake has been paid out / refunded. Settlement itself is
   *  idempotent (see wallet.service.ts), this just lets the sweep skip it. */
  wagerSettled: boolean;
  potTokens: number;
  rakeTokens: number;
  payoutTokens: number;
  createdAt: Date;
  updatedAt: Date;
}

const racePlayerSchema = new Schema<IRacePlayer>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now },
    solved: { type: Number, default: 0 },
    moveIdx: { type: Number, default: 1 },
    penaltyUntil: { type: Date, default: null },
    mistakes: { type: Number, default: 0 },
    lastSolvedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { _id: false },
);

const racePuzzleSchema = new Schema<IRacePuzzle>(
  {
    puzzleId: { type: String, required: true },
    fen: { type: String, required: true },
    moves: { type: [String], required: true },
    rating: { type: Number, required: true },
  },
  { _id: false },
);

const puzzleRaceSchema = new Schema<IPuzzleRace>(
  {
    code: { type: String, required: true, unique: true },
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['waiting', 'active', 'finished', 'cancelled'],
      default: 'waiting',
    },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'mixed'], required: true },
    puzzleCount: { type: Number, required: true },
    maxPlayers: { type: Number, required: true },
    wagerTokens: { type: Number, default: 0 },
    timeLimitSeconds: { type: Number, required: true },
    players: { type: [racePlayerSchema], default: [] },
    puzzles: { type: [racePuzzleSchema], default: [] },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    winner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    endReason: { type: String, enum: ['completed', 'time_limit', 'cancelled', null], default: null },
    wagerSettled: { type: Boolean, default: false },
    potTokens: { type: Number, default: 0 },
    rakeTokens: { type: Number, default: 0 },
    payoutTokens: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Lobby list + "am I already in a race" lookups.
puzzleRaceSchema.index({ status: 1, createdAt: -1 });
puzzleRaceSchema.index({ 'players.user': 1, status: 1 });

export const PuzzleRace = mongoose.model<IPuzzleRace>('PuzzleRace', puzzleRaceSchema);
