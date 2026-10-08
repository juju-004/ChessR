import type { Server } from 'socket.io';
import { redis } from '../config/redis.js';
import { pruneGamePresence } from './gamePresence.service.js';

const userSocketsKey = (userId: string) => `presence:user:${userId}:sockets`;
const socketUserKey = (socketId: string) => `presence:socket:${socketId}`;

/** Call when a socket authenticates. A user may have several sockets (tabs/devices).
 *  Returns true when this is the user's ONLY socket right now, i.e. they just
 *  came online (a second tab or device opening doesn't change that). */
export async function registerSocket(userId: string, socketId: string): Promise<boolean> {
  const [, , count] = await Promise.all([
    redis.sadd(userSocketsKey(userId), socketId),
    redis.set(socketUserKey(socketId), userId),
    // Pipelined behind the sadd on the same connection, so the count already
    // includes this socket.
    redis.scard(userSocketsKey(userId)),
  ]);
  return count === 1;
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

// --- "Online players" ranking ------------------------------------------------
//
// A sorted set of every currently-online user, scored by their rating, so the
// Players page's "Online players" card can read the top few with one
// ZREVRANGE instead of scanning every presence key (which is what answering
// "who's online" otherwise costs as the user base grows). Members are added
// when a user's FIRST socket connects and removed when their LAST one
// disconnects (see presenceSocket.ts), and the score is only a ranking hint:
// readers re-check real presence + the live rating (see getTopOnlineUserIds
// and listOnlinePlayers), and reconcilePresence below sweeps up anything a
// missed disconnect left behind.
const onlineRankedKey = 'presence:online:ranked';

export async function markOnlineRanked(userId: string, rating: number): Promise<void> {
  await redis.zadd(onlineRankedKey, rating, userId);
}

export async function unmarkOnlineRanked(userId: string): Promise<void> {
  await redis.zrem(onlineRankedKey, userId);
}

/** Refresh an already-online user's score after their rating changed. `XX`
 *  means "only if already a member", so a game finishing for someone who's
 *  offline never re-adds them as online. */
export async function updateOnlineRank(userId: string, rating: number): Promise<void> {
  await redis.zadd(onlineRankedKey, 'XX', rating, userId);
}

/** Highest-ranked users who are genuinely online right now, excluding
 *  `excludeUserId` (the viewer). Candidates are verified against real
 *  presence before being returned, and any that fail are dropped from the
 *  set on the spot, so a stale entry heals itself instead of hiding a real
 *  player behind a ghost. */
export async function getTopOnlineUserIds(excludeUserId: string, limit: number): Promise<string[]> {
  const result: string[] = [];
  const stale: string[] = [];
  const batchSize = limit * 3 + 1;
  // A handful of batches at most: stale entries are rare, this just bounds
  // the worst case.
  for (let offset = 0, round = 0; round < 4 && result.length < limit; offset += batchSize, round++) {
    const batch = await redis.zrevrange(onlineRankedKey, offset, offset + batchSize - 1);
    if (batch.length === 0) break;
    const candidates = batch.filter((id) => id !== excludeUserId);
    const online = await getOnlineUserIds(candidates);
    for (const id of candidates) {
      if (online.has(id)) {
        if (result.length < limit) result.push(id);
      } else {
        stale.push(id);
      }
    }
    if (batch.length < batchSize) break;
  }
  if (stale.length > 0) await redis.zrem(onlineRankedKey, ...stale);
  return result;
}

export async function getUserSocketIds(userId: string): Promise<string[]> {
  return redis.smembers(userSocketsKey(userId));
}

/** Which of `userIds` are online, in ONE pipelined round trip (one SCARD
 *  each, sent together) instead of a separate Redis call per user. */
export async function getOnlineUserIds(userIds: string[]): Promise<Set<string>> {
  const online = new Set<string>();
  if (userIds.length === 0) return online;
  const pipeline = redis.pipeline();
  for (const id of userIds) pipeline.scard(userSocketsKey(id));
  const results = await pipeline.exec();
  results?.forEach(([err, count], i) => {
    if (!err && (count as number) > 0) online.add(userIds[i]);
  });
  return online;
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

  // One pipelined SMEMBERS per SCAN batch instead of one round trip per key.
  const userSocketsStream = redis.scanStream({ match: 'presence:user:*:sockets', count: 200 });
  for await (const keys of userSocketsStream as AsyncIterable<string[]>) {
    if (keys.length === 0) continue;
    const reads = redis.pipeline();
    keys.forEach((key) => reads.smembers(key));
    const results = (await reads.exec()) ?? [];
    const cleanup = redis.pipeline();
    let queued = 0;
    keys.forEach((key, i) => {
      const [err, members] = results[i] ?? [null, []];
      if (err) return;
      const stale = (members as string[]).filter((id) => !liveIds.has(id));
      if (stale.length === 0) return;
      cleanup.srem(key, ...stale);
      stale.forEach((id) => cleanup.del(socketUserKey(id)));
      queued++;
      prunedSockets += stale.length;
    });
    if (queued > 0) await cleanup.exec();
  }

  // The ranked online set (see markOnlineRanked) has the same failure mode
  // as the socket sets above: a missed disconnect leaves a user in it. Drop
  // every member that no longer has a live socket.
  const rankedStream = redis.zscanStream(onlineRankedKey, { count: 200 });
  for await (const entries of rankedStream as AsyncIterable<string[]>) {
    // zscan yields [member, score, member, score, ...]
    const members = entries.filter((_, i) => i % 2 === 0);
    if (members.length === 0) continue;
    const online = await getOnlineUserIds(members);
    const gone = members.filter((id) => !online.has(id));
    if (gone.length > 0) await redis.zrem(onlineRankedKey, ...gone);
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

  // Spectating markers whose socket is gone (a missed disconnect cleanup).
  const spectatingSockets = await redis.smembers(spectatingSocketsKey);
  for (const id of spectatingSockets) {
    if (liveIds.has(id)) continue;
    await Promise.all([redis.srem(spectatingSocketsKey, id), redis.del(socketSpectatingKey(id))]);
  }

  // Game-page presence (see gamePresence.service.ts) is swept with the same
  // cluster-wide snapshot, so it costs no extra fetchSockets.
  await pruneGamePresence(liveIds).catch((err) => console.error('pruneGamePresence failed:', err));

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
export async function unwatchTournament(
  socketId: string,
  onlyTournamentId?: string,
): Promise<string | null> {
  const tournamentId = await redis.get(socketWatchingKey(socketId));
  if (!tournamentId) return null;
  // The explicit client `tournament:unwatch` passes the tournament it means.
  // If this socket has since moved on to watching a different one, that
  // late unwatch must not wipe the newer watch. (Disconnect passes nothing
  // and clears whatever the socket was watching.)
  if (onlyTournamentId && tournamentId !== onlyTournamentId) return null;
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

// --- Spectating -------------------------------------------------------------
//
// A player who isn't paused or mid-game and goes to watch someone else's game
// must stay in the arena pairing pool (they're still there to play, just
// killing time). This tracks which sockets are currently spectating a game so
// the pool can count them alongside people on the tournament page. One key per
// socket remembers WHICH game, so a late game:leave for game A can't wipe the
// fresh spectate of game B (same reasoning as unwatchTournament).
const spectatingSocketsKey = 'presence:spectating:sockets';
const socketSpectatingKey = (socketId: string) => `presence:spectating:socket:${socketId}`;

export async function markSpectating(socketId: string, gameId: string): Promise<void> {
  await Promise.all([
    redis.sadd(spectatingSocketsKey, socketId),
    redis.set(socketSpectatingKey(socketId), gameId),
  ]);
}

/** Returns true if this call actually cleared a spectate. With `onlyGameId`
 *  it only clears when the socket is still spectating that exact game. */
export async function clearSpectating(socketId: string, onlyGameId?: string): Promise<boolean> {
  const current = await redis.get(socketSpectatingKey(socketId));
  if (!current) return false;
  if (onlyGameId && current !== onlyGameId) return false;
  await Promise.all([
    redis.srem(spectatingSocketsKey, socketId),
    redis.del(socketSpectatingKey(socketId)),
  ]);
  return true;
}

async function getSpectatingUserIds(): Promise<string[]> {
  const socketIds = await redis.smembers(spectatingSocketsKey);
  if (socketIds.length === 0) return [];
  const userIds = await redis.mget(...socketIds.map(socketUserKey));
  return [...new Set(userIds.filter((id): id is string => id !== null))];
}

/** Everyone who is "here to play" for a tournament right now: on its detail
 *  page, or watching some game instead. This is the presence set both the
 *  arena pairing pool and the client's pool display are built from. */
export async function getArenaPresentUserIds(tournamentId: string): Promise<string[]> {
  const [watching, spectating] = await Promise.all([
    getWatchingUserIds(tournamentId),
    getSpectatingUserIds(),
  ]);
  return [...new Set([...watching, ...spectating])];
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
