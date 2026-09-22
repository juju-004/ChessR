import { getLiveState, computeTimeoutWinner, getSideToMove } from './gameState.service.js';
import { Game } from '../models/Game.js';

type TimeoutHandler = (gameId: string, winner: 'white' | 'black') => Promise<void>;

let timeoutHandler: TimeoutHandler | null = null;

/** Called once at server startup (see sockets/gameSocket.ts) to wire in the
 *  Mongo-finalize + broadcast logic without creating a circular import. */
export function setTimeoutHandler(fn: TimeoutHandler): void {
  timeoutHandler = fn;
}

const timers = new Map<string, NodeJS.Timeout>();

export function clearGameTimer(gameId: string): void {
  const t = timers.get(gameId);
  if (t) {
    clearTimeout(t);
    timers.delete(gameId);
  }
}

/** (Re)schedules the flag-fall check for whoever's turn it currently is. Call this
 *  after game start and after every successful move. Safe to call redundantly.
 *  No-ops entirely during the idle phase (before both sides have made their
 *  first move) since the real clock isn't running yet — see
 *  gameState.service.ts's computeTimeoutWinner/finalizeMove. */
// A last-second move sent right as the clock reads 0:00 still has to travel
// over the network before the server can apply it — this is the grace
// window between "the clock's raw duration has elapsed" and "actually check
// & declare the timeout", so that move isn't unfairly pre-empted by the
// flag-fall timer. It only needs to cover one leg of network transit plus
// Node's own setTimeout scheduling jitter, not a full round trip, so it can
// stay small — a large buffer here just reads as a delay before the loser
// gets declared.
const FLAG_FALL_GRACE_MS = 250;

export async function scheduleGameTimer(gameId: string): Promise<void> {
  clearGameTimer(gameId);

  const state = await getLiveState(gameId);
  if (
    !state ||
    state.status !== 'active' ||
    state.paused ||
    state.timeControl.baseMs === null ||
    state.moveCount < 2
  ) {
    return;
  }

  const alreadyExpired = computeTimeoutWinner(state);
  if (alreadyExpired) {
    await timeoutHandler?.(gameId, alreadyExpired);
    return;
  }

  const sideToMove = getSideToMove(state.fen);
  const remaining =
    (sideToMove === 'white' ? state.whiteRemainingMs : state.blackRemainingMs) ?? 0;

  const timer = setTimeout(async () => {
    timers.delete(gameId);
    const fresh = await getLiveState(gameId);
    if (!fresh) return;
    const winner = computeTimeoutWinner(fresh);
    if (winner && timeoutHandler) await timeoutHandler(gameId, winner);
  }, remaining + FLAG_FALL_GRACE_MS);

  timers.set(gameId, timer);
}

// --- First-move timer -----------------------------------------------------
//
// Separate from (and much shorter than) the real chess clock — this exists
// to catch a player not making their first move at all, so a game can't sit
// stuck forever waiting on someone who's walked away before the "real" clock
// even starts ticking (see gameState.service.ts — time is only actually
// deducted once moveCount >= 2). Covers BOTH sides' first move: armed for
// White the moment the game starts, then re-armed for Black the moment
// White's first move lands. Cleared for good the instant Black's first move
// lands. What happens once it fires (abort a plain game vs. lose the game
// for a cage leg/tournament pairing) is decided by the handler registered
// via setFirstMoveTimeoutHandler, not here — this module only tracks time.
export type FirstMoveTimeoutHandler = (
  gameId: string,
  expiredSide: 'white' | 'black',
) => Promise<void>;

let firstMoveTimeoutHandler: FirstMoveTimeoutHandler | null = null;

export function setFirstMoveTimeoutHandler(fn: FirstMoveTimeoutHandler): void {
  firstMoveTimeoutHandler = fn;
}

const firstMoveTimers = new Map<string, NodeJS.Timeout>();

export function clearFirstMoveTimer(gameId: string): void {
  const t = firstMoveTimers.get(gameId);
  if (t) {
    clearTimeout(t);
    firstMoveTimers.delete(gameId);
  }
}

/** How long a player gets to make their first move — a flat window rather
 *  than scaled to time control (simpler to reason about, and generous even
 *  for bullet). Exported so the client can mirror the exact same window for
 *  its countdown badge without the server needing to push the deadline down
 *  the wire. A cage match leg or tournament pairing gets a slightly longer
 *  window than a plain game since a timeout there costs an actual game in a
 *  series, not just a low-stakes do-over. */
export function computeFirstMoveGraceMs(isSeriesGame: boolean): number {
  return isSeriesGame ? 30_000 : 25_000;
}

/** (Re)arms the first-move timer for whoever's first move is currently
 *  pending. Call this after game start and after every successful move —
 *  it's a cheap no-op once both sides have played their first move (or if
 *  the game isn't active/is paused). Safe to call redundantly. */
export async function scheduleFirstMoveTimer(gameId: string): Promise<void> {
  clearFirstMoveTimer(gameId);

  const state = await getLiveState(gameId);
  if (!state || state.status !== 'active' || state.paused || state.moveCount >= 2) {
    return;
  }

  const gameDoc = await Game.findById(gameId).select('cageMatchId tournamentId').lean();
  const isSeriesGame = !!(gameDoc?.cageMatchId || gameDoc?.tournamentId);
  const graceMs = computeFirstMoveGraceMs(isSeriesGame);
  const remaining = graceMs - (Date.now() - state.turnStartedAtMs);

  const fire = async () => {
    firstMoveTimers.delete(gameId);
    const fresh = await getLiveState(gameId);
    if (!fresh || fresh.status !== 'active' || fresh.paused || fresh.moveCount >= 2) return;
    const expiredSide = getSideToMove(fresh.fen);
    if (firstMoveTimeoutHandler) await firstMoveTimeoutHandler(gameId, expiredSide);
  };

  if (remaining <= 0) {
    await fire();
    return;
  }

  const timer = setTimeout(() => {
    fire().catch((err) => console.error('first-move timeout handling failed:', err));
  }, remaining);
  timer.unref?.();
  firstMoveTimers.set(gameId, timer);
}
