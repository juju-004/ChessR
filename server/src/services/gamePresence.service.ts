import { randomUUID } from 'node:crypto';
import { redis } from '../config/redis.js';

/**
 * Who is connected to a game page right now, kept in Redis instead of being
 * asked of the cluster with io.in(room).fetchSockets().
 *
 * Why: fetchSockets() through the Redis adapter broadcasts a request to every
 * server instance and waits (5s default) for ALL of them to answer. Cost and
 * tail latency therefore grow with instance count, and one dead/hung instance
 * turns every game join into a multi-second wait. Here one game = one Redis
 * hash (socketId -> "userId|role|instanceId|joinedAtMs"), so a join is ONE pipelined
 * round trip no matter how many instances exist.
 *
 * Crash safety: a hard-killed instance can't clean up its own entries. Each
 * instance therefore stamps a heartbeat into `presence:instances` every
 * BEAT_MS, and readers ignore entries owned by an instance whose heartbeat is
 * older than INSTANCE_DEAD_AFTER_MS. Without that, a crashed instance's
 * players would look "still connected" and the opponent could never claim the
 * abandoned win. The hourly reconcilePresence sweep physically prunes them.
 */

export const INSTANCE_ID = randomUUID();

const INSTANCES_KEY = 'presence:instances';
const BEAT_MS = 15_000;
const INSTANCE_DEAD_AFTER_MS = 45_000;
// Safety net for hashes nothing ever cleans (every member gone empties and
// deletes the hash by itself, so this only matters after a crash).
const SNAPSHOT_GRACE_MS = 2 * 60_000;
const GAME_PRESENCE_TTL_SECONDS = 60 * 60 * 12;

const gameKey = (gameId: string) => `presence:game:${gameId}`;

export type GamePresenceRole = 'player' | 'spectator';

export interface GamePresence {
  /** Distinct users with at least one live socket on the game page. */
  connectedUserIds: Set<string>;
  /** Distinct users watching as spectators. */
  spectatorUserIds: Set<string>;
}

// --- Instance heartbeat -------------------------------------------------------

let beatTimer: ReturnType<typeof setInterval> | null = null;

function beat(): Promise<unknown> {
  return redis.hset(INSTANCES_KEY, INSTANCE_ID, String(Date.now())).catch((err) => {
    console.error('presence instance heartbeat failed:', err);
  });
}

/** Call once at server start. */
export function startInstancePresenceBeat(): void {
  if (beatTimer) return;
  void beat();
  beatTimer = setInterval(() => void beat(), BEAT_MS);
  beatTimer.unref();
}

/** Call on graceful shutdown so peers stop trusting this instance's entries at once. */
export async function stopInstancePresenceBeat(): Promise<void> {
  if (beatTimer) clearInterval(beatTimer);
  beatTimer = null;
  await redis.hdel(INSTANCES_KEY, INSTANCE_ID).catch(() => undefined);
}

// --- Snapshot parsing ---------------------------------------------------------

function buildSnapshot(
  members: Record<string, string> | null,
  beats: Record<string, string> | null,
): GamePresence {
  const connectedUserIds = new Set<string>();
  const spectatorUserIds = new Set<string>();
  const now = Date.now();
  for (const value of Object.values(members ?? {})) {
    const [userId, role, instanceId] = value.split('|');
    if (!userId) continue;
    // Entries from an instance that stopped beating are leftovers of a crash.
    // An instance with no beat record at all (hash lost / first beat not in
    // yet) is trusted rather than dropped.
    if (instanceId && beats && instanceId !== INSTANCE_ID) {
      const last = Number(beats[instanceId]);
      if (Number.isFinite(last) && now - last > INSTANCE_DEAD_AFTER_MS) continue;
    }
    connectedUserIds.add(userId);
    if (role === 'spectator') spectatorUserIds.add(userId);
  }
  return { connectedUserIds, spectatorUserIds };
}

type PipelineResult = [Error | null, unknown][] | null;

function pick<T>(results: PipelineResult, index: number): T | null {
  const entry = results?.[index];
  if (!entry || entry[0]) return null;
  return entry[1] as T;
}

// --- Public API -----------------------------------------------------------------

/** Registers a socket on a game and returns the fresh snapshot. One round trip. */
export async function joinGamePresence(
  gameId: string,
  socketId: string,
  userId: string,
  role: GamePresenceRole,
): Promise<GamePresence> {
  const key = gameKey(gameId);
  const results = await redis
    .pipeline()
    .hset(key, socketId, `${userId}|${role}|${INSTANCE_ID}|${Date.now()}`)
    .expire(key, GAME_PRESENCE_TTL_SECONDS)
    .hgetall(key)
    .hgetall(INSTANCES_KEY)
    .exec();
  return buildSnapshot(pick(results, 2), pick(results, 3));
}

/** Removes a socket from a game and returns the snapshot without it. One round trip. */
export async function leaveGamePresence(gameId: string, socketId: string): Promise<GamePresence> {
  const key = gameKey(gameId);
  const results = await redis.pipeline().hdel(key, socketId).hgetall(key).hgetall(INSTANCES_KEY).exec();
  return buildSnapshot(pick(results, 1), pick(results, 2));
}

/** Read-only snapshot. One round trip. */
export async function getGamePresence(gameId: string): Promise<GamePresence> {
  const results = await redis.pipeline().hgetall(gameKey(gameId)).hgetall(INSTANCES_KEY).exec();
  return buildSnapshot(pick(results, 0), pick(results, 1));
}

/** Used by the hourly reconcile: drops presence entries whose socket is gone or
 *  whose owning instance died. Returns how many entries were removed. */
export async function pruneGamePresence(liveSocketIds: Set<string>): Promise<number> {
  const beats = await redis.hgetall(INSTANCES_KEY);
  const now = Date.now();
  const deadInstances = new Set(
    Object.entries(beats)
      .filter(([id, ts]) => id !== INSTANCE_ID && now - Number(ts) > INSTANCE_DEAD_AFTER_MS)
      .map(([id]) => id),
  );

  let removed = 0;
  const stream = redis.scanStream({ match: 'presence:game:*', count: 200 });
  for await (const keys of stream as AsyncIterable<string[]>) {
    if (keys.length === 0) continue;
    const reads = redis.pipeline();
    keys.forEach((k) => reads.hgetall(k));
    const readResults = await reads.exec();

    const writes = redis.pipeline();
    let pending = 0;
    keys.forEach((key, i) => {
      const members = pick<Record<string, string>>(readResults, i) ?? {};
      const stale = Object.entries(members)
        .filter(([socketId, value]) => {
          const [, , instanceId, joinedAt] = value.split('|');
          if (instanceId !== undefined && deadInstances.has(instanceId)) return true;
          // The live-socket snapshot was taken a moment ago; a socket that
          // joined after it would look "gone". Only judge older entries.
          const settled = Number.isFinite(Number(joinedAt)) && now - Number(joinedAt) > SNAPSHOT_GRACE_MS;
          return settled && !liveSocketIds.has(socketId);
        })
        .map(([socketId]) => socketId);
      if (stale.length > 0) {
        writes.hdel(key, ...stale);
        pending++;
        removed += stale.length;
      }
    });
    if (pending > 0) await writes.exec();
  }

  // Forget instances that have been silent for a long time.
  const forgotten = Object.entries(beats)
    .filter(([id, ts]) => id !== INSTANCE_ID && now - Number(ts) > 10 * 60_000)
    .map(([id]) => id);
  if (forgotten.length > 0) await redis.hdel(INSTANCES_KEY, ...forgotten);

  return removed;
}
