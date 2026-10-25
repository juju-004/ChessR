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
  /** Crazyhouse: role letter (p/n/b/r/q) of the piece dropped by this move.
   *  For a drop, `from` and `to` are both the target square. */
  drop?: string;
  /** Position after this move. Always present on live (Redis) moves; only
   *  PERSISTED for Crazyhouse, whose pockets chess.js can't replay. Standard
   *  and Chess960 games drop it when they end (clients replay the SAN) which
   *  roughly halves a game's stored size. */
  fenAfter?: string;
  moveNumber: number;
  timestampMs: number;
  /** The mover's own remaining clock (ms) right after this move, increment
   *  included, exactly as the server charged it (lag compensation, berserk,
   *  odds clocks and the free first move all already applied). Absent for
   *  untimed games and for games played before this field existed. */
  clockMs?: number;
}

export interface ITimeControl {
  // null baseSeconds means untimed / unlimited.
  baseSeconds: number | null;
  incrementSeconds: number;
}

/** Odds games: each player has their own clock. Keyed by colour, so it is
 *  already resolved to white/black once the colours are drawn. */
export interface IGameClocks {
  white: ITimeControl;
  black: ITimeControl;
}

export interface IGame extends Document {
  _id: Types.ObjectId;
  joinCode: string;
  variant: 'standard' | 'chess960' | 'crazyhouse';
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
  // Only set on odds games (a challenge where the two players have different
  // clocks). `timeControl` then holds the faster of the two for display and
  // rating-category purposes; these are the clocks actually played.
  clocks?: IGameClocks | null;
  // Optional: link back to a friend challenge, for auditability.
  challengeId?: string;
  isPrivate: boolean;
  // Per-player R token stake. Total pot awarded to the winner is wagerTokens * 2.
  // 0 means a free (unwagered) game.
  wagerTokens: number;
  // Flips to true exactly once, the moment the wager for this game has been
  // paid out or refunded, guards against double-crediting tokens if the
  // settlement path is ever triggered twice for the same game (e.g. a
  // reconciliation sweep racing the live socket flow after a restart).
  wagerSettled: boolean;
  /** Flips to true exactly once, the moment this game's result has been
   *  folded into both players' rating (see rating.service.ts's
   *  applyRatingForGame), same double-application guard pattern as
   *  wagerSettled, for the same reason (more than one code path can reach
   *  a decisive finish for the same game: the live game-over flow and
   *  boot-time reconciliation). */
  ratingApplied: boolean;
  // Set when this game is one leg of a cage match, links back to the parent
  // CageMatch document and records this leg's position in its ordered list.
  // Left undefined for standalone games (the overwhelming majority).
  cageMatchId?: Types.ObjectId;
  legIndex?: number;
  // Set when this game is one pairing of a tournament round, links back to
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
  // Each side's clock, frozen at the moment the game ended, never
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
    drop: { type: String, enum: ['p', 'n', 'b', 'r', 'q'] },
    fenAfter: { type: String },
    moveNumber: { type: Number, required: true },
    timestampMs: { type: Number, required: true },
    clockMs: { type: Number },
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

const clocksSchema = new Schema<IGameClocks>(
  {
    white: { type: timeControlSchema, required: true },
    black: { type: timeControlSchema, required: true },
  },
  { _id: false },
);

const gameSchema = new Schema<IGame>(
  {
    // Short, shareable, human-typeable identifier, this is what shows up in the
    // URL and what a friend types in to join. The Mongo _id stays internal.
    joinCode: { type: String, required: true, unique: true, index: true },
    variant: { type: String, enum: ['standard', 'chess960', 'crazyhouse'], default: 'standard' },
    initialFen: {
      type: String,
      required: true,
      default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    },
    // No `index: true` on white/black/status: the compound indexes below all
    // start with them, so single-field copies only cost extra write work.
    white: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    black: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: ['waiting', 'active', 'finished', 'aborted'],
      default: 'waiting',
    },
    result: { type: String, enum: ['white', 'black', 'draw', null], default: null },
    endReason: { type: String, default: null },
    fen: {
      type: String,
      default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    },
    pgn: { type: String, default: '' },
    moves: { type: [moveSchema], default: [] },
    clocks: { type: clocksSchema, default: undefined },
    timeControl: {
      type: timeControlSchema,
      default: () => ({ baseSeconds: 600, incrementSeconds: 0 }),
    },
    challengeId: { type: String },
    isPrivate: { type: Boolean, default: false },
    wagerTokens: { type: Number, default: 0, min: 0 },
    wagerSettled: { type: Boolean, default: false },
    ratingApplied: { type: Boolean, default: false },
    // cageMatchId / tournamentId used to be indexed, but nothing queries by them
    // (only $ne / $exists:false, which can't use an index), and an index on a
    // field most games don't have still costs an entry per game.
    cageMatchId: { type: Schema.Types.ObjectId, ref: 'CageMatch' },
    legIndex: { type: Number },
    tournamentId: { type: Schema.Types.ObjectId, ref: 'Tournament' },
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
// Lets the 60s reconcile sweep page through active games in _id order
// without sorting the whole active set on every page.
gameSchema.index({ status: 1, _id: 1 });

// Supports getUserGames (a profile's game history): filters on
// {status: 'finished', $or: [{white}, {black}]}, sorted by endedAt. There
// was previously no index covering this at all — MongoDB had to do a full
// collection scan plus an in-memory sort on every single request, which
// gets slower as the total games collection grows over time (fast at
// launch when the collection was tiny, much slower months later, exactly
// the "it used to be quick, now it's 1s+" pattern this was caught from).
// Two indexes rather than one {white, black, ...} compound, since the
// query is an $or across two different fields (a game's white and black
// side aren't the same field) — Mongo can satisfy each branch of the $or
// from its own matching index this way, rather than neither branch
// matching anything and falling back to a full scan.
gameSchema.index({ white: 1, status: 1, endedAt: -1 });
gameSchema.index({ black: 1, status: 1, endedAt: -1 });
// Profile win/loss/draw counts filter on (player, status, result). With
// `result` in the index they're answered from the index alone instead of
// loading every finished game document (which carries the whole move list).
// Season leaderboards scan finished games by end-time window.
gameSchema.index({ status: 1, endedAt: 1 });
gameSchema.index({ white: 1, status: 1, result: 1 });
gameSchema.index({ black: 1, status: 1, result: 1 });

export const Game = mongoose.model<IGame>('Game', gameSchema);
