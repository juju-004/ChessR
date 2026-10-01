import { redis } from "../config/redis.js";
import { withLock } from "../utils/distributedLock.js";
import { getIo } from "../sockets/io.js";
import { User } from "../models/User.js";
import {
  createDirectGame,
  assertUnderActiveGameLimit,
} from "./game.service.js";
import { assertNotRestricted } from "./suspension.service.js";
import { ApiError } from "../utils/ApiError.js";

export interface QuickPairingSegment {
  id: string;
  /** e.g. "1+0" */
  label: string;
  /** e.g. "Bullet" */
  categoryLabel: string;
  baseMinutes: number;
  incrementSeconds: number;
  variant: "standard" | "chess960";
}

// The four lobbies David asked for. Order here is display order everywhere
// (config response, dashboard tile's destination page, etc), so reorder
// this array to reorder the segment tiles client-side.
export const QUICK_PAIRING_SEGMENTS: QuickPairingSegment[] = [
  {
    id: "bullet_1_0",
    label: "1+0",
    categoryLabel: "Bullet",
    baseMinutes: 1,
    incrementSeconds: 0,
    variant: "standard",
  },
  {
    id: "blitz_3_0",
    label: "3+0",
    categoryLabel: "Blitz",
    baseMinutes: 3,
    incrementSeconds: 0,
    variant: "standard",
  },
  {
    id: "blitz_5_0",
    label: "5+0",
    categoryLabel: "Blitz",
    baseMinutes: 5,
    incrementSeconds: 0,
    variant: "standard",
  },
  {
    id: "chess960_2_0",
    label: "2+0",
    categoryLabel: "Chess960",
    baseMinutes: 2,
    incrementSeconds: 0,
    variant: "chess960",
  },
];

function getSegment(segmentId: string): QuickPairingSegment {
  const segment = QUICK_PAIRING_SEGMENTS.find((s) => s.id === segmentId);
  if (!segment) throw ApiError.badRequest("Unknown quick-pairing lobby");
  return segment;
}

// Redis layout, all ephemeral (no persistence needed, this is a live
// queue, not history):
//  - qp:queue:{segmentId}   ZSET  member=userId          score=rating
//  - qp:queued_at:{segmentId} HASH userId -> joinedAt ms (for the
//    wait-based rating-window widening below, and for ordering who gets
//    first crack at a match each pass)
//  - qp:user_segment:{userId} STRING segmentId, short TTL refreshed on
//    join, a safety net so a user can never look queued in two lobbies at
//    once and so a missed leave (crash, dropped disconnect event) can't
//    strand a phantom queue entry forever.
const queueKey = (segmentId: string) => `qp:queue:${segmentId}`;
const queuedAtKey = (segmentId: string) => `qp:queued_at:${segmentId}`;
const userSegmentKey = (userId: string) => `qp:user_segment:${userId}`;
const lockKey = (segmentId: string) => `qp:lock:${segmentId}`;

const USER_SEGMENT_TTL_SECONDS = 30;

// Rating-window widening, same spirit as Lichess's real-time seek: start
// narrow so a good match happens fast when the pool is deep, then widen
// the longer someone's waited so a thin pool still pairs eventually
// rather than never finding anyone "close enough". Past MAX_WAIT_MS the
// window is dropped entirely, whoever's been waiting that long gets
// paired with the closest available rating no matter the gap.
const BASE_RATING_WINDOW = 150;
const WIDEN_PER_SECOND = 12;
const MAX_WAIT_MS = 60_000;

/** Removes a user from whichever lobby they're currently queued in, if
 *  any (there's only ever one, joining a new one always leaves the old
 *  one first). Safe to call for a user who isn't queued anywhere. */
export async function leaveQuickPairingQueue(userId: string): Promise<string | null> {
  const segmentId = await redis.get(userSegmentKey(userId));
  if (!segmentId) return null;
  await Promise.all([
    redis.zrem(queueKey(segmentId), userId),
    redis.hdel(queuedAtKey(segmentId), userId),
    redis.del(userSegmentKey(userId)),
  ]);
  return segmentId;
}

/** Joins `segmentId`'s queue. Runs the same eligibility checks a direct
 *  challenge accept does (restriction, one-active-game cap) up front so a
 *  clearly-ineligible player never sits in a lobby waiting for a match
 *  that would fail anyway; both are re-checked again right before a match
 *  is actually finalized, since either can change while queued. */
export async function joinQuickPairingQueue(
  userId: string,
  segmentId: string,
): Promise<QuickPairingSegment> {
  const segment = getSegment(segmentId);
  await assertNotRestricted(userId);
  await assertUnderActiveGameLimit(userId);

  const user = await User.findById(userId).select("rating").lean();
  if (!user) throw ApiError.notFound("User not found");

  await leaveQuickPairingQueue(userId);

  const now = Date.now();
  await Promise.all([
    redis.zadd(queueKey(segmentId), user.rating, userId),
    redis.hset(queuedAtKey(segmentId), userId, String(now)),
    redis.set(userSegmentKey(userId), segmentId, "EX", USER_SEGMENT_TTL_SECONDS),
  ]);
  activeSegments.set(segmentId, Date.now());

  return segment;
}

/** Segments that might have someone waiting, mapped to when they were last
 *  marked active. The 2-second background pass used to hit Redis for all 4
 *  lobbies on every tick even with nobody queued (roughly 17 commands per
 *  tick, ~700k a day on an idle server), which alone blows through a
 *  500k/month Redis plan. Now the interval only touches segments in here:
 *  a join adds its segment, and a pass that finds the queue empty removes
 *  it, so an idle server makes zero quick-pairing Redis calls.
 *  Per-process on purpose: a player queued via another instance is that
 *  instance's to keep matching, and every pass reads the shared Redis
 *  queue, so matching across instances still works. */
const activeSegments = new Map<string, number>();

/** Marks every segment active once. Called at boot so a queue that outlived
 *  a restart still gets swept: the first pass finds each empty one and
 *  drops it again. */
export function activateAllQuickPairingSegments(): void {
  const now = Date.now();
  for (const s of QUICK_PAIRING_SEGMENTS) activeSegments.set(s.id, now);
}

/** Live "how many people are waiting" count per lobby, for the segment
 *  tiles on the quick-pairing page. */
export async function getQuickPairingLobbyCounts(): Promise<Record<string, number>> {
  const counts = await Promise.all(
    QUICK_PAIRING_SEGMENTS.map((s) => redis.zcard(queueKey(s.id))),
  );
  return Object.fromEntries(
    QUICK_PAIRING_SEGMENTS.map((s, i) => [s.id, counts[i]]),
  );
}

/** One matching pass over a single segment's queue: pairs off as many
 *  players as it can this tick. Locked per-segment (withLock) so only one
 *  server instance runs a pass for a given segment at a time, same
 *  reasoning as tryArenaPairings' lock for tournaments. Oldest-waiting
 *  player gets first pick of their nearest-rating opponent within their
 *  current (wait-widened) window; whatever's left over waits for the
 *  next pass or a fresh joiner. */
export async function runQuickPairingPass(segmentId: string): Promise<void> {
  await withLock(lockKey(segmentId), async () => {
    const passStart = Date.now();
    const raw = await redis.zrange(queueKey(segmentId), 0, -1, "WITHSCORES");
    if (raw.length === 0) {
      // Nobody waiting: stop polling this lobby until the next join. The
      // timestamp check keeps a join that landed while this pass was
      // running (marked active after passStart) from being un-marked.
      if ((activeSegments.get(segmentId) ?? 0) <= passStart) {
        activeSegments.delete(segmentId);
      }
      return;
    }

    const queuedAt = await redis.hgetall(queuedAtKey(segmentId));
    const now = Date.now();

    const all: { userId: string; rating: number; waitedMs: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      const userId = raw[i];
      all.push({
        userId,
        rating: Number(raw[i + 1]),
        waitedMs: now - (Number(queuedAt[userId]) || now),
      });
    }

    // Keep every waiting player's pointer key alive (it's a short-TTL
    // safety net, see USER_SEGMENT_TTL_SECONDS) and drop anyone whose
    // pointer has already expired: that only happens if their leave
    // event was missed (crash, lost disconnect), i.e. a phantom entry
    // nobody is actually waiting behind.
    const refreshed = await Promise.all(
      all.map((e) => redis.expire(userSegmentKey(e.userId), USER_SEGMENT_TTL_SECONDS)),
    );
    const entries = all.filter((_, i) => refreshed[i] === 1);
    const stale = all.filter((_, i) => refreshed[i] !== 1).map((e) => e.userId);
    if (stale.length > 0) {
      await Promise.all([
        redis.zrem(queueKey(segmentId), ...stale),
        redis.hdel(queuedAtKey(segmentId), ...stale),
      ]);
    }
    if (entries.length < 2) return;
    // Oldest-waiting first, so nobody's stuck behind a newer arrival
    // repeatedly winning the "closest rating" tie-break.
    entries.sort((a, b) => b.waitedMs - a.waitedMs);

    const matched = new Set<string>();
    for (const entry of entries) {
      if (matched.has(entry.userId)) continue;

      const window =
        entry.waitedMs >= MAX_WAIT_MS
          ? Infinity
          : BASE_RATING_WINDOW + (entry.waitedMs / 1000) * WIDEN_PER_SECOND;

      let best: { userId: string; diff: number } | null = null;
      for (const candidate of entries) {
        if (candidate.userId === entry.userId || matched.has(candidate.userId))
          continue;
        const diff = Math.abs(candidate.rating - entry.rating);
        if (diff > window) continue;
        if (!best || diff < best.diff) best = { userId: candidate.userId, diff };
      }
      if (!best) continue;

      matched.add(entry.userId);
      matched.add(best.userId);
      await finalizeMatch(segmentId, entry.userId, best.userId);
    }
  });
}

async function finalizeMatch(
  segmentId: string,
  userIdA: string,
  userIdB: string,
): Promise<void> {
  const segment = getSegment(segmentId);
  const io = getIo();

  // Pull both out of the queue structures before anything else, a failed
  // eligibility re-check below still shouldn't leave either of them
  // occupying a queue slot under a stale rating/wait time.
  await Promise.all([
    redis.zrem(queueKey(segmentId), userIdA, userIdB),
    redis.hdel(queuedAtKey(segmentId), userIdA, userIdB),
    redis.del(userSegmentKey(userIdA)),
    redis.del(userSegmentKey(userIdB)),
  ]);

  // Authoritative re-check, same reasoning as challengeSocket.ts's
  // accept-time re-check: either side could have picked up a play
  // restriction or started another game (a different tab, a direct
  // challenge) in the time since they joined this queue.
  const [aOk, bOk] = await Promise.all([
    checkEligible(userIdA),
    checkEligible(userIdB),
  ]);

  if (!aOk || !bOk) {
    // Whichever side is still eligible gets silently dropped back into
    // the queue at "just now" (a fresh wait clock, simplest correct
    // behavior) rather than losing their place to a problem on the other
    // side; the ineligible side is told why and left out.
    if (aOk) {
      await joinQuickPairingQueue(userIdA, segmentId).catch(() => {});
    } else {
      io.to(`user:${userIdA}`).emit("quickPairing:error", {
        message: "You're not eligible to start a new game right now.",
      });
    }
    if (bOk) {
      await joinQuickPairingQueue(userIdB, segmentId).catch(() => {});
    } else {
      io.to(`user:${userIdB}`).emit("quickPairing:error", {
        message: "You're not eligible to start a new game right now.",
      });
    }
    return;
  }

  const [whiteId, blackId] =
    Math.random() < 0.5 ? [userIdA, userIdB] : [userIdB, userIdA];

  let game;
  try {
    game = await createDirectGame(
      whiteId,
      blackId,
      { baseMinutes: segment.baseMinutes, incrementSeconds: segment.incrementSeconds },
      undefined,
      segment.variant,
    );
  } catch (err) {
    console.error("quick pairing createDirectGame failed:", err);
    io.to(`user:${userIdA}`).emit("quickPairing:error", {
      message: "Couldn't start the game, you've been put back in the queue.",
    });
    io.to(`user:${userIdB}`).emit("quickPairing:error", {
      message: "Couldn't start the game, you've been put back in the queue.",
    });
    await joinQuickPairingQueue(userIdA, segmentId).catch(() => {});
    await joinQuickPairingQueue(userIdB, segmentId).catch(() => {});
    return;
  }

  const payload = { gameId: game.id, joinCode: game.joinCode, segmentId };
  io.to(`user:${userIdA}`).emit("quickPairing:matched", payload);
  io.to(`user:${userIdB}`).emit("quickPairing:matched", payload);
}

async function checkEligible(userId: string): Promise<boolean> {
  try {
    await assertNotRestricted(userId);
    await assertUnderActiveGameLimit(userId);
    return true;
  } catch {
    return false;
  }
}

/** Runs one pass over every segment. Cheap to call often (4 lock
 *  acquisitions + a handful of small Redis reads), which is the point —
 *  called on a short interval from index.ts so someone waiting in a thin
 *  lobby still eventually gets wider-window matched even with nobody new
 *  joining, and also called immediately after a join for the common-case
 *  instant match. */
export async function runAllQuickPairingPasses(): Promise<boolean> {
  const ids = [...activeSegments.keys()];
  if (ids.length === 0) return false;
  await Promise.all(
    ids.map((id) =>
      runQuickPairingPass(id).catch((err) =>
        console.error(`quick pairing pass failed for ${id}:`, err),
      ),
    ),
  );
  return true;
}
