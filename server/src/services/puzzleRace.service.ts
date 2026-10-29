import { generateShortCode } from '../utils/shortCode.js';
import mongoose from 'mongoose';
import { Puzzle } from '../models/Puzzle.js';
import {
  PuzzleRace,
  type IPuzzleRace,
  type IRacePlayer,
  type IRacePuzzle,
  type PuzzleRaceDifficulty,
} from '../models/PuzzleRace.js';
import { ApiError } from '../utils/ApiError.js';
import { getIo } from '../sockets/io.js';
import { assertNotRestricted } from './suspension.service.js';
import { describePuzzle, evaluateMove } from './puzzleRace.logic.js';
import { trackDaily } from './dailyChallenge.service.js';
import {
  debitPuzzleRaceStake,
  creditPuzzleRaceReturn,
  computeRake,
  recordRake,
} from './wallet.service.js';

// --- Rules -------------------------------------------------------------------
export const PUZZLE_RACE_MIN_PLAYERS = 2;
export const PUZZLE_RACE_MAX_PLAYERS = 8;
export const PUZZLE_RACE_MIN_PUZZLES = 3;
export const PUZZLE_RACE_MAX_PUZZLES = 10;
/** Pause between the race starting and the first puzzle being playable. */
export const PUZZLE_RACE_COUNTDOWN_MS = 5_000;
/** A wrong move locks the player out for this long, so guessing isn't free. */
export const PUZZLE_RACE_MISTAKE_LOCK_MS = 5_000;
/** Seats can be taken after the race has started, but not in its last moments
 *  (a joiner would have no time to play and would just lose their stake). */
export const PUZZLE_RACE_LATE_JOIN_CUTOFF_MS = 10_000;
/** Stored in `rematchCode` while a rematch is being created. */
const REMATCH_PENDING = 'pending';
/** Time budget per puzzle; the whole race ends after puzzleCount × this. */
export const PUZZLE_RACE_SECONDS_PER_PUZZLE = 60;
/** A race nobody started is cancelled (and refunded) after this long. */
export const PUZZLE_RACE_WAITING_TTL_MS = 10 * 60 * 1000;
/** Slack after endsAt before a late move is refused (network latency). */
const END_GRACE_MS = 750;

export const PUZZLE_RACES_LOBBY_ROOM = 'puzzleRaces:lobby';
export const raceRoom = (raceId: string) => `puzzleRace:${raceId}`;

/** Rating bands. Seed puzzles (scripts/importPuzzles.ts) are rated on the same
 *  scale as Lichess puzzles. */
const DIFFICULTY_RANGE: Record<PuzzleRaceDifficulty, [number, number]> = {
  easy: [0, 1099],
  medium: [1100, 1499],
  hard: [1500, 5000],
  mixed: [0, 5000],
};

const newCode = generateShortCode;

// --- Public shapes -------------------------------------------------------------
type PopulatedUser = { _id: mongoose.Types.ObjectId; username: string; avatarGradient?: string | null };

export interface PublicRacePlayer {
  userId: string;
  username: string;
  avatarGradient: string | null;
  solved: number;
  mistakes: number;
  finished: boolean;
  /** ms from the race start to the player's last solve (null if none yet). */
  lastSolveMs: number | null;
}

export interface PublicRace {
  id: string;
  code: string;
  status: IPuzzleRace['status'];
  difficulty: PuzzleRaceDifficulty;
  puzzleCount: number;
  maxPlayers: number;
  wagerTokens: number;
  timeLimitSeconds: number;
  creatorId: string;
  players: PublicRacePlayer[];
  startsAt: number | null;
  endsAt: number | null;
  /** Server clock at send time, so a client can correct for clock skew. */
  serverNow: number;
  winnerId: string | null;
  endReason: IPuzzleRace['endReason'];
  /** The rematch the host opened, once they have (finished races only). */
  rematchCode: string | null;
  potTokens: number;
  rakeTokens: number;
  payoutTokens: number;
  createdAt: number;
}

/** What a player needs to render their current puzzle. Never includes the
 *  solution, only positions and the opponent's already-played move. */
export interface PuzzleView {
  index: number;
  total: number;
  /** Which move of the puzzle's line the player must find next (1 = a fresh
   *  puzzle). The client sends it back with each move, see submitMove. */
  moveIdx: number;
  fen: string;
  /** The opponent's opening move, to animate on a fresh puzzle (null when
   *  resuming mid-puzzle, `fen` is then already the live position). */
  firstMove: { from: string; to: string; promotion?: string } | null;
  lastMove: [string, string] | null;
  /** The side the player is solving for. */
  orientation: 'white' | 'black';
}

async function loadPopulated(filter: Record<string, unknown>) {
  return PuzzleRace.findOne(filter)
    .populate<{ players: Array<Omit<IRacePlayer, 'user'> & { user: PopulatedUser }> }>(
      'players.user',
      'username avatarGradient',
    )
    .lean();
}

type PopulatedRace = NonNullable<Awaited<ReturnType<typeof loadPopulated>>>;

export function toPublicRace(r: PopulatedRace): PublicRace {
  const startMs = r.startsAt ? new Date(r.startsAt).getTime() : null;
  return {
    id: r._id.toString(),
    code: r.code,
    status: r.status,
    difficulty: r.difficulty,
    puzzleCount: r.puzzleCount,
    maxPlayers: r.maxPlayers,
    wagerTokens: r.wagerTokens,
    timeLimitSeconds: r.timeLimitSeconds,
    creatorId: r.creator.toString(),
    // A player whose account was deleted populates as null; leave them out.
    players: r.players
      .filter((p) => p.user)
      .map((p) => ({
        userId: p.user._id.toString(),
        username: p.user.username,
        avatarGradient: p.user.avatarGradient ?? null,
        solved: p.solved,
        mistakes: p.mistakes,
        finished: p.finishedAt !== null && p.finishedAt !== undefined,
        lastSolveMs:
          p.lastSolvedAt && startMs !== null ? Math.max(0, new Date(p.lastSolvedAt).getTime() - startMs) : null,
      })),
    startsAt: startMs,
    endsAt: r.endsAt ? new Date(r.endsAt).getTime() : null,
    serverNow: Date.now(),
    winnerId: r.winner ? r.winner.toString() : null,
    endReason: r.endReason,
    rematchCode: r.rematchCode && r.rematchCode !== REMATCH_PENDING ? r.rematchCode : null,
    potTokens: r.status === 'finished' || r.status === 'cancelled' ? r.potTokens : r.wagerTokens * r.players.length,
    rakeTokens: r.rakeTokens,
    payoutTokens: r.payoutTokens,
    createdAt: new Date(r.createdAt).getTime(),
  };
}

// --- Realtime fan-out ----------------------------------------------------------
export function broadcastRacesChanged(): void {
  // No payload: the lobby just refetches GET /puzzle-races/open.
  getIo().to(PUZZLE_RACES_LOBBY_ROOM).emit('puzzleRaces:changed');
}

export async function broadcastRaceState(raceId: string): Promise<void> {
  const race = await loadPopulated({ _id: raceId });
  if (!race) return;
  getIo().to(raceRoom(raceId)).emit('puzzleRace:state', toPublicRace(race));
}

// --- Reads ---------------------------------------------------------------------
/** A race still marked active past its end time (its timer was lost to a
 *  restart, or lives on another instance) is finished on the spot by whoever
 *  looks at it, rather than waiting for the next sweep. */
async function finishIfOverdue(code: string): Promise<void> {
  const r = await PuzzleRace.findOne({ code }).select('status endsAt').lean();
  if (r && r.status === 'active' && r.endsAt && Date.now() > r.endsAt.getTime() + END_GRACE_MS) {
    await finishRaceByTime(r._id.toString());
  }
}

/** Race codes are case-sensitive. Races made before codes went mixed-case are
 *  all-uppercase, so a code matching nothing as typed is retried uppercased. */
async function resolveRaceCode(code: string): Promise<string> {
  if (await PuzzleRace.exists({ code })) return code;
  return code.toUpperCase();
}

export async function getPublicRaceByCode(rawCode: string): Promise<PublicRace> {
  const code = await resolveRaceCode(rawCode);
  await finishIfOverdue(code);
  const race = await loadPopulated({ code });
  if (!race) throw ApiError.notFound('Race not found');
  return toPublicRace(race);
}

export async function listOpenRaces(): Promise<PublicRace[]> {
  const races = await PuzzleRace.find({ status: 'waiting' })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate<{ players: Array<Omit<IRacePlayer, 'user'> & { user: PopulatedUser }> }>(
      'players.user',
      'username avatarGradient',
    )
    .lean();
  return races.map(toPublicRace);
}

/** The race (waiting or running) this user is currently in, if any. */
export async function getMyCurrentRace(userId: string): Promise<{ code: string; status: string } | null> {
  const race = await PuzzleRace.findOne({
    status: { $in: ['waiting', 'active'] },
    'players.user': userId,
  })
    .select('code status')
    .lean();
  return race ? { code: race.code, status: race.status } : null;
}

async function assertNotInRace(userId: string): Promise<void> {
  const current = await getMyCurrentRace(userId);
  if (current) throw ApiError.conflict("You're already in a puzzle race. Finish or leave it first.");
}

// --- Create / join / leave / cancel ----------------------------------------------
export interface CreateRaceInput {
  difficulty: PuzzleRaceDifficulty;
  puzzleCount: number;
  maxPlayers: number;
  wagerTokens: number;
}

async function countPuzzlesFor(difficulty: PuzzleRaceDifficulty): Promise<number> {
  const [min, max] = DIFFICULTY_RANGE[difficulty];
  return Puzzle.countDocuments({ rating: { $gte: min, $lte: max } });
}

export async function createRace(userId: string, input: CreateRaceInput): Promise<IPuzzleRace> {
  await assertNotRestricted(userId);
  await assertNotInRace(userId);

  if ((await countPuzzlesFor(input.difficulty)) < input.puzzleCount) {
    throw ApiError.badRequest('Not enough puzzles available for that difficulty yet. Try another one.');
  }

  let race: IPuzzleRace | null = null;
  for (let attempt = 0; attempt < 5 && !race; attempt++) {
    try {
      race = await PuzzleRace.create({
        code: newCode(),
        creator: userId,
        status: 'waiting',
        difficulty: input.difficulty,
        puzzleCount: input.puzzleCount,
        maxPlayers: input.maxPlayers,
        wagerTokens: input.wagerTokens,
        timeLimitSeconds: input.puzzleCount * PUZZLE_RACE_SECONDS_PER_PUZZLE,
        players: [{ user: userId }],
      });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err; // code clash, retry
    }
  }
  if (!race) throw ApiError.internal('Could not allocate a race code');

  // The creator's stake is locked the moment the race opens, so a wagered
  // race can never be sitting in the lobby with a stake that isn't there.
  if (input.wagerTokens > 0) {
    try {
      await debitPuzzleRaceStake(userId, race.id, input.wagerTokens);
    } catch (err) {
      await PuzzleRace.deleteOne({ _id: race._id });
      throw err;
    }
  }

  trackDaily(userId, { type: 'puzzle_race_joined', key: `race-join:${race.id}`, wagerTokens: input.wagerTokens });
  broadcastRacesChanged();
  return race;
}

/** Seats are open while the race is waiting AND while it is running (until its
 *  last few seconds), as long as there is a free one. A player who joins late
 *  starts from the first puzzle with the clock already running. */
export async function joinRace(raceId: string, userId: string): Promise<IPuzzleRace> {
  await assertNotRestricted(userId);
  await assertNotInRace(userId);

  // Claim the seat FIRST (atomically), pay second. Two simultaneous joins from
  // the same user can then never both reach the wallet.
  const lateCutoff = new Date(Date.now() + PUZZLE_RACE_LATE_JOIN_CUTOFF_MS);
  const claimed = await PuzzleRace.findOneAndUpdate(
    {
      _id: raceId,
      $or: [{ status: 'waiting' }, { status: 'active', endsAt: { $gt: lateCutoff } }],
      'players.user': { $ne: userId },
      $expr: { $lt: [{ $size: '$players' }, '$maxPlayers'] },
    },
    { $push: { players: { user: userId, joinedAt: new Date() } } },
    { new: true },
  );
  if (!claimed) {
    const race = await PuzzleRace.findById(raceId).lean();
    if (!race) throw ApiError.notFound('Race not found');
    if (race.players.some((p) => p.user.toString() === userId)) throw ApiError.conflict("You're already in this race");
    if (race.status === 'cancelled') throw ApiError.conflict('This race was cancelled');
    if (race.status === 'finished') throw ApiError.conflict('This race is over');
    if (race.players.length >= race.maxPlayers) throw ApiError.conflict('This race is full');
    throw ApiError.conflict('This race is almost over, too late to join');
  }

  if (claimed.wagerTokens > 0) {
    try {
      await debitPuzzleRaceStake(userId, claimed.id, claimed.wagerTokens);
    } catch (err) {
      await PuzzleRace.updateOne(
        { _id: claimed._id, status: { $in: ['waiting', 'active'] } },
        { $pull: { players: { user: new mongoose.Types.ObjectId(userId) } } },
      );
      throw err;
    }
  }

  trackDaily(userId, { type: 'puzzle_race_joined', key: `race-join:${claimed.id}`, wagerTokens: claimed.wagerTokens });
  broadcastRacesChanged();
  void broadcastRaceState(claimed.id);

  // A full table starts itself (a race that is already running just carries on).
  if (claimed.status === 'waiting' && claimed.players.length >= claimed.maxPlayers) {
    await startRace(claimed.id).catch((err) => console.error('auto-start puzzle race failed:', err));
  }
  return claimed;
}

export async function leaveRace(raceId: string, userId: string): Promise<void> {
  const race = await PuzzleRace.findById(raceId).lean();
  if (!race) throw ApiError.notFound('Race not found');
  if (race.creator.toString() === userId) return cancelRace(raceId, userId);

  const before = await PuzzleRace.findOneAndUpdate(
    { _id: raceId, status: 'waiting', 'players.user': userId },
    { $pull: { players: { user: new mongoose.Types.ObjectId(userId) } } },
  ).lean();
  if (!before) throw ApiError.conflict("You can't leave a race that has already started");

  await creditPuzzleRaceReturn(userId, raceId, before.wagerTokens, 'puzzle_race_refund');
  broadcastRacesChanged();
  void broadcastRaceState(raceId);
}

/** The host opens a new race with the same settings once this one is over. The
 *  host is seated (and staked) straight away; the other racers are told through
 *  the old race's state (`rematchCode`) and can join from there. Safe to call
 *  twice: the second call returns the rematch the first one made. */
export async function createRematch(raceId: string, userId: string): Promise<{ id: string; code: string }> {
  const race = await PuzzleRace.findById(raceId).lean();
  if (!race) throw ApiError.notFound('Race not found');
  if (race.creator.toString() !== userId) throw ApiError.forbidden('Only the host can start a rematch');
  if (race.status !== 'finished') throw ApiError.conflict('A rematch is only possible once the race is over');

  // A rematch that already exists (and wasn't cancelled) is simply returned.
  if (race.rematchCode && race.rematchCode !== REMATCH_PENDING) {
    const existing = await PuzzleRace.findOne({ code: race.rematchCode }).select('_id code status').lean();
    if (existing && existing.status !== 'cancelled') return { id: existing._id.toString(), code: existing.code };
    // The old rematch fell through (host cancelled it): free the slot for a new one.
    await PuzzleRace.updateOne({ _id: raceId, rematchCode: race.rematchCode }, { $set: { rematchCode: null } });
  }

  // Claim the slot before creating, so two clicks can't open two rematches. A
  // 'pending' claim older than 30s is a crashed attempt and may be retaken.
  const claim = await PuzzleRace.updateOne(
    {
      _id: raceId,
      $or: [
        { rematchCode: null },
        { rematchCode: { $exists: false } },
        { rematchCode: REMATCH_PENDING, updatedAt: { $lt: new Date(Date.now() - 30_000) } },
      ],
    },
    { $set: { rematchCode: REMATCH_PENDING } },
  );
  if (!claim.matchedCount) {
    const now = await PuzzleRace.findById(raceId).select('rematchCode').lean();
    if (now?.rematchCode && now.rematchCode !== REMATCH_PENDING) {
      const existing = await PuzzleRace.findOne({ code: now.rematchCode }).select('_id code').lean();
      if (existing) return { id: existing._id.toString(), code: existing.code };
    }
    throw ApiError.conflict('The rematch is being set up, one moment');
  }

  try {
    const created = await createRace(userId, {
      difficulty: race.difficulty,
      puzzleCount: race.puzzleCount,
      maxPlayers: race.maxPlayers,
      wagerTokens: race.wagerTokens,
    });
    await PuzzleRace.updateOne({ _id: raceId }, { $set: { rematchCode: created.code } });
    void broadcastRaceState(raceId);
    return { id: created.id, code: created.code };
  } catch (err) {
    await PuzzleRace.updateOne({ _id: raceId, rematchCode: REMATCH_PENDING }, { $set: { rematchCode: null } });
    throw err;
  }
}

/** The creator closes a waiting race; every stake goes back. */
export async function cancelRace(raceId: string, userId: string): Promise<void> {
  const race = await PuzzleRace.findById(raceId).lean();
  if (!race) throw ApiError.notFound('Race not found');
  if (race.creator.toString() !== userId) throw ApiError.forbidden('Only the creator can cancel this race');
  if (race.status !== 'waiting') throw ApiError.conflict('This race can no longer be cancelled');
  await closeWaitingRace(raceId);
}

async function closeWaitingRace(raceId: string): Promise<void> {
  const closed = await PuzzleRace.findOneAndUpdate(
    { _id: raceId, status: 'waiting' },
    { $set: { status: 'cancelled', endReason: 'cancelled', finishedAt: new Date() } },
    { new: true },
  );
  if (!closed) return;
  await settleRace(closed.id);
  broadcastRacesChanged();
  void broadcastRaceState(closed.id);
}

// --- Start ---------------------------------------------------------------------
async function samplePuzzles(difficulty: PuzzleRaceDifficulty, count: number): Promise<IRacePuzzle[]> {
  const [min, max] = DIFFICULTY_RANGE[difficulty];
  const docs = await Puzzle.aggregate<{ puzzleId: string; fen: string; moves: string[]; rating: number }>([
    { $match: { rating: { $gte: min, $lte: max } } },
    { $sample: { size: count } },
  ]);
  // Easiest first, so a race ramps up.
  return docs
    .sort((a, b) => a.rating - b.rating)
    .map((d) => ({ puzzleId: d.puzzleId, fen: d.fen, moves: d.moves, rating: d.rating }));
}

export async function requestStart(raceId: string, userId: string): Promise<void> {
  const race = await PuzzleRace.findById(raceId).lean();
  if (!race) throw ApiError.notFound('Race not found');
  if (race.creator.toString() !== userId) throw ApiError.forbidden('Only the creator can start the race');
  if (race.status !== 'waiting') throw ApiError.conflict('This race has already started');
  if (race.players.length < PUZZLE_RACE_MIN_PLAYERS) {
    throw ApiError.badRequest('You need at least 2 players to start');
  }
  await startRace(raceId);
}

async function startRace(raceId: string): Promise<void> {
  const race = await PuzzleRace.findById(raceId).lean();
  if (!race || race.status !== 'waiting' || race.players.length < PUZZLE_RACE_MIN_PLAYERS) return;

  const puzzles = await samplePuzzles(race.difficulty, race.puzzleCount);
  if (puzzles.length < race.puzzleCount) {
    // Should have been caught at creation; never leave stakes stuck.
    await closeWaitingRace(raceId);
    return;
  }

  const startsAt = new Date(Date.now() + PUZZLE_RACE_COUNTDOWN_MS);
  const endsAt = new Date(startsAt.getTime() + race.timeLimitSeconds * 1000);
  const started = await PuzzleRace.findOneAndUpdate(
    { _id: raceId, status: 'waiting', 'players.1': { $exists: true } },
    { $set: { status: 'active', puzzles, startsAt, endsAt } },
    { new: true },
  );
  if (!started) return; // someone else started/cancelled it first

  scheduleRaceEnd(started.id, endsAt.getTime());
  broadcastRacesChanged();
  await broadcastRaceState(started.id);
}

// --- Playing ---------------------------------------------------------------------
function buildView(race: Pick<IPuzzleRace, 'puzzles' | 'puzzleCount'>, player: IRacePlayer): PuzzleView | null {
  if (player.solved >= race.puzzleCount) return null;
  const pz = race.puzzles[player.solved];
  if (!pz) return null;
  return {
    index: player.solved,
    total: race.puzzleCount,
    moveIdx: Math.max(1, player.moveIdx),
    ...describePuzzle(pz, player.moveIdx),
  };
}

/** Everything a client needs on entering / re-entering a race page. */
export async function watchRace(rawCode: string, userId: string) {
  const code = await resolveRaceCode(rawCode);
  await finishIfOverdue(code);
  const populated = await loadPopulated({ code });
  if (!populated) throw ApiError.notFound('Race not found');
  const raw = await PuzzleRace.findById(populated._id).lean();
  const me = raw?.players.find((p) => p.user.toString() === userId);
  if (raw) cacheRace(raw);
  const puzzle = raw && me && raw.status === 'active' ? buildView(raw, me) : null;
  const lockMs = me?.penaltyUntil ? Math.max(0, new Date(me.penaltyUntil).getTime() - Date.now()) : 0;
  return { raceId: populated._id.toString(), state: toPublicRace(populated), puzzle, lockMs };
}

export type MoveResult =
  | { ok: true; status: 'correct'; reply: { from: string; to: string; promotion?: string }; nextMoveIdx: number }
  | { ok: true; status: 'solved'; next: PuzzleView }
  | { ok: true; status: 'finished'; won: boolean }
  | { ok: false; status: 'wrong'; lockMs: number }
  | { ok: false; status: 'locked'; lockMs: number }
  | { ok: false; status: 'illegal' | 'not_started' | 'not_active' | 'not_player' | 'stale' | 'done' };

// The parts of an active race that never change once it has started (the
// puzzles and the clock). Keeping them in memory means a move needs no read
// from the database at all: the only database round trip is the single
// conditional write that records it, which is what keeps moves feeling
// instant even when the database is a long way from the server.
interface CachedRace {
  id: string;
  puzzleCount: number;
  puzzles: IRacePuzzle[];
  startsAt: number;
  endsAt: number;
}
const raceCache = new Map<string, CachedRace>(); // keyed by race code
const CACHE_GRACE_MS = 5 * 60 * 1000;

function cacheRace(r: {
  _id: mongoose.Types.ObjectId;
  code: string;
  status: string;
  puzzleCount: number;
  puzzles: IRacePuzzle[];
  startsAt?: Date | null;
  endsAt?: Date | null;
}): CachedRace | null {
  if (r.status !== 'active' || !r.startsAt || !r.endsAt) return null;
  const entry: CachedRace = {
    id: r._id.toString(),
    puzzleCount: r.puzzleCount,
    puzzles: r.puzzles,
    startsAt: r.startsAt.getTime(),
    endsAt: r.endsAt.getTime(),
  };
  raceCache.set(r.code, entry);
  return entry;
}

async function getCachedRace(code: string): Promise<CachedRace | null> {
  const hit = raceCache.get(code);
  if (hit) return hit;
  const race = await PuzzleRace.findOne({ code, status: 'active' }).lean();
  return race ? cacheRace(race) : null;
}

function pruneRaceCache(now: number): void {
  for (const [code, r] of raceCache) if (r.endsAt + CACHE_GRACE_MS < now) raceCache.delete(code);
}

export interface MoveInput {
  from: string;
  to: string;
  promotion?: string;
  /** Which puzzle and which step of it the client believes it is on. Never
   *  trusted: the write below only applies if the database agrees. */
  index: number;
  moveIdx: number;
}

export async function submitMove(userId: string, code: string, input: MoveInput): Promise<MoveResult> {
  const race = await getCachedRace(code);
  if (!race) return { ok: false, status: 'not_active' };

  const now = Date.now();
  if (now < race.startsAt) return { ok: false, status: 'not_started' };
  if (now > race.endsAt + END_GRACE_MS) {
    void finishRaceByTime(race.id);
    return { ok: false, status: 'not_active' };
  }

  const { index, moveIdx } = input;
  const pz = race.puzzles[index];
  // The solver's moves sit at odd positions of the line.
  if (!pz || !Number.isInteger(moveIdx) || moveIdx < 1 || moveIdx >= pz.moves.length || moveIdx % 2 === 0) {
    return { ok: false, status: 'stale' };
  }

  const verdict = evaluateMove(pz, moveIdx, input);
  if (verdict.kind === 'illegal') return { ok: false, status: 'illegal' };

  // One conditional write does the whole job. It only applies if the player
  // really is at (index, moveIdx) and is not locked out, so a duplicate,
  // late or made-up claim matches nothing. That also means nothing about a
  // move's correctness is revealed unless the claim was true.
  const filter = {
    _id: race.id,
    status: 'active',
    players: {
      $elemMatch: {
        user: new mongoose.Types.ObjectId(userId),
        solved: index,
        moveIdx,
        $or: [{ penaltyUntil: null }, { penaltyUntil: { $lte: new Date(now) } }],
      },
    },
  };

  if (verdict.kind === 'wrong') {
    const res = await PuzzleRace.updateOne(filter, {
      $set: { 'players.$.penaltyUntil': new Date(now + PUZZLE_RACE_MISTAKE_LOCK_MS) },
      $inc: { 'players.$.mistakes': 1 },
    });
    if (!res.matchedCount) return explainRejectedMove(race.id, userId, now);
    return { ok: false, status: 'wrong', lockMs: PUZZLE_RACE_MISTAKE_LOCK_MS };
  }

  if (!verdict.puzzleDone) {
    const res = await PuzzleRace.updateOne(filter, { $set: { 'players.$.moveIdx': moveIdx + 2 } });
    if (!res.matchedCount) return explainRejectedMove(race.id, userId, now);
    return { ok: true, status: 'correct', reply: verdict.reply, nextMoveIdx: moveIdx + 2 };
  }

  trackDaily(userId, { type: 'puzzle_solved', key: `solve:${race.id}:${index}`, puzzleRating: pz.rating });

  const solved = index + 1;
  const finishedAll = solved >= race.puzzleCount;
  const res = await PuzzleRace.updateOne(filter, {
    $set: {
      'players.$.solved': solved,
      'players.$.moveIdx': 1,
      'players.$.lastSolvedAt': new Date(now),
      ...(finishedAll ? { 'players.$.finishedAt': new Date(now) } : {}),
    },
  });
  if (!res.matchedCount) return explainRejectedMove(race.id, userId, now);

  if (finishedAll) {
    const won = await finishRace(race.id, userId, 'completed');
    return { ok: true, status: 'finished', won };
  }

  void broadcastRaceState(race.id);
  return {
    ok: true,
    status: 'solved',
    next: {
      index: solved,
      total: race.puzzleCount,
      moveIdx: 1,
      ...describePuzzle(race.puzzles[solved], 1),
    },
  };
}

/** Only runs when a move's write matched nothing (rare), to say why. */
async function explainRejectedMove(raceId: string, userId: string, now: number): Promise<MoveResult> {
  const race = await PuzzleRace.findById(raceId).select('status players').lean();
  if (!race || race.status !== 'active') return { ok: false, status: 'not_active' };
  const player = race.players.find((p) => p.user.toString() === userId);
  if (!player) return { ok: false, status: 'not_player' };
  if (player.penaltyUntil && player.penaltyUntil.getTime() > now) {
    return { ok: false, status: 'locked', lockMs: player.penaltyUntil.getTime() - now };
  }
  return { ok: false, status: 'stale' };
}

// --- Finishing -----------------------------------------------------------------
const endTimers = new Map<string, NodeJS.Timeout>();

/** Best-effort timer on this instance; sweepPuzzleRaces is the safety net for
 *  restarts and for races that live on another instance. */
function scheduleRaceEnd(raceId: string, endsAtMs: number): void {
  const existing = endTimers.get(raceId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    endTimers.delete(raceId);
    void finishRaceByTime(raceId).catch((err) => console.error('puzzle race time-limit finish failed:', err));
  }, Math.max(0, endsAtMs - Date.now()) + END_GRACE_MS);
  t.unref();
  endTimers.set(raceId, t);
}

/** Ends the race. `winnerId` null = nobody scored (everyone is refunded).
 *  Returns whether `winnerId` is the one recorded as the winner. */
async function finishRace(
  raceId: string,
  winnerId: string | null,
  reason: 'completed' | 'time_limit',
): Promise<boolean> {
  // First claim wins: if two players finish in the same instant, exactly one
  // of these succeeds.
  const finished = await PuzzleRace.findOneAndUpdate(
    { _id: raceId, status: 'active' },
    { $set: { status: 'finished', winner: winnerId, endReason: reason, finishedAt: new Date() } },
    { new: true },
  );
  if (!finished) {
    const current = await PuzzleRace.findById(raceId).select('winner').lean();
    return !!winnerId && current?.winner?.toString() === winnerId;
  }

  const timer = endTimers.get(raceId);
  if (timer) {
    clearTimeout(timer);
    endTimers.delete(raceId);
  }

  raceCache.delete(finished.code);

  // Daily challenges: everyone who raced gets their result.
  for (const p of finished.players) {
    trackDaily(p.user.toString(), {
      type: 'puzzle_race_finished',
      key: `race-end:${finished.id}`,
      won: !!winnerId && p.user.toString() === winnerId,
      completed: !!p.finishedAt,
      wagerTokens: finished.wagerTokens,
    });
  }

  // The player who just finished gets their answer now; paying out (several
  // wallet writes) and telling everyone happens right after, not before.
  void (async () => {
    try {
      await settleRace(finished.id);
    } catch (err) {
      // wagerSettled stays false, so the sweep retries (settlement is idempotent).
      console.error('puzzle race settlement failed:', err);
    } finally {
      broadcastRacesChanged();
      await broadcastRaceState(finished.id).catch(() => {});
    }
  })();
  return !!winnerId;
}

export async function finishRaceByTime(raceId: string): Promise<void> {
  const race = await PuzzleRace.findById(raceId).lean();
  if (!race || race.status !== 'active') return;

  // Most puzzles solved wins; on equal points the fewest misses wins, and
  // if that is level too, whoever got there first.
  const ranked = [...race.players]
    .filter((p) => p.solved > 0)
    .sort(
      (a, b) =>
        b.solved - a.solved ||
        (a.mistakes ?? 0) - (b.mistakes ?? 0) ||
        (a.lastSolvedAt?.getTime() ?? 0) - (b.lastSolvedAt?.getTime() ?? 0),
    );
  await finishRace(raceId, ranked[0] ? ranked[0].user.toString() : null, 'time_limit');
}

// --- Settlement ------------------------------------------------------------------
/** Pays the winner (pot minus rake) or, with no winner / a cancelled race,
 *  returns every stake. Safe to call repeatedly: every credit is idempotent. */
export async function settleRace(raceId: string): Promise<void> {
  const race = await PuzzleRace.findById(raceId).lean();
  if (!race || (race.status !== 'finished' && race.status !== 'cancelled')) return;
  if (race.wagerSettled) return;

  if (race.wagerTokens <= 0) {
    await PuzzleRace.updateOne({ _id: raceId }, { $set: { wagerSettled: true } });
    return;
  }

  // Everyone who is still seated in the race has a stake in it.
  const stakers = race.players.map((p) => p.user.toString());
  const pot = race.wagerTokens * stakers.length;

  if (race.status === 'finished' && race.winner) {
    const { rakeTokens, netTokens } = computeRake(pot);
    const winnerId = race.winner.toString();
    await creditPuzzleRaceReturn(winnerId, raceId, netTokens, 'puzzle_race_payout');
    await recordRake('puzzle_race', raceId, rakeTokens, pot);
    await PuzzleRace.updateOne(
      { _id: raceId },
      { $set: { wagerSettled: true, potTokens: pot, rakeTokens, payoutTokens: netTokens } },
    );
    return;
  }

  for (const userId of stakers) {
    await creditPuzzleRaceReturn(userId, raceId, race.wagerTokens, 'puzzle_race_refund');
  }
  await PuzzleRace.updateOne({ _id: raceId }, { $set: { wagerSettled: true, potTokens: pot } });
}

// --- Sweep -----------------------------------------------------------------------
export async function sweepPuzzleRaces(): Promise<void> {
  const now = Date.now();
  pruneRaceCache(now);

  const staleWaiting = await PuzzleRace.find({
    status: 'waiting',
    createdAt: { $lt: new Date(now - PUZZLE_RACE_WAITING_TTL_MS) },
  })
    .select('_id')
    .lean();
  for (const r of staleWaiting) await closeWaitingRace(r._id.toString());

  const overdue = await PuzzleRace.find({ status: 'active', endsAt: { $lt: new Date(now - END_GRACE_MS) } })
    .select('_id')
    .lean();
  for (const r of overdue) await finishRaceByTime(r._id.toString());

  // A crash between "race ended" and "stakes paid" leaves wagerSettled false;
  // settling again is idempotent.
  const unsettled = await PuzzleRace.find({
    status: { $in: ['finished', 'cancelled'] },
    wagerSettled: false,
    finishedAt: { $lt: new Date(now - 30_000) },
  })
    .select('_id')
    .lean();
  for (const r of unsettled) await settleRace(r._id.toString());
}
