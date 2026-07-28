// Tracks a rolling round-trip latency estimate per live socket connection,
// used to give a small, capped amount of "lag compensation" when charging a
// player's clock for a move — see finalizeMove in gameState.service.ts.
//
// Why this exists: every move (and especially a premove, which by nature
// fires the instant the position updates) has to make a real network round
// trip to the server before the server can charge the clock. That round-trip
// time gets counted as "thinking time" even though the player did no
// thinking at all — same issue lichess solved years ago with what they call
// lag compensation. This is the same idea, deliberately kept simple:
//   - The SERVER initiates the ping (not the client), so a client can't just
//     claim an inflated latency to buy itself free time.
//   - An exponential moving average smooths out single noisy samples, so a
//     player can't deliberately stall one pong reply right before a critical
//     move to spike their estimate.
//   - The amount ever subtracted from a move's elapsed time is hard-capped
//     (see LAG_COMPENSATION_CAP_MS) regardless of what the estimate says.
//
// This is intentionally in-process, in-memory state, not Redis — a
// Socket.IO connection only ever lives on one process at a time, so there's
// nothing to share across processes here.

const HEARTBEAT_INTERVAL_MS = 4000;
const EMA_ALPHA = 0.3; // weight given to each new sample
const DEFAULT_LATENCY_MS = 100; // reasonable round-trip assumption before the first pong lands
export const LAG_COMPENSATION_CAP_MS = 300;

const latencyBySocket = new Map<string, number>();
const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

export function startLatencyHeartbeat(emitPing: () => void, socketId: string): void {
  stopLatencyHeartbeat(socketId); // guard against double-registration
  emitPing(); // one immediately, rather than waiting a full interval for the first sample
  const timer = setInterval(emitPing, HEARTBEAT_INTERVAL_MS);
  heartbeatTimers.set(socketId, timer);
}

export function stopLatencyHeartbeat(socketId: string): void {
  const timer = heartbeatTimers.get(socketId);
  if (timer) clearInterval(timer);
  heartbeatTimers.delete(socketId);
  latencyBySocket.delete(socketId);
}

/** Call when a `latency:pong` reply comes back, with the round-trip time
 *  (now - the timestamp originally sent in the ping). */
export function recordLatencySample(socketId: string, roundTripMs: number): void {
  // Guard against a clearly-bogus sample (clock skew, a tab that was
  // backgrounded and threw off timings, etc.) rather than letting it wreck
  // the average for the rest of the game.
  if (!Number.isFinite(roundTripMs) || roundTripMs < 0 || roundTripMs > 10_000) return;

  const prev = latencyBySocket.get(socketId) ?? roundTripMs;
  latencyBySocket.set(socketId, prev * (1 - EMA_ALPHA) + roundTripMs * EMA_ALPHA);
}

/** The capped compensation to subtract from a move's charged elapsed time.
 *  Stored/returned as round-trip time, deliberately NOT halved to a one-way
 *  estimate — the elapsed time a premove gets charged is itself a full round
 *  trip (the opponent's move reaching this client, then this move reaching
 *  back to the server), so that's the right unit to cancel it out with. */
export function getLagCompensationMs(socketId: string): number {
  const estimate = latencyBySocket.get(socketId) ?? DEFAULT_LATENCY_MS;
  return Math.min(estimate, LAG_COMPENSATION_CAP_MS);
}
