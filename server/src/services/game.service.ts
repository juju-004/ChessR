import { customAlphabet } from 'nanoid';
import { Game, type IGame } from '../models/Game.js';
import { ApiError } from '../utils/ApiError.js';
import { initLiveState, type LiveTimeControl } from './gameState.service.js';
import { scheduleGameTimer } from './clock.service.js';
import { getIo } from '../sockets/io.js';

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
  isPrivate = false,
): Promise<IGame> {
  const joinCode = await uniqueJoinCode();
  const game = await Game.create({
    joinCode,
    white: hostUserId,
    black: null,
    status: 'waiting',
    fen: STARTING_FEN,
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
  await initLiveState(game.id, game.white.toString(), game.black.toString(), liveTc, game.fen);
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
): Promise<IGame> {
  const joinCode = await uniqueJoinCode();
  const game = await Game.create({
    joinCode,
    white: whiteId,
    black: blackId,
    status: 'active',
    fen: STARTING_FEN,
    isPrivate: true,
    startedAt: new Date(),
    challengeId,
    timeControl: {
      baseSeconds: timeControl.baseMinutes === null ? null : timeControl.baseMinutes * 60,
      incrementSeconds: timeControl.incrementSeconds,
    },
  });

  const liveTc = toLiveTimeControl(timeControl);
  await initLiveState(game.id, whiteId, blackId, liveTc, game.fen);
  await scheduleGameTimer(game.id);

  return game;
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
