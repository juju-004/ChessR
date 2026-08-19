import mongoose, { Schema, type Document, type Types } from 'mongoose';

// A tournament is a multi-player event (as opposed to a cage match, which is
// always exactly two players). Same underlying idea though: an ordered
// sequence of rounds, each round made of pairings, each pairing IS a normal
// Game (tagged with tournamentId + roundIndex + pairingIndex) reusing the
// exact same move/clock/socket machinery as a standalone game.

export type TournamentFormat = 'normal' | 'swiss' | 'robin' | 'round_robin' | 'arena';
// 'normal'      — single-elimination knockout bracket, byes for non-power-of-2 fields.
// 'swiss'       — fixed number of rounds, opponents paired by score each round.
// 'robin'       — legacy: single round-robin (every player plays every other
//                 player once). No longer offered at creation — superseded
//                 by 'round_robin' + robinRounds below — but still handled
//                 by the pairing/scoring engine so tournaments created
//                 before this change keep working exactly as they did.
// 'round_robin' — every player plays every other player `robinRounds` times
//                 (colors reversed on alternating laps, like home/away).
//                 robinRounds === 1 is equivalent to legacy 'robin';
//                 robinRounds === 2 is equivalent to the old hardcoded
//                 'round_robin' behavior (always-double), now just the
//                 default rather than the only option.
// 'arena'       — Lichess-style free-for-all: once the event starts, every
//                 available player is continuously paired against another
//                 available player for as long as the arena clock runs,
//                 rather than everyone moving through synchronized rounds
//                 together. See tryArenaPairings in tournament.service.ts.

export type TournamentStatus = 'pending' | 'active' | 'finished' | 'cancelled';

export type PairingResult = 'p1' | 'p2' | 'draw' | null;

// One tier of the creator-funded prize schedule — e.g. { fromRank: 3,
// toRank: 8, tokens: 50 } means "each of 3rd through 8th place gets 50 R".
// The full schedule's total commitment (tokens * range size, summed across
// tiers) is deducted from the creator's balance up front at creation time —
// see prizePoolTokens below — so the payout at the end is never blocked on
// the creator's balance at that point.
export interface ITournamentPrizeTier {
  fromRank: number;
  toRank: number;
  tokens: number;
}

export interface ITournamentPlayer {
  user: Types.ObjectId;
  username: string;
  // Snapshotted from the User doc at join time (same denormalization as
  // username above) — good enough for a tournament roster, and avoids a
  // populate on every tournament fetch just to render avatars. Doesn't
  // update retroactively if the player changes their avatar mid-tournament,
  // same tradeoff username already makes with a username change.
  avatarGradient: string | null;
  joinedAt: Date;
  // Points accumulate for swiss/robin/round_robin (1 / 0.5 / 0, +0.5 bonus for
  // a berserked win). A bye is worth 0 points (see tournament.service.ts's
  // applyPairingScore) — it still counts as having played the round for
  // pairing purposes (hadBye), just not as a win. For 'normal' points are
  // unused — elimination position is what matters, tracked via
  // `eliminatedRound`.
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
  // Arena-only: the player has voluntarily stepped out of the pairing
  // queue without withdrawing from the event entirely — like Lichess's
  // pause button. They keep their points/standing and can toggle this
  // back off at any time to resume being paired. Meaningless for every
  // other format (there's no continuous pairing queue to step out of).
  paused: boolean;
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
  // True when the creator set this up purely to run it — see
  // createTournament in tournament.service.ts: when set, the creator is
  // never pushed into `players` and never charged regFeeTokens. Immutable
  // after creation (not exposed on the edit form) since flipping it after
  // players have joined would mean either retroactively refunding/charging
  // the creator or forcibly adding/removing them from a roster that other
  // players and pairings already reference.
  organizerOnly: boolean;
  format: TournamentFormat;
  variant: 'standard' | 'chess960';
  baseMinutes: number | null;
  incrementSeconds: number;
  status: TournamentStatus;
  // Human-readable explanation for why status === 'cancelled', shown on the
  // tournament page in place of the usual pending/active/finished content —
  // e.g. "Cancelled by the organiser" or "Not enough players to start the
  // tournament". Null for every non-cancelled status.
  cancelReason: string | null;
  // When cancellation happened — drives sweepCancelledTournaments' cleanup
  // window (see tournament.service.ts): cancelled tournaments carry no
  // lasting value (no games were played, there's no history worth keeping),
  // so they're actually deleted from the database a short while after this
  // timestamp rather than accumulating forever. Null for every
  // non-cancelled status.
  cancelledAt: Date | null;
  minPlayers: number;
  maxPlayers: number;
  players: ITournamentPlayer[];
  berserkAllowed: boolean;
  // Whether this tournament shows up in the public "Open tournaments"
  // browse list. Defaults to false — a tournament is reachable via its
  // link/code either way, this just controls whether strangers can also
  // stumble onto it without the link. Independent of passwordHash: a public
  // tournament can still require a password to actually join.
  isPublic: boolean;
  // --- Prize pool: creator-funded, paid out by final rank -------------------
  // Entirely separate from the registration fee below. The creator defines a
  // payout schedule at creation time (e.g. 1st gets 200, 2nd gets 100, 3rd
  // through 8th get 50 each); the full committed total is deducted from the
  // CREATOR's own balance immediately, so it's never at risk of being
  // under-funded when the tournament actually finishes. Empty schedule = no
  // prize pool for this event.
  prizeSchedule: ITournamentPrizeTier[];
  prizePoolTokens: number; // total committed, = sum(tokens * range size) over prizeSchedule
  prizePoolSettled: boolean;
  // --- Registration fee: player-funded, paid out to the creator --------------
  // Every joining player (creator included) pays this into escrow; held by
  // the tournament until it finishes, then the pool (minus the platform's
  // rake — see wallet.service.ts's computeRake) goes to the creator as
  // compensation for running the event — it is NOT split among winners
  // (that's what prizeSchedule is for). Compulsory (>= 1) for every
  // tournament created going forward — enforced in createTournament/
  // updateTournament (tournament.service.ts) and the create/edit socket
  // schemas (tournamentSocket.ts). 0 only appears on tournaments created
  // before that requirement existed.
  regFeeTokens: number;
  regFeePoolTokens: number; // accumulates as players join
  regFeeSettled: boolean;
  // Optional gate on joining (not on viewing — the tournament page itself is
  // reachable by anyone with the link/code; only becoming a player requires
  // the password). null/empty = no password. Never sent to the client as
  // anything but a hasPassword boolean — see getTournamentByCode.
  passwordHash: string | null;
  // Only meaningful for format === 'swiss' — how many rounds the event runs.
  swissRounds: number | null;
  // Only meaningful for format === 'round_robin' — how many times the field
  // plays through the full round-robin schedule (1 = single round, 2 =
  // double/home-away, etc). Null for every other format, including legacy
  // 'robin' docs (which are implicitly always 1 lap).
  robinRounds: number | null;
  // Only meaningful for format === 'arena' — how long the event runs once
  // started. arenaEndsAt is the actual computed deadline (set at start
  // time from arenaMinutes), the thing the pairing engine and the client's
  // countdown both check against; arenaMinutes is just the creator's
  // original input, kept around for display/editing.
  arenaMinutes: number | null;
  arenaEndsAt: Date | null;
  currentRoundIndex: number;
  rounds: ITournamentRound[];
  // How long the lobby waits between one round finishing and the next one's
  // games actually starting — gives players a breather to see standings, use
  // the bathroom, whatever, rather than getting yanked straight into another
  // game. Defaults to 10s; organizers can widen it at creation time.
  breakSeconds: number;
  // Set the moment a round finishes and the next one enters its break
  // window; null the rest of the time (including while a round is actually
  // being played). Purely a display timestamp for the client's countdown —
  // the server's own scheduling doesn't depend on reading this back.
  nextRoundStartsAt: Date | null;
  // When set, the tournament starts itself automatically at this time
  // instead of waiting on the creator to press Start manually — see
  // scheduleAutoStart in tournament.service.ts. null means manual start.
  scheduledStartAt: Date | null;
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

const prizeTierSchema = new Schema<ITournamentPrizeTier>(
  {
    fromRank: { type: Number, required: true, min: 1 },
    toRank: { type: Number, required: true, min: 1 },
    tokens: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const playerSchema = new Schema<ITournamentPlayer>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    avatarGradient: { type: String, default: null },
    joinedAt: { type: Date, default: () => new Date() },
    points: { type: Number, default: 0 },
    tiebreak: { type: Number, default: 0 },
    gamesPlayed: { type: Number, default: 0 },
    berserkWins: { type: Number, default: 0 },
    eliminatedRound: { type: Number, default: null },
    hadBye: { type: Boolean, default: false },
    withdrawn: { type: Boolean, default: false },
    paused: { type: Boolean, default: false },
  },
  { _id: false },
);

const tournamentSchema = new Schema<ITournament>(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organizerOnly: { type: Boolean, default: false },
    format: { type: String, enum: ['normal', 'swiss', 'robin', 'round_robin', 'arena'], required: true },
    variant: { type: String, enum: ['standard', 'chess960'], default: 'standard' },
    baseMinutes: { type: Number, default: null },
    incrementSeconds: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'active', 'finished', 'cancelled'],
      default: 'pending',
      index: true,
    },
    cancelReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null, index: true },
    minPlayers: { type: Number, required: true },
    maxPlayers: { type: Number, required: true },
    players: { type: [playerSchema], default: [] },
    berserkAllowed: { type: Boolean, default: true },
    isPublic: { type: Boolean, default: false, index: true },
    prizeSchedule: { type: [prizeTierSchema], default: [] },
    prizePoolTokens: { type: Number, default: 0 },
    prizePoolSettled: { type: Boolean, default: false },
    regFeeTokens: { type: Number, default: 0, min: 0 },
    regFeePoolTokens: { type: Number, default: 0 },
    regFeeSettled: { type: Boolean, default: false },
    passwordHash: { type: String, default: null },
    swissRounds: { type: Number, default: null },
    robinRounds: { type: Number, default: null },
    arenaMinutes: { type: Number, default: null },
    arenaEndsAt: { type: Date, default: null },
    currentRoundIndex: { type: Number, default: 0 },
    rounds: { type: [roundSchema], default: [] },
    breakSeconds: { type: Number, default: 10 },
    nextRoundStartsAt: { type: Date, default: null },
    scheduledStartAt: { type: Date, default: null },
    winner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    runnerUp: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    startedAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

tournamentSchema.index({ status: 1, createdAt: -1 });

export const Tournament = mongoose.model<ITournament>('Tournament', tournamentSchema);
