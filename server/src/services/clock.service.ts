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
 *  after game start and after every successful move. Safe to call redundantly. */
export async function scheduleGameTimer(gameId: string): Promise<void> {
  clearGameTimer(gameId);

  const state = await getLiveState(gameId);
  if (!state || state.status !== 'active' || state.timeControl.baseMs === null) return;

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
  }, remaining + 1500);

  timers.set(gameId, timer);
}
