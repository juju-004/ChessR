import type { Server } from 'socket.io';
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

/** Safety net for "some users still show online even though they're not"
 *  (David, Sept 2026: traced to Redis briefly being unreachable, likely a
 *  hosting-plan credit/quota limit hit). registerSocket/unregisterSocket
 *  normally keep presence:user:*:sockets in sync with real connections,
 *  but if Redis itself errors at the exact moment a socket disconnects,
 *  unregisterSocket's cleanup throws, is caught and logged in
 *  presenceSocket.ts's disconnect handler, and never retried — that
 *  socketId is then stuck in Redis forever, and isUserOnline reads that
 *  user as online indefinitely, with nothing that would otherwise ever
 *  revisit it. This scans every presence set, cross-checks against the
 *  real, currently-connected socket IDs, and prunes anything stale.
 *  io.fetchSockets() (not a local room lookup) is what makes this correct
 *  in a multi-node deployment: with the Redis adapter (see sockets/index.ts),
 *  it queries every node in the cluster, not just whichever one happens to
 *  run this sweep, same reasoning as watchTournament's own comment on the
 *  same distinction. Safe to run repeatedly/on a schedule — a socket
 *  that's genuinely still connected is simply left alone every time, so
 *  this doubles as the permanent fix (run periodically in index.ts) as
 *  well as the one-off cleanup for however many users are stuck right
 *  now. Deliberately scoped to online/offline presence only — the
 *  separate `:watching` keys (see socketWatchingKey) are a different
 *  feature (arena pairing pool) with their own two-sided cleanup and
 *  aren't touched here. */
export async function reconcilePresence(io: Server): Promise<{ prunedSockets: number }> {
  const liveSockets = await io.fetchSockets();
  const liveIds = new Set(liveSockets.map((s) => s.id));
  let prunedSockets = 0;

  const userSocketsStream = redis.scanStream({ match: 'presence:user:*:sockets', count: 100 });
  for await (const keys of userSocketsStream as AsyncIterable<string[]>) {
    for (const key of keys) {
      const socketIds = await redis.smembers(key);
      const stale = socketIds.filter((id) => !liveIds.has(id));
      if (stale.length === 0) continue;
      await redis.srem(key, ...stale);
      await Promise.all(stale.map((id) => redis.del(socketUserKey(id))));
      prunedSockets += stale.length;
    }
  }

  // The reverse mapping (socketId -> userId) can end up orphaned
  // independently of the above — e.g. if only one half of registerSocket's
  // Promise.all ever completed — so it's swept on its own terms rather
  // than assumed to always match.
  const socketKeysStream = redis.scanStream({ match: 'presence:socket:*', count: 100 });
  for await (const keys of socketKeysStream as AsyncIterable<string[]>) {
    for (const key of keys) {
      if (key.endsWith(':watching')) continue; // different feature, see above
      const socketId = key.slice('presence:socket:'.length);
      if (!liveIds.has(socketId)) await redis.del(key);
    }
  }

  return { prunedSockets };
}

const tournamentWatchersKey = (tournamentId: string) => `presence:tournament:${tournamentId}:watchers`;
const socketWatchingKey = (socketId: string) => `presence:socket:${socketId}:watching`;

/** Call when a socket's tournament detail page mounts (the client's
 *  `tournament:watch` handler). Deliberately Redis-backed rather than
 *  reusing the Socket.IO room the same event also joins them to
 *  (tournamentSocket.ts's tournamentRoom), this app runs Socket.IO with
 *  the Redis adapter (see sockets/index.ts), and that adapter only
 *  populates `io.sockets.adapter.rooms` with sockets connected to *this*
 *  process; a socket connected to a different instance in a multi-node
 *  deployment simply wouldn't show up in a local room lookup. Redis SETs,
 *  same as the rest of this file, are what's actually queryable
 *  cluster-wide. */
export async function watchTournament(tournamentId: string, socketId: string): Promise<void> {
  // A socket only ever watches one tournament page at a time, if it was
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

/** The other half of watchTournament, call on the client's explicit
 *  `tournament:unwatch` (page unmounted normally) AND on socket disconnect
 *  (tab closed / connection dropped, where the client never gets a chance
 *  to send that event). Looks up which tournament this socket was
 *  watching itself, so callers don't need to already know it. Returns the
 *  tournamentId it just unwatched from (or null if it wasn't watching
 *  anything), so callers can re-broadcast the updated watcher list to that
 *  tournament's room without needing to track it separately themselves. */
export async function unwatchTournament(socketId: string): Promise<string | null> {
  const tournamentId = await redis.get(socketWatchingKey(socketId));
  if (!tournamentId) return null;
  await Promise.all([
    redis.srem(tournamentWatchersKey(tournamentId), socketId),
    redis.del(socketWatchingKey(socketId)),
  ]);
  return tournamentId;
}

/** Every userId currently watching a tournament's detail page, deduped
 *  across however many sockets each of them has open on it (multiple
 *  tabs/devices). Used to drive the client's "Pairing pool" section, which
 *  should only ever show players who actually have the page open right
 *  now, not every non-busy/non-paused player in the tournament regardless
 *  of whether they're looking at it (see arenaPairingPool in
 *  TournamentDetail.tsx). */
export async function getWatchingUserIds(tournamentId: string): Promise<string[]> {
  const socketIds = await redis.smembers(tournamentWatchersKey(tournamentId));
  if (socketIds.length === 0) return [];
  const userIds = await redis.mget(...socketIds.map(socketUserKey));
  return [...new Set(userIds.filter((id): id is string => id !== null))];
}

/** True if any of this user's currently-connected sockets (they can have
 *  several, multiple tabs, phone + desktop) currently has the given
 *  tournament's detail page open. General online status (isUserOnline)
 *  answers "is this user connected at all", which isn't the same
 *  question, someone idling on Game.tsx or Settings with the app open in
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
