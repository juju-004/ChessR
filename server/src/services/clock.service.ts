import { getLiveState, computeTimeoutWinner, getSideToMove } from './gameState.service.js';

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
