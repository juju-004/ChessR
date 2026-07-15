import { Game, type IGame } from '../models/Game.js';
import { ApiError } from '../utils/ApiError.js';
import { initLiveState } from './gameState.service.js';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Creates an open game waiting for an opponent (the "create game" flow). */
export async function createOpenGame(hostUserId: string, isPrivate = false): Promise<IGame> {
  const game = await Game.create({
    white: hostUserId,
    black: null,
    status: 'waiting',
    fen: STARTING_FEN,
    isPrivate,
  });
  return game;
}

/** Joins an open game (the "join game" flow) and starts it immediately. */
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

  await initLiveState(game.id, game.white.toString(), game.black.toString(), game.fen);
  return game;
}

/** Directly creates + starts a game between two known players (used by accepted friend challenges). */
export async function createDirectGame(
  whiteId: string,
  blackId: string,
  challengeId?: string,
): Promise<IGame> {
  const game = await Game.create({
    white: whiteId,
    black: blackId,
    status: 'active',
    fen: STARTING_FEN,
    isPrivate: true,
    startedAt: new Date(),
    challengeId,
  });

  await initLiveState(game.id, whiteId, blackId, game.fen);
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

/** Appends a single move to the persistent game record. Called after each validated move. */
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

/** Persists the finished/aborted result from the Redis live state back into MongoDB. */
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
