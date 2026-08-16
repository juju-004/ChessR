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
  | 'cancelled'
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
  variant: 'standard' | 'chess960';
  initialFen: string;
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
  // Per-player R token stake. Total pot awarded to the winner is wagerTokens * 2.
  // 0 means a free (unwagered) game.
  wagerTokens: number;
  // Flips to true exactly once, the moment the wager for this game has been
  // paid out or refunded — guards against double-crediting tokens if the
  // settlement path is ever triggered twice for the same game (e.g. a
  // reconciliation sweep racing the live socket flow after a restart).
  wagerSettled: boolean;
  /** Flips to true exactly once, the moment this game's result has been
   *  folded into both players' hidden rating (see rating.service.ts's
   *  applyRatingForGame) — same double-application guard pattern as
   *  wagerSettled, for the same reason (more than one code path can reach
   *  a decisive finish for the same game: the live game-over flow,
   *  tournament withdrawal, and boot-time reconciliation). */
  ratingApplied: boolean;
  // Set when this game is one leg of a cage match — links back to the parent
  // CageMatch document and records this leg's position in its ordered list.
  // Left undefined for standalone games (the overwhelming majority).
  cageMatchId?: Types.ObjectId;
  legIndex?: number;
  // Set when this game is one pairing of a tournament round — links back to
  // the parent Tournament document. Left undefined for standalone games and
  // cage match legs.
  tournamentId?: Types.ObjectId;
  roundIndex?: number;
  pairingIndex?: number;
  // Whether each side chose to berserk (halve their own clock, forfeit their
  // own increment) before making their first move. Only ever settable when
  // tournamentId is set and the tournament allows it.
  berserk?: { white: boolean; black: boolean };
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  // Each side's clock, frozen at the moment the game ended — never
  // touched again after that (see finalizeGame). null for an untimed
  // game (no time control) or a game that ended before either clock
  // started running. Everything else about a game's live state lives in
  // Redis and evaporates once the game is over; this is the one exception,
  // persisted specifically so a finished game's replay can still show a
  // real final clock reading instead of "∞".
  whiteRemainingMs?: number | null;
  blackRemainingMs?: number | null;
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
    variant: { type: String, enum: ['standard', 'chess960'], default: 'standard' },
    initialFen: {
      type: String,
      required: true,
      default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    },
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
    wagerTokens: { type: Number, default: 0, min: 0 },
    wagerSettled: { type: Boolean, default: false },
    ratingApplied: { type: Boolean, default: false },
    cageMatchId: { type: Schema.Types.ObjectId, ref: 'CageMatch', index: true },
    legIndex: { type: Number },
    tournamentId: { type: Schema.Types.ObjectId, ref: 'Tournament', index: true },
    roundIndex: { type: Number },
    pairingIndex: { type: Number },
    berserk: {
      type: new Schema(
        { white: { type: Boolean, default: false }, black: { type: Boolean, default: false } },
        { _id: false },
      ),
      default: () => ({ white: false, black: false }),
    },
    startedAt: { type: Date },
    endedAt: { type: Date },
    whiteRemainingMs: { type: Number, default: null },
    blackRemainingMs: { type: Number, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Fast lookup of a user's open game to join, and open-game listing.
gameSchema.index({ status: 1, createdAt: -1 });

export const Game = mongoose.model<IGame>('Game', gameSchema);
