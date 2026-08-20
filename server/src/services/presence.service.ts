import { redis } from '../config/redis.js';

const userSocketsKey = (userId: string) => `presence:user:${userId}:sockets`;
const socketUserKey = (socketId: string) => `presence:socket:${socketId}`;

/** Call when a socket authenticates. A user may have several sockets (tabs/devices). */
export async function registerSocket(userId: string, socketId: string): Promise<void> {
  await Promise.all([
    redis.sadd(userSocketsKey(userId), socketId),
    redis.set(socketUserKey(socketId), userId),
  ]);
}

/** Call on socket disconnect. Returns true if that was the user's last active socket. */
export async function unregisterSocket(socketId: string): Promise<{ userId: string | null; wasLast: boolean }> {
  const userId = await redis.get(socketUserKey(socketId));
  if (!userId) return { userId: null, wasLast: false };

  await redis.del(socketUserKey(socketId));
  const remaining = await redis.srem(userSocketsKey(userId), socketId);
  const count = await redis.scard(userSocketsKey(userId));

  return { userId, wasLast: count === 0 && remaining >= 0 };
}

export async function isUserOnline(userId: string): Promise<boolean> {
  const count = await redis.scard(userSocketsKey(userId));
  return count > 0;
}

export async function getUserSocketIds(userId: string): Promise<string[]> {
  return redis.smembers(userSocketsKey(userId));
}

const tournamentWatchersKey = (tournamentId: string) => `presence:tournament:${tournamentId}:watchers`;
const socketWatchingKey = (socketId: string) => `presence:socket:${socketId}:watching`;

/** Call when a socket's tournament detail page mounts (the client's
 *  `tournament:watch` handler). Deliberately Redis-backed rather than
 *  reusing the Socket.IO room the same event also joins them to
 *  (tournamentSocket.ts's tournamentRoom) — this app runs Socket.IO with
 *  the Redis adapter (see sockets/index.ts), and that adapter only
 *  populates `io.sockets.adapter.rooms` with sockets connected to *this*
 *  process; a socket connected to a different instance in a multi-node
 *  deployment simply wouldn't show up in a local room lookup. Redis SETs,
 *  same as the rest of this file, are what's actually queryable
 *  cluster-wide. */
export async function watchTournament(tournamentId: string, socketId: string): Promise<void> {
  // A socket only ever watches one tournament page at a time — if it was
  // already marked as watching a different one (e.g. a client-side route
  // change from one tournament straight to another, without a full
  // unmount in between), clear that stale membership first so it doesn't
  // leak a phantom watcher on the tournament they just left.
  const prev = await redis.get(socketWatchingKey(socketId));
  if (prev && prev !== tournamentId) {
    await redis.srem(tournamentWatchersKey(prev), socketId);
  }
  await Promise.all([
    redis.sadd(tournamentWatchersKey(tournamentId), socketId),
    redis.set(socketWatchingKey(socketId), tournamentId),
  ]);
}

/** The other half of watchTournament — call on the client's explicit
 *  `tournament:unwatch` (page unmounted normally) AND on socket disconnect
 *  (tab closed / connection dropped, where the client never gets a chance
 *  to send that event). Looks up which tournament this socket was
 *  watching itself, so callers don't need to already know it. */
export async function unwatchTournament(socketId: string): Promise<void> {
  const tournamentId = await redis.get(socketWatchingKey(socketId));
  if (!tournamentId) return;
  await Promise.all([
    redis.srem(tournamentWatchersKey(tournamentId), socketId),
    redis.del(socketWatchingKey(socketId)),
  ]);
}

/** True if any of this user's currently-connected sockets (they can have
 *  several — multiple tabs, phone + desktop) currently has the given
 *  tournament's detail page open. General online status (isUserOnline)
 *  answers "is this user connected at all", which isn't the same
 *  question — someone idling on Game.tsx or Settings with the app open in
 *  the background is "online" but not watching this tournament, and
 *  shouldn't be eligible for arena/swiss pairing into it (see
 *  arenaAvailablePlayers / buildSwissRound in tournament.service.ts). */
export async function isUserWatchingTournament(
  userId: string,
  tournamentId: string,
): Promise<boolean> {
  const socketIds = await getUserSocketIds(userId);
  if (socketIds.length === 0) return false;
  const watchers = await redis.smembers(tournamentWatchersKey(tournamentId));
  if (watchers.length === 0) return false;
  const watcherSet = new Set(watchers);
  return socketIds.some((id) => watcherSet.has(id));
}
