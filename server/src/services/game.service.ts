import { customAlphabet } from 'nanoid';
import { Game, type IGame } from '../models/Game.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { initLiveState, getLiveState, computeTimeoutWinner, deleteLiveState, type LiveTimeControl } from './gameState.service.js';
import { scheduleGameTimer } from './clock.service.js';
import { getIo } from '../sockets/io.js';
import { generateChess960Fen } from './chess960.service.js';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const generateCode = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 6);

async function uniqueJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const existing = await Game.exists({ joinCode: code });
    if (!existing) return code;
  }
  throw ApiError.internal('Could not generate a unique game code, please retry');
}

export interface TimeControlInput {
  baseMinutes: number | null;
  incrementSeconds: number;
}

function toLiveTimeControl(input: TimeControlInput): LiveTimeControl {
  return {
    baseMs: input.baseMinutes === null ? null : input.baseMinutes * 60_000,
    incrementMs: input.incrementSeconds * 1000,
  };
}

export async function createOpenGame(
  hostUserId: string,
  timeControl: TimeControlInput,
  variant: 'standard' | 'chess960' = 'standard',
  isPrivate = false,
): Promise<IGame> {
  const joinCode = await uniqueJoinCode();
  const startingFen = variant === 'chess960' ? generateChess960Fen() : STARTING_FEN;
  const game = await Game.create({
    joinCode,
    variant,
    white: hostUserId,
    black: null,
    status: 'waiting',
    fen: startingFen,
    initialFen: startingFen,
    isPrivate,
    timeControl: {
      baseSeconds: timeControl.baseMinutes === null ? null : timeControl.baseMinutes * 60,
      incrementSeconds: timeControl.incrementSeconds,
    },
  });
  return game;
}

/** Joins an open game and starts it immediately. Also notifies anyone already
 *  sitting in the game's socket room (i.e. the creator, waiting) that the game
 *  is live now — without this, the creator's board stays stuck in "waiting"
 *  view-only mode until they manually reload. */
export async function joinOpenGame(gameId: string, joiningUserId: string): Promise<IGame> {
  const game = await Game.findById(gameId);
  if (!game) throw ApiError.notFound('Game not found');
  if (game.status !== 'waiting') throw ApiError.conflict('Game is not open to join');
  if (game.white.toString() === joiningUserId) {
    throw ApiError.badRequest("You can't join your own game");
  }

  game.black = joiningUserId as any;
  game.status = 'active';
  game.startedAt = new Date();
  await game.save();

  const liveTc = toLiveTimeControl({
    baseMinutes: game.timeControl.baseSeconds === null ? null : game.timeControl.baseSeconds / 60,
    incrementSeconds: game.timeControl.incrementSeconds,
  });
  await initLiveState(
    game.id,
    game.white.toString(),
    game.black.toString(),
    liveTc,
    game.initialFen,
    game.variant,
  );
  await scheduleGameTimer(game.id);

  try {
    getIo().to(`game:${game.id}`).emit('game:state_changed');
  } catch {
    // Socket.IO not initialized (e.g. in a script/test context) — safe to ignore.
  }

  return game;
}

export async function createDirectGame(
  whiteId: string,
  blackId: string,
  timeControl: TimeControlInput,
  challengeId?: string,
  variant: 'standard' | 'chess960' = 'standard',
): Promise<IGame> {
  const joinCode = await uniqueJoinCode();
  const startingFen = variant === 'chess960' ? generateChess960Fen() : STARTING_FEN;
  const game = await Game.create({
    joinCode,
    variant,
    white: whiteId,
    black: blackId,
    status: 'active',
    fen: startingFen,
    initialFen: startingFen,
    isPrivate: true,
    startedAt: new Date(),
    challengeId,
    timeControl: {
      baseSeconds: timeControl.baseMinutes === null ? null : timeControl.baseMinutes * 60,
      incrementSeconds: timeControl.incrementSeconds,
    },
  });

  const liveTc = toLiveTimeControl(timeControl);
  await initLiveState(game.id, whiteId, blackId, liveTc, game.initialFen, game.variant);
  await scheduleGameTimer(game.id);

  return game;
}

export async function listFriendsActiveGames(userId: string) {
  const user = await User.findById(userId).select('friends').lean();
  const friendIds = user?.friends ?? [];
  if (friendIds.length === 0) return [];

  return Game.find({
    status: 'active',
    $or: [{ white: { $in: friendIds } }, { black: { $in: friendIds } }],
  })
    .sort({ startedAt: -1 })
    .limit(50)
    .populate('white', 'username rating')
    .populate('black', 'username rating')
    .lean();
}

export async function listOpenGames(excludeUserId?: string) {
  return Game.find({
    status: 'waiting',
    isPrivate: false,
    ...(excludeUserId ? { white: { $ne: excludeUserId } } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('white', 'username rating')
    .lean();
}

export async function getGameByCode(code: string) {
  const game = await Game.findOne({ joinCode: code.toUpperCase() })
    .populate('white', 'username rating')
    .populate('black', 'username rating')
    .lean();
  if (!game) throw ApiError.notFound('No game found with that code');
  return game;
}

export async function appendMove(
  gameId: string,
  move: {
    san: string;
    from: string;
    to: string;
    promotion?: string;
    fenAfter: string;
    moveNumber: number;
  },
): Promise<void> {
  await Game.updateOne(
    { _id: gameId },
    { $push: { moves: { ...move, timestampMs: Date.now() } }, $set: { fen: move.fenAfter } },
  );
}

export async function finalizeGame(
  gameId: string,
  fen: string,
  status: 'finished' | 'aborted',
  result: 'white' | 'black' | 'draw' | null,
  endReason: string | null,
): Promise<void> {
  await Game.updateOne(
    { _id: gameId },
    { $set: { fen, status, result, endReason, endedAt: new Date() } },
  );
}

/**
 * Sweeps every game marked 'active' in Mongo and makes sure it actually has a
 * live, correctly-scheduled timer behind it. This exists because the per-game
 * clock timer lives in process memory (see clock.service.ts) — a server
 * restart wipes every scheduled timeout silently, leaving the game stuck as
 * "active" forever with nothing left to ever resolve it. Call this once on
 * boot (to recover from the restart that just happened) and periodically
 * (as a general safety net against anything else that could leave a timer
 * un-scheduled).
 */
export async function reconcileActiveGames(): Promise<{ resumed: number; timedOut: number; aborted: number }> {
  const activeGames = await Game.find({ status: 'active' }).lean();
  let resumed = 0;
  let timedOut = 0;
  let aborted = 0;

  for (const g of activeGames) {
    const gameId = g._id.toString();
    const liveState = await getLiveState(gameId);

    if (!liveState) {
      // No live state to resume from (Redis TTL expired, or it was never
      // properly initialized) — there's nothing safe to do but close it out
      // rather than leave it stuck as "active" indefinitely.
      await finalizeGame(gameId, g.fen, 'aborted', null, 'abandoned');
      aborted++;
      continue;
    }

    const timeoutWinner = computeTimeoutWinner(liveState);
    if (timeoutWinner) {
      await finalizeGame(gameId, liveState.fen, 'finished', timeoutWinner, 'timeout');
      await deleteLiveState(gameId);
      timedOut++;
      continue;
    }

    await scheduleGameTimer(gameId);
    resumed++;
  }

  return { resumed, timedOut, aborted };
}
