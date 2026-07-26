import mongoose, { Schema, type Document, type Types } from 'mongoose';

// A tournament is a multi-player event (as opposed to a cage match, which is
// always exactly two players). Same underlying idea though: an ordered
// sequence of rounds, each round made of pairings, each pairing IS a normal
// Game (tagged with tournamentId + roundIndex + pairingIndex) reusing the
// exact same move/clock/socket machinery as a standalone game.

export type TournamentFormat = 'normal' | 'swiss' | 'robin' | 'round_robin';
// 'normal'      — single-elimination knockout bracket, byes for non-power-of-2 fields.
// 'swiss'       — fixed number of rounds, opponents paired by score each round.
// 'robin'       — single round-robin: every player plays every other player once.
// 'round_robin' — double round-robin: every player plays every other player
//                 twice (colors reversed the second time), like home/away.

export type TournamentStatus = 'pending' | 'active' | 'finished' | 'cancelled';

// Entry-fee based wagering: every player stakes the same number of tokens to
// join, forming a shared prize pool that gets split among the top finishers
// once the event concludes. There's no per-game staking inside a tournament.
export type TournamentWagerMode = 'none' | 'entry_fee';

export type PairingResult = 'p1' | 'p2' | 'draw' | null;

export interface ITournamentPlayer {
  user: Types.ObjectId;
  username: string;
  joinedAt: Date;
  // Points accumulate for swiss/robin/round_robin (1 / 0.5 / 0, +0.5 bonus for
  // a berserked win). For 'normal' this is unused — elimination position is
  // what matters, tracked via `eliminatedRound`.
  points: number;
  // Sum of the current points of every opponent faced so far — a simple
  // Buchholz-style tiebreaker for swiss/robin standings.
  tiebreak: number;
  gamesPlayed: number;
  berserkWins: number;
  // Knockout-only: null while still alive, otherwise the round index they
  // were knocked out in (or -1 if they never got placed into the bracket at
  // all, which only happens if someone leaves before the bracket is drawn).
  eliminatedRound: number | null;
  hadBye: boolean;
  withdrawn: boolean;
}

export interface ITournamentPairing {
  index: number;
  // player2 === null means this pairing is a bye (only possible for swiss
  // mid-event, or knockout when the bracket has more slots than players).
  player1: Types.ObjectId;
  player2: Types.ObjectId | null;
  whiteId: Types.ObjectId | null;
  blackId: Types.ObjectId | null;
  gameId: Types.ObjectId | null;
  joinCode: string | null;
  status: 'pending' | 'active' | 'finished';
  result: PairingResult;
  endReason: string | null;
  berserk: { p1: boolean; p2: boolean };
}

export interface ITournamentRound {
  index: number;
  status: 'pending' | 'active' | 'finished';
  pairings: ITournamentPairing[];
  startedAt?: Date;
  endedAt?: Date;
}

export interface ITournament extends Document {
  _id: Types.ObjectId;
  code: string;
  name: string;
  createdBy: Types.ObjectId;
  format: TournamentFormat;
  variant: 'standard' | 'chess960';
  baseMinutes: number | null;
  incrementSeconds: number;
  status: TournamentStatus;
  minPlayers: number;
  maxPlayers: number;
  players: ITournamentPlayer[];
  berserkAllowed: boolean;
  wagerMode: TournamentWagerMode;
  wagerTokens: number; // per-player entry fee; 0 when wagerMode === 'none'
  prizePoolTokens: number;
  prizeSettled: boolean;
  // Only meaningful for format === 'swiss' — how many rounds the event runs.
  swissRounds: number | null;
  currentRoundIndex: number;
  rounds: ITournamentRound[];
  winner: Types.ObjectId | null;
  runnerUp: Types.ObjectId | null;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}

const pairingSchema = new Schema<ITournamentPairing>(
  {
    index: { type: Number, required: true },
    player1: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    player2: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    whiteId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    blackId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    gameId: { type: Schema.Types.ObjectId, ref: 'Game', default: null },
    joinCode: { type: String, default: null },
    status: { type: String, enum: ['pending', 'active', 'finished'], default: 'pending' },
    result: { type: String, enum: ['p1', 'p2', 'draw', null], default: null },
    endReason: { type: String, default: null },
    berserk: {
      p1: { type: Boolean, default: false },
      p2: { type: Boolean, default: false },
    },
  },
  { _id: false },
);

const roundSchema = new Schema<ITournamentRound>(
  {
    index: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'active', 'finished'], default: 'pending' },
    pairings: { type: [pairingSchema], default: [] },
    startedAt: { type: Date },
    endedAt: { type: Date },
  },
  { _id: false },
);

const playerSchema = new Schema<ITournamentPlayer>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    joinedAt: { type: Date, default: () => new Date() },
    points: { type: Number, default: 0 },
    tiebreak: { type: Number, default: 0 },
    gamesPlayed: { type: Number, default: 0 },
    berserkWins: { type: Number, default: 0 },
    eliminatedRound: { type: Number, default: null },
    hadBye: { type: Boolean, default: false },
    withdrawn: { type: Boolean, default: false },
  },
  { _id: false },
);

const tournamentSchema = new Schema<ITournament>(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    format: { type: String, enum: ['normal', 'swiss', 'robin', 'round_robin'], required: true },
    variant: { type: String, enum: ['standard', 'chess960'], default: 'standard' },
    baseMinutes: { type: Number, default: null },
    incrementSeconds: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'active', 'finished', 'cancelled'],
      default: 'pending',
      index: true,
    },
    minPlayers: { type: Number, required: true },
    maxPlayers: { type: Number, required: true },
    players: { type: [playerSchema], default: [] },
    berserkAllowed: { type: Boolean, default: true },
    wagerMode: { type: String, enum: ['none', 'entry_fee'], default: 'none' },
    wagerTokens: { type: Number, default: 0, min: 0 },
    prizePoolTokens: { type: Number, default: 0 },
    prizeSettled: { type: Boolean, default: false },
    swissRounds: { type: Number, default: null },
    currentRoundIndex: { type: Number, default: 0 },
    rounds: { type: [roundSchema], default: [] },
    winner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    runnerUp: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    startedAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

tournamentSchema.index({ status: 1, createdAt: -1 });

export const Tournament = mongoose.model<ITournament>('Tournament', tournamentSchema);
