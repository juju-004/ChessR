// Tracks a rolling round-trip latency estimate per live socket connection,
// used to give a small, capped amount of "lag compensation" when charging a
// player's clock for a move, see finalizeMove in gameState.service.ts.
//
// Why this exists: every move (and especially a premove, which by nature
// fires the instant the position updates) has to make a real network round
// trip to the server before the server can charge the clock. That round-trip
// time gets counted as "thinking time" even though the player did no
// thinking at all, same issue lichess solved years ago with what they call
// lag compensation. This is the same idea, deliberately kept simple:
//   - The SERVER initiates the ping (not the client), so a client can't just
//     claim an inflated latency to buy itself free time.
//   - An exponential moving average smooths out single noisy samples, so a
//     player can't deliberately stall one pong reply right before a critical
//     move to spike their estimate.
//   - The amount ever subtracted from a move's elapsed time is hard-capped
//     (see LAG_COMPENSATION_CAP_MS) regardless of what the estimate says.
//
// This is intentionally in-process, in-memory state, not Redis, a
// Socket.IO connection only ever lives on one process at a time, so there's
// nothing to share across processes here.

import { getIo } from '../sockets/io.js';

const HEARTBEAT_INTERVAL_MS = 2000;
const EMA_ALPHA = 0.4; // weight given to each new sample
const DEFAULT_LATENCY_MS = 100; // reasonable round-trip assumption before the first pong lands
export const LAG_COMPENSATION_CAP_MS = 700;

const latencyBySocket = new Map<string, number>();
const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
// Which games are currently holding each socket's heartbeat open, and the
// reverse. The heartbeat is only worth its cost (a timer, a ping every 2s
// and a pong back, per socket) while the socket belongs to a player in a
// live game, since that's the only time lag compensation is ever read, see
// getLagCompensationMs. A socket sitting on the dashboard, a profile or a
// spectator view costs nothing.
const gamesBySocket = new Map<string, Set<string>>();
const socketsByGame = new Map<string, Set<string>>();

// Last line of defence against a leaked heartbeat. Normal teardown is
// event-driven (game over, leave, disconnect), but ending paths are many and
// can run on a DIFFERENT server instance than the one holding the socket, so
// every tick also re-validates itself using only local, free information:
// the socket must still be in the game's room and the retention must not be
// older than any real game could be.
const HEARTBEAT_MAX_LIFETIME_MS = 6 * 60 * 60 * 1000;

interface Retention {
  since: number;
  stillInGame?: () => boolean;
}
const retentions = new Map<string, Retention>();
const retentionKey = (socketId: string, gameId: string) => `${socketId}|${gameId}`;

function heartbeatTick(socketId: string, emitPing: () => void): void {
  const games = gamesBySocket.get(socketId);
  if (!games || games.size === 0) {
    stopLatencyHeartbeat(socketId);
    return;
  }
  const now = Date.now();
  for (const gameId of [...games]) {
    const retention = retentions.get(retentionKey(socketId, gameId));
    const expired = !retention || now - retention.since > HEARTBEAT_MAX_LIFETIME_MS;
    if (expired || (retention.stillInGame && !retention.stillInGame())) {
      releaseLatencyHeartbeat(socketId, gameId);
    }
  }
  // Releasing the last game clears the timer; only ping while one is still held.
  if (heartbeatTimers.has(socketId)) emitPing();
}

/** Start (or keep alive) this socket's heartbeat on behalf of one game.
 *  Idempotent per (socket, game): rejoining the same game, or being in two
 *  games at once, never double-registers a timer or wipes the smoothed
 *  estimate. The first ping goes out immediately so a sample is usually in
 *  before the player's first move. `stillInGame` is a purely local check
 *  (e.g. socket.rooms.has(...)) run on every tick so a heartbeat whose game
 *  ended elsewhere can never outlive the socket's membership of that game. */
export function retainLatencyHeartbeat(
  socketId: string,
  gameId: string,
  emitPing: () => void,
  stillInGame?: () => boolean,
): void {
  let games = gamesBySocket.get(socketId);
  if (!games) gamesBySocket.set(socketId, (games = new Set()));
  games.add(gameId);

  let sockets = socketsByGame.get(gameId);
  if (!sockets) socketsByGame.set(gameId, (sockets = new Set()));
  sockets.add(socketId);

  retentions.set(retentionKey(socketId, gameId), { since: Date.now(), stillInGame });

  if (heartbeatTimers.has(socketId)) return;
  emitPing();
  heartbeatTimers.set(
    socketId,
    setInterval(() => heartbeatTick(socketId, emitPing), HEARTBEAT_INTERVAL_MS),
  );
}

/** This socket no longer needs the heartbeat for `gameId` (left the page).
 *  The timer stops once no game is holding it. The smoothed estimate is
 *  kept so the player's next game starts from a warm value; it's dropped on
 *  disconnect (stopLatencyHeartbeat). */
export function releaseLatencyHeartbeat(socketId: string, gameId: string): void {
  retentions.delete(retentionKey(socketId, gameId));
  const sockets = socketsByGame.get(gameId);
  sockets?.delete(socketId);
  if (sockets && sockets.size === 0) socketsByGame.delete(gameId);

  const games = gamesBySocket.get(socketId);
  if (!games) return;
  games.delete(gameId);
  if (games.size > 0) return;
  gamesBySocket.delete(socketId);
  const timer = heartbeatTimers.get(socketId);
  if (timer) clearInterval(timer);
  heartbeatTimers.delete(socketId);
}

/** The game ended: stop pinging on its behalf for every socket on THIS
 *  process. Purely in-process (no Socket.IO / Redis call). Prefer
 *  notifyGameEnded, which also reaches the other server instances. */
export function releaseLatencyHeartbeatForGame(gameId: string): void {
  const sockets = socketsByGame.get(gameId);
  if (!sockets) return;
  for (const socketId of [...sockets]) releaseLatencyHeartbeat(socketId, gameId);
}

// A game usually reports its end from more than one place (the socket
// handler, then finalizeGame). Remember recent ones so the cross-instance
// publish below goes out once per game, not once per call site.
const recentlyAnnounced = new Map<string, number>();
const ANNOUNCE_DEDUPE_MS = 60_000;

/** THE way to say "this game is over". Releases the heartbeat for local
 *  sockets and tells every other server instance to do the same, since the
 *  game can end on instance B (clock timer, sweep, claim) while the players'
 *  sockets, and their heartbeat timers, live on instance A. Safe to call
 *  from any ending path, any number of times; costs one Redis publish per
 *  game. Receivers are wired in sockets/index.ts. */
export function notifyGameEnded(gameId: string): void {
  releaseLatencyHeartbeatForGame(gameId);

  const now = Date.now();
  if (recentlyAnnounced.size > 500) {
    for (const [id, at] of recentlyAnnounced) if (now - at > ANNOUNCE_DEDUPE_MS) recentlyAnnounced.delete(id);
  }
  const last = recentlyAnnounced.get(gameId);
  if (last !== undefined && now - last < ANNOUNCE_DEDUPE_MS) return;
  recentlyAnnounced.set(gameId, now);

  try {
    getIo().serverSideEmit(GAME_ENDED_EVENT, gameId);
  } catch {
    // Socket.IO not initialised (script/test context): nothing to tell.
  }
}

/** Event name used for the cross-instance announcement above. */
export const GAME_ENDED_EVENT = 'latency:game_ended';

/** Full teardown for a disconnecting socket, timer, game bookkeeping and
 *  the stored estimate. */
export function stopLatencyHeartbeat(socketId: string): void {
  const games = gamesBySocket.get(socketId);
  if (games) {
    for (const gameId of games) {
      retentions.delete(retentionKey(socketId, gameId));
      const sockets = socketsByGame.get(gameId);
      sockets?.delete(socketId);
      if (sockets && sockets.size === 0) socketsByGame.delete(gameId);
    }
    gamesBySocket.delete(socketId);
  }
  const timer = heartbeatTimers.get(socketId);
  if (timer) clearInterval(timer);
  heartbeatTimers.delete(socketId);
  latencyBySocket.delete(socketId);
}

/** Call when a `latency:pong` reply comes back, with the round-trip time
 *  (now - the timestamp originally sent in the ping). */
export function recordLatencySample(
  socketId: string,
  roundTripMs: number,
): void {
  // Guard against a clearly-bogus sample (clock skew, a tab that was
  // backgrounded and threw off timings, etc.) rather than letting it wreck
  // the average for the rest of the game.
  if (!Number.isFinite(roundTripMs) || roundTripMs < 0 || roundTripMs > 10_000)
    return;

  const prev = latencyBySocket.get(socketId) ?? roundTripMs;
  latencyBySocket.set(
    socketId,
    prev * (1 - EMA_ALPHA) + roundTripMs * EMA_ALPHA,
  );
}

/** The capped compensation to subtract from a move's charged elapsed time.
 *  Stored/returned as round-trip time, deliberately NOT halved to a one-way
 *  estimate, the elapsed time a premove gets charged is itself a full round
 *  trip (the opponent's move reaching this client, then this move reaching
 *  back to the server), so that's the right unit to cancel it out with. */
export function getLagCompensationMs(socketId: string): number {
  const estimate = latencyBySocket.get(socketId) ?? DEFAULT_LATENCY_MS;
  return Math.min(estimate, LAG_COMPENSATION_CAP_MS);
}
