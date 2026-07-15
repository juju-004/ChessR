import { Chess } from 'chess.js';
import { redis } from '../config/redis.js';
import { ApiError } from '../utils/ApiError.js';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LIVE_STATE_TTL_SECONDS = 60 * 60 * 6; // 6h safety net; refreshed on every move

const stateKey = (gameId: string) => `game:${gameId}:state`;

export interface LiveTimeControl {
  baseMs: number | null; // null = unlimited
  incrementMs: number;
}

export interface LiveGameState {
  gameId: string;
  whiteId: string;
  blackId: string;
  fen: string;
  status: 'active' | 'finished';
  result: 'white' | 'black' | 'draw' | null;
  endReason: string | null;
  moveCount: number;
  timeControl: LiveTimeControl;
  whiteRemainingMs: number | null;
  blackRemainingMs: number | null;
  turnStartedAtMs: number;
}

export class GameTimeoutError extends Error {
  constructor(public readonly winner: 'white' | 'black') {
    super('Time forfeit');
  }
}

export function getSideToMove(fen: string): 'white' | 'black' {
  return new Chess(fen).turn() === 'w' ? 'white' : 'black';
}

/** Pure clock check — does not mutate anything. Returns the winning side if time has run out. */
export function computeTimeoutWinner(state: LiveGameState): 'white' | 'black' | null {
  if (state.status !== 'active' || state.timeControl.baseMs === null) return null;

  const sideToMove = getSideToMove(state.fen);
  const elapsed = Date.now() - state.turnStartedAtMs;
  const remaining =
    (sideToMove === 'white' ? state.whiteRemainingMs! : state.blackRemainingMs!) - elapsed;

  if (remaining > 0) return null;
  return sideToMove === 'white' ? 'black' : 'white';
}

export async function initLiveState(
  gameId: string,
  whiteId: string,
  blackId: string,
  timeControl: LiveTimeControl,
  fen: string = STARTING_FEN,
): Promise<LiveGameState> {
  const state: LiveGameState = {
    gameId,
    whiteId,
    blackId,
    fen,
    status: 'active',
    result: null,
    endReason: null,
    moveCount: 0,
    timeControl,
    whiteRemainingMs: timeControl.baseMs,
    blackRemainingMs: timeControl.baseMs,
    turnStartedAtMs: Date.now(),
  };
  await redis.set(stateKey(gameId), JSON.stringify(state), 'EX', LIVE_STATE_TTL_SECONDS);
  return state;
}

export async function getLiveState(gameId: string): Promise<LiveGameState | null> {
  const raw = await redis.get(stateKey(gameId));
  return raw ? (JSON.parse(raw) as LiveGameState) : null;
}

export async function deleteLiveState(gameId: string): Promise<void> {
  await redis.del(stateKey(gameId));
}

export interface MoveResult {
  san: string;
  from: string;
  to: string;
  promotion?: string;
  fenAfter: string;
  isGameOver: boolean;
  result: 'white' | 'black' | 'draw' | null;
  endReason: string | null;
  moveNumber: number;
  whiteRemainingMs: number | null;
  blackRemainingMs: number | null;
}

/**
 * Applies a move server-side. This is the single source of truth for legality —
 * the client's board (chessground) is purely a renderer; it must never be trusted.
 * Also the single source of truth for the clock: elapsed time is charged against
 * the mover's remaining time before the move is even validated.
 */
export async function applyMove(
  gameId: string,
  userId: string,
  move: { from: string; to: string; promotion?: string },
): Promise<MoveResult> {
  const state = await getLiveState(gameId);
  if (!state) throw ApiError.notFound('Game is not active');
  if (state.status !== 'active') throw ApiError.conflict('Game has already ended');

  const isWhite = state.whiteId === userId;
  const isBlack = state.blackId === userId;
  if (!isWhite && !isBlack) throw ApiError.forbidden('You are not a player in this game');

  const sideToMove = getSideToMove(state.fen);
  const playerSide = isWhite ? 'white' : 'black';
  if (sideToMove !== playerSide) throw ApiError.forbidden('Not your turn');

  const timeoutWinner = computeTimeoutWinner(state);
  if (timeoutWinner) throw new GameTimeoutError(timeoutWinner);

  const chess = new Chess(state.fen);
  let moveResult;
  try {
    moveResult = chess.move({ from: move.from, to: move.to, promotion: move.promotion });
  } catch {
    throw ApiError.badRequest('Illegal move');
  }
  if (!moveResult) throw ApiError.badRequest('Illegal move');

  let whiteRemainingMs = state.whiteRemainingMs;
  let blackRemainingMs = state.blackRemainingMs;
  if (state.timeControl.baseMs !== null) {
    const elapsed = Date.now() - state.turnStartedAtMs;
    const increment = state.timeControl.incrementMs;
    if (sideToMove === 'white') {
      whiteRemainingMs = Math.max(0, (whiteRemainingMs ?? 0) - elapsed) + increment;
    } else {
      blackRemainingMs = Math.max(0, (blackRemainingMs ?? 0) - elapsed) + increment;
    }
  }

  let result: MoveResult['result'] = null;
  let endReason: string | null = null;
  const isGameOver = chess.isGameOver();

  if (isGameOver) {
    if (chess.isCheckmate()) {
      result = sideToMove;
      endReason = 'checkmate';
    } else if (chess.isStalemate()) {
      result = 'draw';
      endReason = 'stalemate';
    } else if (chess.isThreefoldRepetition()) {
      result = 'draw';
      endReason = 'threefold_repetition';
    } else if (chess.isInsufficientMaterial()) {
      result = 'draw';
      endReason = 'insufficient_material';
    } else if (chess.isDraw()) {
      result = 'draw';
      endReason = 'fifty_move_rule';
    }
  }

  const newState: LiveGameState = {
    ...state,
    fen: chess.fen(),
    status: isGameOver ? 'finished' : 'active',
    result,
    endReason,
    moveCount: state.moveCount + 1,
    whiteRemainingMs,
    blackRemainingMs,
    turnStartedAtMs: Date.now(),
  };
  await redis.set(stateKey(gameId), JSON.stringify(newState), 'EX', LIVE_STATE_TTL_SECONDS);

  return {
    san: moveResult.san,
    from: moveResult.from,
    to: moveResult.to,
    promotion: moveResult.promotion,
    fenAfter: chess.fen(),
    isGameOver,
    result,
    endReason,
    moveNumber: newState.moveCount,
    whiteRemainingMs,
    blackRemainingMs,
  };
}

/** Ends a game early (resignation, timeout, abandonment) without a chess.js move. */
export async function endGame(
  gameId: string,
  result: 'white' | 'black' | 'draw',
  endReason: string,
): Promise<LiveGameState> {
  const state = await getLiveState(gameId);
  if (!state) throw ApiError.notFound('Game is not active');

  const newState: LiveGameState = { ...state, status: 'finished', result, endReason };
  await redis.set(stateKey(gameId), JSON.stringify(newState), 'EX', 300);
  return newState;
}
