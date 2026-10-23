import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { env } from '../config/env.js';
import {
  REDIS_URLS,
  REDIS_FINGERPRINTS,
  ROTATION_ENABLED,
  desiredIndex,
  redisLabel,
} from '../config/redisUrls.js';
import {
  activeRedisIndex,
  buildRedisClients,
  freezeRedis,
  getLiveRedis,
  isRedisFrozen,
  swapRedis,
  unfreezeRedis,
  type RedisTrio,
} from '../config/redis.js';
import { RedisRouting, ROUTING_DOC_ID, type IRedisRouting } from '../models/RedisRouting.js';
import { Game } from '../models/Game.js';
import { copyRedisData, type CopyResult } from '../utils/redisCopy.js';

/**
 * Daily rotation across REDIS_URLS, so no single Redis instance burns through
 * its monthly command quota.
 *
 * Which URL: a pure function of the calendar day (config/redisUrls.ts), so
 * with three URLs each one serves every third day. Which URL is *actually*
 * in use is recorded in Mongo (models/RedisRouting.ts), because every server
 * instance has to be on the same one.
 *
 * When the day changes the cluster is "due" for a switch, but it only happens
 * when no game is in progress:
 *
 *   1. Every instance polls the routing record every few seconds.
 *   2. An instance that sees a switch is due and finds NO game with
 *      status 'active' claims the switch (atomically; only one can). The claim
 *      is a lease that expires on its own if that instance dies.
 *   3. Every instance sees the claim and holds its Redis commands (they run on
 *      the new Redis afterwards, nothing is lost). The claimant waits long
 *      enough for that to take effect everywhere, then checks AGAIN that no
 *      game has started. If one has, it backs out and nothing changes.
 *   4. It copies everything from the current Redis to the next one.
 *   5. It flips the routing record. Instances see the flip, connect to the new
 *      Redis (including the Socket.IO subscriber) and resume.
 *
 * If a game is running when the day changes, the switch just waits and is
 * retried every 30s until a quiet moment. Nothing is ever switched under a
 * live game. A single URL in the env disables all of this.
 */

const POLL_MS = 2_000;
// Long enough for every instance (polling every POLL_MS) to notice the claim
// and start holding commands.
const SETTLE_MS = 2 * POLL_MS + 1_500;
const LEASE_MS = 90_000;
// Deadline margin: the flip must happen this long before the lease expires,
// so no follower can release its hold before the flip is visible.
const FLIP_MARGIN_MS = 10_000;
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const BUSY_RETRY_MS = 30_000;
const FAILED_RETRY_MS = 60_000;
const BUSY_LOG_EVERY_MS = 60 * 60 * 1000;

const INSTANCE_ID = randomUUID();

class Abort extends Error {}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A game is "in progress" while its status is 'active'. */
async function gameInProgress(): Promise<boolean> {
  return (await Game.exists({ status: 'active' })) !== null;
}

function whenReady(client: Redis, ms: number): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('ready', onReady);
      reject(new Error('timed out connecting'));
    }, ms);
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    client.once('ready', onReady);
  });
}

function closeTrio(trio: RedisTrio): void {
  for (const c of [trio.main, trio.pub, trio.sub]) c.quit().catch(() => c.disconnect());
}

let timer: NodeJS.Timeout | null = null;
let busy = false;
let nextAttemptAt = 0;
let lastBusyLogAt = 0;

/** Keeps this instance's connection in step with the routing record. */
function follow(doc: IRedisRouting, now: number): void {
  const recorded = REDIS_FINGERPRINTS.indexOf(doc.activeFp);
  const local = activeRedisIndex();
  if (recorded >= 0 && local !== null && recorded !== local) {
    // Another instance completed a switch; join it.
    console.log(`🔀 Redis rotation: joining switch ${redisLabel(local)} → ${redisLabel(recorded)}`);
    swapRedis(buildRedisClients(recorded));
  }

  const pending = doc.pendingSwitch;
  const switching = !!pending && pending.expiresAt.getTime() > now;
  if (switching && pending.leader !== INSTANCE_ID) freezeRedis(LEASE_MS + FLIP_MARGIN_MS);
  else if (!switching) unfreezeRedis();
}

async function maybeLead(doc: IRedisRouting, now: number): Promise<void> {
  const pending = doc.pendingSwitch;
  if (pending && pending.expiresAt.getTime() > now) return; // someone is already on it

  const wantIdx = desiredIndex(new Date(now));
  const wantFp = REDIS_FINGERPRINTS[wantIdx];
  if (doc.activeFp === wantFp) return; // already on today's URL
  if (doc.lastSwitchAt && now - doc.lastSwitchAt.getTime() < COOLDOWN_MS) return;
  if (now < nextAttemptAt) return;

  // Cheap check BEFORE touching anything, so a busy server isn't paused
  // over and over just to find out a game is running.
  if (await gameInProgress()) {
    nextAttemptAt = now + BUSY_RETRY_MS;
    if (now - lastBusyLogAt > BUSY_LOG_EVERY_MS) {
      lastBusyLogAt = now;
      console.log(
        `🔀 Redis rotation to ${redisLabel(wantIdx)} is due; waiting for a moment with no game in progress`,
      );
    }
    return;
  }

  await lead(doc, wantIdx, wantFp);
}

async function lead(doc: IRedisRouting, toIdx: number, toFp: string): Promise<void> {
  const fromIdx = activeRedisIndex();
  if (fromIdx === null) return;

  const id = randomUUID();
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + LEASE_MS);

  const claimed = await RedisRouting.findOneAndUpdate(
    {
      _id: ROUTING_DOC_ID,
      activeFp: doc.activeFp,
      $or: [{ pendingSwitch: null }, { 'pendingSwitch.expiresAt': { $lt: startedAt } }],
    },
    { $set: { pendingSwitch: { id, toFp, leader: INSTANCE_ID, startedAt, expiresAt } } },
    { new: true },
  ).lean();
  if (!claimed) return; // another instance got there first

  freezeRedis(LEASE_MS + FLIP_MARGIN_MS);
  let next: RedisTrio | null = null;
  try {
    console.log(
      `🔀 Redis rotation: ${redisLabel(fromIdx)} → ${redisLabel(toIdx)}. No game in progress; holding Redis commands while data is copied.`,
    );

    await sleep(SETTLE_MS);
    if (await gameInProgress()) throw new Abort('a game started');

    next = buildRedisClients(toIdx);
    await Promise.all([next.main, next.pub, next.sub].map((c) => whenReady(c, 15_000)));

    let copy: CopyResult | { failed: string };
    try {
      copy = await copyRedisData(getLiveRedis().main, next.main, { cleanTarget: true });
    } catch (err) {
      copy = { failed: (err as Error).message };
    }
    const copyFailed = 'failed' in copy || copy.failures > 0;
    if (copyFailed) {
      const why = 'failed' in copy ? copy.failed : `${copy.failures} command(s) failed`;
      if (env.REDIS_ROTATION_STRICT) throw new Abort(`copy was not clean (${why}) and REDIS_ROTATION_STRICT is on`);
      console.warn(
        `⚠️  Redis rotation: copy was not clean (${why}). Switching anyway; Mongo holds the durable data, only transient Redis state (presence, caches, locks) may be missing.`,
      );
    }

    if (Date.now() > expiresAt.getTime() - FLIP_MARGIN_MS) throw new Abort('ran out of time');

    const flippedAt = new Date();
    const flipped = await RedisRouting.findOneAndUpdate(
      { _id: ROUTING_DOC_ID, 'pendingSwitch.id': id, activeFp: doc.activeFp },
      {
        $set: {
          activeFp: toFp,
          activeSince: flippedAt,
          lastSwitchAt: flippedAt,
          lastMigration: { at: flippedAt, from: redisLabel(fromIdx), to: redisLabel(toIdx), ...copy },
          pendingSwitch: null,
        },
      },
      { new: true },
    ).lean();
    if (!flipped) throw new Abort('lost the lease');

    const adopted = next;
    next = null; // now owned by the live connection
    swapRedis(adopted);
    console.log(
      `🔀 Redis rotation complete: now on ${redisLabel(toIdx)}` +
        ('failed' in copy ? '' : ` (${copy.copied} keys copied, ${copy.removedStale} stale removed, ${copy.durationMs}ms)`),
    );

    // Hold a moment longer so the other instances have subscribed on the new
    // Redis before this one starts publishing to it.
    await sleep(POLL_MS + 1_000);
  } catch (err) {
    nextAttemptAt = Date.now() + FAILED_RETRY_MS;
    console.warn(
      `🔀 Redis rotation to ${redisLabel(toIdx)} called off, staying on ${redisLabel(fromIdx)}: ${(err as Error).message}`,
    );
    // Release the claim so everyone resumes, unless it was already lost.
    try {
      await RedisRouting.updateOne(
        { _id: ROUTING_DOC_ID, 'pendingSwitch.id': id },
        { $set: { pendingSwitch: null } },
      );
    } catch (e) {
      console.error('could not release redis rotation claim (it expires on its own):', e);
    }
  } finally {
    if (next) closeTrio(next);
    unfreezeRedis();
  }
}

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const doc = await RedisRouting.findById(ROUTING_DOC_ID).lean();
    if (!doc) return;
    const now = Date.now();
    follow(doc, now);
    await maybeLead(doc, now);
  } catch (err) {
    console.error('redis rotation tick failed:', err);
  } finally {
    busy = false;
  }
}

/**
 * Starts the rotation worker on this instance (every instance runs it; they
 * coordinate through Mongo). Call after initRedis(). Does nothing unless
 * REDIS_URLS lists more than one URL. Returns a function that stops it.
 */
export function startRedisRotation(): () => void {
  if (!ROTATION_ENABLED) return () => undefined;
  console.log(
    `🔀 Redis rotation enabled: ${REDIS_URLS.length} URLs, today's is ${redisLabel(desiredIndex())}, in use: ${redisLabel(activeRedisIndex() ?? 0)}`,
  );
  timer = setInterval(() => void tick(), POLL_MS);
  timer.unref();
  void tick();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (isRedisFrozen()) unfreezeRedis();
  };
}

