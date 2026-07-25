import mongoose, { Schema, type Document, type Types } from 'mongoose';

// A "cage match" is a pre-defined ordered series of games (legs) between the
// same two players — e.g. 10 bullet + 5 blitz + 3 rapid, played back to back.
// Legs are created and settled one at a time, reusing the exact same Game
// documents / socket flow as a standalone game (each leg IS a normal Game,
// just tagged with cageMatchId + legIndex) — this file only tracks the
// series-level bookkeeping: the leg plan, running score, and overall wager.

export type CageMatchStatus = 'active' | 'finished' | 'cancelled';

// How the overall winner of the match is decided.
export type CageWinnerMode = 'total_score' | 'most_categories' | 'first_to_n';

// How (and whether) the match is wagered.
//  - 'none': free match, no tokens at stake.
//  - 'winner_takes_all': the full wagerTokens amount is staked once by each
//    player up front and escrowed for the whole match; the overall winner
//    takes the combined pot at the end (refunded to both on an overall draw).
//  - 'per_leg': wagerTokens is a PER-LEG stake — each leg is staked and
//    settled independently, exactly like a normal wagered game, the moment
//    that leg finishes.
//  - 'split_even': wagerTokens is the TOTAL amount a player is willing to
//    risk across the whole match; it's divided evenly across the legs and
//    each slice is staked/settled leg-by-leg (same mechanics as 'per_leg',
//    just a different way of sizing the per-leg stake from user input).
export type CageWagerMode = 'none' | 'winner_takes_all' | 'per_leg' | 'split_even';

// bullet/blitz/rapid/classical, auto-derived from each leg's base time —
// this is what "most_categories" groups legs by.
export type LegCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

export type LegResult = 'p1' | 'p2' | 'draw' | null;

// Why the match itself ended (distinct from an individual leg's endReason):
//  - 'completed': every leg was played (or the winner mode's target/clinch
//    condition was met) and the score decided it normally.
//  - 'no_show_forfeit': a player didn't make their first move of a leg
//    within the grace period, which ends the WHOLE match immediately in the
//    other player's favor — not just that one leg. This exists specifically
//    to stop someone from just walking away mid-series once a new leg
//    auto-starts. A normal mid-game clock timeout, by contrast, only loses
//    that one leg and the match continues on score as usual.
//  - 'forfeit': a player explicitly forfeited the whole match.
export type CageMatchEndReason = 'completed' | 'no_show_forfeit' | 'forfeit' | null;

export interface ICageLeg {
  index: number;
  variant: 'standard' | 'chess960';
  baseMinutes: number | null;
  incrementSeconds: number;
  category: LegCategory;
  // 'paused' only ever applies before either side has moved — see the
  // cage:pause_request / cage:resume_request socket flow. Both players must
  // agree to pause and to resume; either can request, the other accepts or
  // declines.
  status: 'pending' | 'active' | 'paused' | 'finished' | 'skipped';
  gameId: Types.ObjectId | null;
  joinCode: string | null;
  result: LegResult;
  endReason: string | null;
}

export interface ICageMatch extends Document {
  _id: Types.ObjectId;
  matchCode: string;
  // player1 is always the challenger (match creator); player2 the friend who
  // accepted. Board colors still alternate/randomize per leg independently —
  // this ordering is just for score bookkeeping, not who plays white.
  player1: Types.ObjectId;
  player2: Types.ObjectId;
  legs: ICageLeg[];
  currentLegIndex: number;
  status: CageMatchStatus;
  winnerMode: CageWinnerMode;
  targetWins: number | null; // only used when winnerMode === 'first_to_n'
  wagerMode: CageWagerMode;
  // Interpretation depends on wagerMode — see CageWagerMode docs above.
  // Always 0 when wagerMode === 'none'.
  wagerTokens: number;
  wagerSettled: boolean;
  matchWinner: 'p1' | 'p2' | 'draw' | null;
  matchEndReason: CageMatchEndReason;
  forfeitedBy: Types.ObjectId | null;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}

const legSchema = new Schema<ICageLeg>(
  {
    index: { type: Number, required: true },
    variant: { type: String, enum: ['standard', 'chess960'], default: 'standard' },
    baseMinutes: { type: Number, default: null },
    incrementSeconds: { type: Number, default: 0 },
    category: { type: String, enum: ['bullet', 'blitz', 'rapid', 'classical'], required: true },
    status: {
      type: String,
      enum: ['pending', 'active', 'paused', 'finished', 'skipped'],
      default: 'pending',
    },
    gameId: { type: Schema.Types.ObjectId, ref: 'Game', default: null },
    joinCode: { type: String, default: null },
    result: { type: String, enum: ['p1', 'p2', 'draw', null], default: null },
    endReason: { type: String, default: null },
  },
  { _id: false },
);

const cageMatchSchema = new Schema<ICageMatch>(
  {
    matchCode: { type: String, required: true, unique: true, index: true },
    player1: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    player2: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    legs: { type: [legSchema], default: [] },
    currentLegIndex: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['active', 'finished', 'cancelled'],
      default: 'active',
      index: true,
    },
    winnerMode: {
      type: String,
      enum: ['total_score', 'most_categories', 'first_to_n'],
      default: 'total_score',
    },
    targetWins: { type: Number, default: null },
    wagerMode: {
      type: String,
      enum: ['none', 'winner_takes_all', 'per_leg', 'split_even'],
      default: 'none',
    },
    wagerTokens: { type: Number, default: 0, min: 0 },
    wagerSettled: { type: Boolean, default: false },
    matchWinner: { type: String, enum: ['p1', 'p2', 'draw', null], default: null },
    matchEndReason: {
      type: String,
      enum: ['completed', 'no_show_forfeit', 'forfeit', null],
      default: null,
    },
    forfeitedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    startedAt: { type: Date, default: () => new Date() },
    endedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

cageMatchSchema.index({ status: 1, createdAt: -1 });
cageMatchSchema.index({ player1: 1, status: 1 });
cageMatchSchema.index({ player2: 1, status: 1 });

export const CageMatch = mongoose.model<ICageMatch>('CageMatch', cageMatchSchema);
