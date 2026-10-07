import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';
import { redis } from '../config/redis.js';
import { Game, type IMove } from '../models/Game.js';
import { ApiError } from '../utils/ApiError.js';
import {
  getStartingFiles,
  detectCastlingAttempt,
  attemptCastle,
  updateCastlingRights,
  initialCastlingRights,
  type CastlingRightsState,
} from './chess960Castling.js';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LIVE_STATE_TTL_SECONDS = 60 * 60 * 6; // 6h safety net; refreshed on every move

// Every this-many moves, the move list and current position are copied from
// Redis into the Game document (about 4 writes for a 40-move game instead of
// 40). If Redis is lost mid-game, at most this many moves are lost, and the
// recovery sweep closes the game with the snapshotted position and moves
// rather than the starting ones.
const SNAPSHOT_EVERY_MOVES = 10;

const stateKey = (gameId: string) => `game:${gameId}:state`;
// The move list of a game in progress. It lives ONLY here until the game ends,
// then finalizeGame (game.service.ts) writes it to Mongo in one go.
const movesKey = (gameId: string) => `game:${gameId}:moves`;

/** One played move, same shape as the entries of Game.moves in Mongo. */
export type LiveMove = IMove;

export interface LiveTimeControl {
  baseMs: number | null; // null = unlimited
  incrementMs: number;
}

export interface LiveGameState {
  gameId: string;
  whiteId: string;
  blackId: string;
  variant: 'standard' | 'chess960';
  initialFen: string;
  fen: string;
  status: 'active' | 'finished';
  result: 'white' | 'black' | 'draw' | null;
  endReason: string | null;
  moveCount: number;
  // Per-player R token stake, carried in live state so end-of-game settlement
  // doesn't need a separate Mongo round trip to know what's riding on it.
  wagerTokens: number;
  timeControl: LiveTimeControl;
  whiteRemainingMs: number | null;
  blackRemainingMs: number | null;
  turnStartedAtMs: number;
  // True only for the brief, mutually-agreed pause window at the very start
  // of a cage match leg (before both sides have moved), see pauseLiveClock/
  // resumeLiveClock. Both clocks and moves are frozen while true.
  paused: boolean;
  // Tournament berserk flags, true once that side has berserked. Purely
  // informational for the client (the halved-time effect already happened to
  // whiteRemainingMs/blackRemainingMs below); onTournamentGameFinished reads
  // the Game document's own berserk field, not this, when scoring bonuses.
  whiteBerserk: boolean;
  blackBerserk: boolean;
  castlingRights: CastlingRightsState;
  /** Repetition-relevant position keys (piece placement + turn + castling
   *  rights + en-passant target, the four FEN fields FIDE rules actually
   *  compare for "same position"), one per position reached including the
   *  start. Needed because chess.js's own threefold-repetition tracker relies
   *  on move history accumulated through a persistent instance, since we
   *  reload a fresh Chess instance from FEN on every move (deliberately, to
   *  keep move application stateless/idempotent), it never has any history to
   *  check against and would never detect a repetition on its own. */
  positionHistory: string[];
}

/** The four FEN fields that define "the same position" for repetition
 *  purposes, explicitly excludes halfmove clock and fullmove number. */
function repetitionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export class GameTimeoutError extends Error {
  constructor(public readonly winner: 'white' | 'black') {
    super('Time forfeit');
  }
}

export function getSideToMove(fen: string): 'white' | 'black' {
  return new Chess(fen).turn() === 'w' ? 'white' : 'black';
}

/** Pure clock check, does not mutate anything. Returns the winning side if time has run out.
 *  Also returns null during the "idle" phase (before both sides have made
 *  their first move), the real clock doesn't start counting down until
 *  then, same as Lichess. See finalizeMove for where time stops being free. */
export function computeTimeoutWinner(state: LiveGameState): 'white' | 'black' | null {
  if (state.status !== 'active' || state.paused || state.timeControl.baseMs === null || state.moveCount < 2) {
    return null;
  }

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
  variant: 'standard' | 'chess960' = 'standard',
  wagerTokens: number = 0,
): Promise<LiveGameState> {
  const state: LiveGameState = {
    gameId,
    whiteId,
    blackId,
    variant,
    initialFen: fen,
    fen,
    status: 'active',
    result: null,
    endReason: null,
    moveCount: 0,
    wagerTokens,
    timeControl,
    whiteRemainingMs: timeControl.baseMs,
    blackRemainingMs: timeControl.baseMs,
    turnStartedAtMs: Date.now(),
    paused: false,
    whiteBerserk: false,
    blackBerserk: false,
    castlingRights: initialCastlingRights(),
    positionHistory: [repetitionKey(fen)],
  };
  // `del` first so no stale move list from an earlier use of this id can leak in.
  await redis.del(movesKey(gameId));
  await redis.set(stateKey(gameId), JSON.stringify(state), 'EX', LIVE_STATE_TTL_SECONDS);
  return state;
}

// Hash of the exact stored string each state object was parsed from. A move
// writes its result back only if the stored string still hashes to this, see
// writeStateIfUnchanged. (WeakMap: entries vanish with the state objects.)
const stateHashes = new WeakMap<object, string>();

export async function getLiveState(gameId: string): Promise<LiveGameState | null> {
  const raw = await redis.get(stateKey(gameId));
  if (!raw) return null;
  const state = JSON.parse(raw) as LiveGameState;
  stateHashes.set(state, createHash('sha1').update(raw).digest('hex'));
  return state;
}

/** Copies the live move list and position into the Game document. Best effort:
 *  a failure only means a bigger gap to lose if Redis dies, so it is logged and
 *  never fails (or delays) the move that triggered it. */
async function snapshotGameToMongo(gameId: string, moveCount: number): Promise<void> {
  try {
    const moves = await getLiveMoves(gameId);
    // Only snapshot a complete list (a game that was already under way when
    // per-move Mongo writes were removed won't have one).
    if (moves.length === 0 || moves[0].moveNumber !== 1) return;
    const last = moves[moves.length - 1];
    await Game.updateOne(
      {
        _id: gameId,
        // A game that has ended is finalizeGame's to write, and an older
        // snapshot must never overwrite a newer one.
        status: 'active',
        [`moves.${moves.length - 1}`]: { $exists: false },
      },
      { $set: { moves, fen: last.fenAfter } },
    );
  } catch (err) {
    console.error(`snapshotGameToMongo failed for game ${gameId} at move ${moveCount}:`, err);
  }
}

/** Thrown when the game's stored state changed between reading it and
 *  writing the result of a move (a resignation, flag-fall, draw or pause
 *  landed in that gap). applyMove re-reads and re-validates. */
export class LiveStateConflictError extends Error {
  constructor() {
    super('Game state changed while applying the move');
  }
}

// applyMove used to read the state, compute the move, then plain-SET the
// result, so anything that wrote the state in between (a resignation, a
// flag-fall on another instance) was silently overwritten and the game came
// back to life. This writes only if the stored value is still the one the
// move was computed from; Redis runs the script atomically.
const WRITE_IF_UNCHANGED_LUA = `
local cur = redis.call('GET', KEYS[1])
if not cur or redis.sha1hex(cur) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
redis.call('RPUSH', KEYS[2], ARGV[4])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
return 1`;

async function writeStateIfUnchanged(
  gameId: string,
  previous: LiveGameState,
  next: LiveGameState,
  move: LiveMove,
): Promise<void> {
  const expected = stateHashes.get(previous);
  if (!expected) {
    // Not read through getLiveState (shouldn't happen): fall back to the old
    // unconditional write rather than failing the move.
    await redis
      .multi()
      .set(stateKey(gameId), JSON.stringify(next), 'EX', LIVE_STATE_TTL_SECONDS)
      .rpush(movesKey(gameId), JSON.stringify(move))
      .expire(movesKey(gameId), LIVE_STATE_TTL_SECONDS)
      .exec();
    return;
  }
  // The new state and the move are stored by the same atomic script, so the
  // move list can never be a move ahead of or behind the position, and a
  // move that loses the race (conflict) is not recorded at all.
  const ok = await redis.eval(
    WRITE_IF_UNCHANGED_LUA,
    2,
    stateKey(gameId),
    movesKey(gameId),
    expected,
    JSON.stringify(next),
    String(LIVE_STATE_TTL_SECONDS),
    JSON.stringify(move),
  );
  if (ok !== 1) throw new LiveStateConflictError();
}

/** Atomic "I am the one ending this game" claim. Clock timers live in each
 *  server process's memory, and with several instances more than one can
 *  fire for the same game (the periodic sweep re-arms timers wherever it
 *  runs). Without a claim, each firing ends the game again: duplicate
 *  game:over / settled broadcasts, repeated rating and tournament
 *  advancement work. Exactly one caller gets `true`. */
export async function claimGameEnd(gameId: string): Promise<boolean> {
  const ok = await redis.set(`game:${gameId}:ending`, '1', 'EX', 60 * 60, 'NX');
  return ok === 'OK';
}

/** Gives the claim back when ending failed before the game actually ended,
 *  so a retry (or another path) isn't locked out. */
export async function releaseGameEndClaim(gameId: string): Promise<void> {
  await redis.del(`game:${gameId}:ending`).catch(() => undefined);
}

export async function deleteLiveState(gameId: string): Promise<void> {
  await redis.del(stateKey(gameId));
}

/** Every move played so far in a game that is (or just was) live. */
export async function getLiveMoves(gameId: string): Promise<LiveMove[]> {
  const raw = await redis.lrange(movesKey(gameId), 0, -1);
  const moves: LiveMove[] = [];
  for (const entry of raw) {
    try {
      moves.push(JSON.parse(entry) as LiveMove);
    } catch {
      // A corrupt entry is skipped rather than failing the whole read.
    }
  }
  return moves;
}

/** Called by finalizeGame once the moves are safely in Mongo. */
export async function deleteLiveMoves(gameId: string): Promise<void> {
  await redis.del(movesKey(gameId));
}

/** Mongo's list plus the live one. Normally Mongo has none of a live game's
 *  moves and this is just the live list; the filter only matters for a game
 *  that was already part-way through when per-move Mongo writes were removed. */
export function mergeLiveMoves(mongoMoves: ReadonlyArray<LiveMove>, liveMoves: LiveMove[]): LiveMove[] {
  if (liveMoves.length === 0) return [...mongoMoves];
  const first = liveMoves[0].moveNumber;
  return [...mongoMoves.filter((m) => m.moveNumber < first), ...liveMoves];
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
  /** The exact turnStartedAtMs persisted in the live state for the NEW
   *  side to move. The socket layer must broadcast THIS value rather than
   *  calling Date.now() again after the Redis write, otherwise clients
   *  count down from a later instant than the server's own flag check
   *  does, handing the side to move a free Redis-latency's worth of time
   *  on every single move. */
  turnStartedAtMs: number;
}

/** Shared tail-end for both the normal-move and castling paths: clock
 *  accounting, game-over detection, persistence, and result construction. */
async function finalizeMove(
  gameId: string,
  state: LiveGameState,
  chess: Chess,
  moverSide: 'white' | 'black',
  san: string,
  from: string,
  to: string,
  promotion: string | undefined,
  updatedRights: CastlingRightsState,
  lagCompensationMs = 0,
  moveTimestampMs: number = Date.now(),
): Promise<MoveResult> {
  let whiteRemainingMs = state.whiteRemainingMs;
  let blackRemainingMs = state.blackRemainingMs;
  // The clock is "free" for each side's very first move, nothing is charged
  // until BOTH sides have made their first move (same as Lichess). This move
  // being applied is White's 1st when state.moveCount is 0, or Black's 1st
  // when it's 1; only from state.moveCount >= 2 onward does real time get
  // deducted. turnStartedAtMs still resets below regardless, so the instant
  // this idle window closes (Black's first move lands), both clocks start
  // counting down completely fresh with full time on them.
  const clockIsLive = state.moveCount >= 2;
  if (clockIsLive && state.timeControl.baseMs !== null) {
    // Lag compensation: the raw elapsed time includes the network round
    // trip needed for this move to reach the server at all, which for a
    // premove (fired the instant the position updates) IS almost entirely
    // that round trip rather than any real thinking time. `lagCompensationMs`
    // is a small, server-measured, capped estimate of that unavoidable
    // network cost (see latency.service.ts) subtracted before charging the
    // clock, same idea Lichess calls lag compensation.
    const elapsed = Math.max(0, Date.now() - state.turnStartedAtMs - lagCompensationMs);
    if (moverSide === 'white') {
      const increment = state.whiteBerserk ? 0 : state.timeControl.incrementMs;
      whiteRemainingMs = Math.max(0, (whiteRemainingMs ?? 0) - elapsed) + increment;
    } else {
      const increment = state.blackBerserk ? 0 : state.timeControl.incrementMs;
      blackRemainingMs = Math.max(0, (blackRemainingMs ?? 0) - elapsed) + increment;
    }
  }

  const newFen = chess.fen();
  const newKey = repetitionKey(newFen);
  const newPositionHistory = [...state.positionHistory, newKey];
  const isThreefoldRepetition = newPositionHistory.filter((k) => k === newKey).length >= 3;

  let result: MoveResult['result'] = null;
  let endReason: string | null = null;
  // chess.js's own isGameOver() internally checks threefold repetition too,
  // but via the same broken (history-less) mechanism, so it can say "false"
  // even when our reliable check says otherwise. OR them together.
  const isGameOver = chess.isGameOver() || isThreefoldRepetition;

  if (isGameOver) {
    if (chess.isCheckmate()) {
      result = moverSide;
      endReason = 'checkmate';
    } else if (chess.isStalemate()) {
      result = 'draw';
      endReason = 'stalemate';
    } else if (isThreefoldRepetition) {
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
    fen: newFen,
    status: isGameOver ? 'finished' : 'active',
    result,
    endReason,
    moveCount: state.moveCount + 1,
    whiteRemainingMs,
    blackRemainingMs,
    turnStartedAtMs: Date.now(),
    castlingRights: updatedRights,
    positionHistory: newPositionHistory,
  };
  const liveMove: LiveMove = {
    san,
    from,
    to,
    ...(promotion ? { promotion } : {}),
    fenAfter: newFen,
    moveNumber: newState.moveCount,
    timestampMs: moveTimestampMs,
  };
  await writeStateIfUnchanged(gameId, state, newState, liveMove);
  // Not awaited: the move must not wait on Mongo. A game-ending move is
  // skipped, finalizeGame is about to write the full list anyway.
  if (!isGameOver && newState.moveCount % SNAPSHOT_EVERY_MOVES === 0) {
    void snapshotGameToMongo(gameId, newState.moveCount);
  }

  return {
    san,
    from,
    to,
    promotion,
    fenAfter: newFen,
    isGameOver,
    result,
    endReason,
    moveNumber: newState.moveCount,
    whiteRemainingMs,
    blackRemainingMs,
    turnStartedAtMs: newState.turnStartedAtMs,
  };
}

/**
 * Applies a move server-side. This is the single source of truth for legality, 
 * the client's board (chessground) is purely a renderer; it must never be trusted.
 * Also the single source of truth for the clock: elapsed time is charged against
 * the mover's remaining time before the move is even validated.
 */
export async function applyMove(
  gameId: string,
  userId: string,
  move: { from: string; to: string; promotion?: string },
  lagCompensationMs = 0,
  moveTimestampMs: number = Date.now(),
): Promise<MoveResult> {
  // A conflict means something else wrote this game's state mid-move. Retry
  // from the fresh state: the checks at the top of applyMoveOnce then decide
  // properly (game over -> "already ended", paused -> "paused", flag fallen
  // -> timeout) or the move simply goes through on the new state.
  for (let attempt = 0; ; attempt++) {
    try {
      return await applyMoveOnce(gameId, userId, move, lagCompensationMs, moveTimestampMs);
    } catch (err) {
      if (err instanceof LiveStateConflictError && attempt < 2) continue;
      if (err instanceof LiveStateConflictError) {
        throw ApiError.conflict('The game changed while your move was being applied. Try again.');
      }
      throw err;
    }
  }
}

async function applyMoveOnce(
  gameId: string,
  userId: string,
  move: { from: string; to: string; promotion?: string },
  lagCompensationMs = 0,
  moveTimestampMs: number = Date.now(),
): Promise<MoveResult> {
  const state = await getLiveState(gameId);
  if (!state) throw ApiError.notFound('Game is not active');
  if (state.status !== 'active') throw ApiError.conflict('Game has already ended');
  if (state.paused) throw ApiError.conflict('Game is paused. Resume it first');

  const isWhite = state.whiteId === userId;
  const isBlack = state.blackId === userId;
  if (!isWhite && !isBlack) throw ApiError.forbidden('You are not a player in this game');

  const sideToMove = getSideToMove(state.fen);
  const playerSide = isWhite ? 'white' : 'black';
  if (sideToMove !== playerSide) throw ApiError.forbidden('Not your turn');

  const timeoutWinner = computeTimeoutWinner(state);
  if (timeoutWinner) throw new GameTimeoutError(timeoutWinner);

  const chess = new Chess(state.fen);
  const rights = state.castlingRights ?? initialCastlingRights();

  // Chess960 castling: chess.js has no native support for this, so it's
  // detected and handled entirely by our own logic before ever reaching
  // chess.js's normal move validation.
  if (state.variant === 'chess960') {
    const files = getStartingFiles(state.initialFen);
    const castleSide = detectCastlingAttempt(chess, move.from, move.to, playerSide, files);
    if (castleSide) {
      const castle = attemptCastle(chess, playerSide, castleSide, files, rights);
      if (!castle.success) throw ApiError.badRequest(castle.reason ?? 'Illegal move');

      const freshChess = new Chess(castle.resultFen!);
      const updatedRights = updateCastlingRights(
        updateCastlingRights(rights, playerSide, 'k', castle.kingFrom!, files),
        playerSide,
        'r',
        castle.rookFrom!,
        files,
      );

      return finalizeMove(
        gameId,
        state,
        freshChess,
        playerSide,
        castleSide === 'kingside' ? 'O-O' : 'O-O-O',
        castle.kingFrom!,
        castle.kingTo!,
        undefined,
        updatedRights,
        lagCompensationMs,
        moveTimestampMs,
      );
    }
  }

  let moveResult;
  try {
    moveResult = chess.move({ from: move.from, to: move.to, promotion: move.promotion });
  } catch {
    throw ApiError.badRequest('Illegal move');
  }
  if (!moveResult) throw ApiError.badRequest('Illegal move');

  let updatedRights = rights;
  if (state.variant === 'chess960') {
    const files = getStartingFiles(state.initialFen);
    updatedRights = updateCastlingRights(rights, playerSide, moveResult.piece, moveResult.from, files);
  }

  return finalizeMove(
    gameId,
    state,
    chess,
    playerSide,
    moveResult.san,
    moveResult.from,
    moveResult.to,
    moveResult.promotion,
    updatedRights,
    lagCompensationMs,
    moveTimestampMs,
  );
}

/** Ends a game early (resignation, timeout, abandonment) without a chess.js move. */
export async function endGame(
  gameId: string,
  result: 'white' | 'black' | 'draw',
  endReason: string,
): Promise<LiveGameState> {
  const state = await getLiveState(gameId);
  if (!state) throw ApiError.notFound('Game is not active');

  // Bank the real elapsed time on whoever's clock was actually running,
  // same as pauseLiveClock does, without this, whiteRemainingMs/
  // blackRemainingMs are left at whatever they were as of the *previous*
  // move (e.g. still showing 3s left on a timeout), and since the client
  // only ever ticks those down live while the game is active, the instant
  // status flips to 'finished' the displayed clock snaps back up to that
  // stale pre-timeout number instead of resting at 0.
  let whiteRemainingMs = state.whiteRemainingMs;
  let blackRemainingMs = state.blackRemainingMs;
  if (state.status === 'active' && !state.paused && state.timeControl.baseMs !== null && state.moveCount >= 2) {
    const elapsed = Date.now() - state.turnStartedAtMs;
    const sideToMove = getSideToMove(state.fen);
    if (sideToMove === 'white') whiteRemainingMs = Math.max(0, (whiteRemainingMs ?? 0) - elapsed);
    else blackRemainingMs = Math.max(0, (blackRemainingMs ?? 0) - elapsed);
  }

  const newState: LiveGameState = {
    ...state,
    status: 'finished',
    result,
    endReason,
    whiteRemainingMs,
    blackRemainingMs,
  };
  await redis.set(stateKey(gameId), JSON.stringify(newState), 'EX', 300);
  return newState;
}

/** Freezes the clock, banks whatever time has elapsed on the current side's
 *  clock so it isn't lost, then marks the game paused (which also blocks
 *  applyMove). Meaningful any time before BOTH sides have made their first
 *  move (moveCount < 2), see cageMatch.service.ts's pause request flow,
 *  which is the only caller. During that window the real clock isn't even
 *  running yet (see computeTimeoutWinner/finalizeMove), so there's nothing
 *  to bank; time is only actually deducted once moveCount >= 2. */
export async function pauseLiveClock(gameId: string): Promise<LiveGameState | null> {
  const state = await getLiveState(gameId);
  if (!state || state.status !== 'active' || state.paused) return state;

  let whiteRemainingMs = state.whiteRemainingMs;
  let blackRemainingMs = state.blackRemainingMs;
  if (state.timeControl.baseMs !== null && state.moveCount >= 2) {
    const elapsed = Date.now() - state.turnStartedAtMs;
    const sideToMove = getSideToMove(state.fen);
    if (sideToMove === 'white') whiteRemainingMs = Math.max(0, (whiteRemainingMs ?? 0) - elapsed);
    else blackRemainingMs = Math.max(0, (blackRemainingMs ?? 0) - elapsed);
  }

  const newState: LiveGameState = {
    ...state,
    whiteRemainingMs,
    blackRemainingMs,
    turnStartedAtMs: Date.now(),
    paused: true,
  };
  await redis.set(stateKey(gameId), JSON.stringify(newState), 'EX', LIVE_STATE_TTL_SECONDS);
  return newState;
}

/** Un-freezes the clock, restarts the current side's clock counting down
 *  from whatever was banked at pause time (none of the paused duration
 *  counts against them). Caller is responsible for rescheduling the flag-fall
 *  timer and any grace timer afterward. */
export async function resumeLiveClock(gameId: string): Promise<LiveGameState | null> {
  const state = await getLiveState(gameId);
  if (!state || state.status !== 'active' || !state.paused) return state;

  const newState: LiveGameState = { ...state, turnStartedAtMs: Date.now(), paused: false };
  await redis.set(stateKey(gameId), JSON.stringify(newState), 'EX', LIVE_STATE_TTL_SECONDS);
  return newState;
}

export class BerserkNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Lichess-style berserk: halves the berserking side's own remaining base
 *  time in exchange for a shot at a bonus point if they go on to win (the
 *  bonus itself is awarded by tournament.service.ts when the game concludes,
 *  based on the Game document's `berserk` field, this function just applies
 *  the clock cut and flips that field).
 *
 *  Only ever allowed before that side has made their own first move, once
 *  you've moved, the decision window is closed. Untimed games (baseMs ===
 *  null) can't berserk since there's no clock to cut. */
export async function applyBerserk(
  gameId: string,
  userId: string,
): Promise<{ state: LiveGameState; side: 'white' | 'black' }> {
  const state = await getLiveState(gameId);
  if (!state) throw ApiError.notFound('Game is not active');
  if (state.status !== 'active') throw new BerserkNotAllowedError('This game has already ended');
  if (state.timeControl.baseMs === null) {
    throw new BerserkNotAllowedError("There's no clock to berserk on an unlimited game");
  }

  const isWhite = state.whiteId === userId;
  const isBlack = state.blackId === userId;
  if (!isWhite && !isBlack) throw ApiError.forbidden('You are not a player in this game');
  const side: 'white' | 'black' = isWhite ? 'white' : 'black';

  if (side === 'white' && (state.whiteBerserk || state.moveCount > 0)) {
    throw new BerserkNotAllowedError('Too late to berserk. Make your move');
  }
  if (side === 'black' && (state.blackBerserk || state.moveCount > 1)) {
    throw new BerserkNotAllowedError('Too late to berserk. Make your move');
  }

  const newState: LiveGameState = {
    ...state,
    whiteBerserk: side === 'white' ? true : state.whiteBerserk,
    blackBerserk: side === 'black' ? true : state.blackBerserk,
    whiteRemainingMs:
      side === 'white' && state.whiteRemainingMs !== null
        ? Math.floor(state.whiteRemainingMs / 2)
        : state.whiteRemainingMs,
    blackRemainingMs:
      side === 'black' && state.blackRemainingMs !== null
        ? Math.floor(state.blackRemainingMs / 2)
        : state.blackRemainingMs,
  };
  await redis.set(stateKey(gameId), JSON.stringify(newState), 'EX', LIVE_STATE_TTL_SECONDS);
  return { state: newState, side };
}
