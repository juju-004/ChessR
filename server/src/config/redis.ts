import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import { RedisRouting, ROUTING_DOC_ID } from "../models/RedisRouting.js";
import {
  REDIS_URLS,
  REDIS_FINGERPRINTS,
  ROTATION_ENABLED,
  desiredIndex,
  redisLabel,
} from "./redisUrls.js";

/**
 * Redis access for the whole server.
 *
 * `redis`, `pubClient` and `subClient` are exported exactly as before and are
 * used exactly as before, but they are now thin proxies over the *currently
 * active* connection. That indirection is what lets the active Redis URL be
 * swapped at runtime (daily rotation across REDIS_URLS) without touching any
 * of the code that uses them:
 *
 *   - Commands go to whichever connection is live at the moment of the call.
 *   - While a rotation is copying data, commands are held (see freezeRedis)
 *     for a few seconds and then run against the new Redis, so nothing
 *     reads or writes a half-copied store.
 *   - The Socket.IO adapter's subscriber is re-subscribed on the new Redis
 *     (see subClient below), so its rooms/channels survive the swap.
 *
 * With a single URL (REDIS_URL, or one entry in REDIS_URLS) none of this is
 * active: the connections are created at import, exactly like before.
 *
 * The policy (when to switch, safety checks, copying the data) lives in
 * services/redisRotation.service.ts; this file is only the mechanism.
 */

type AnyFn = (...args: unknown[]) => unknown;
const asRecord = (x: unknown) => x as Record<string, AnyFn>;

export interface RedisTrio {
  main: Redis;
  pub: Redis;
  sub: Redis;
  /** Index into REDIS_URLS. */
  index: number;
}

function createClient(name: string, url: string, label: string): Redis {
  const client = new Redis(url, {
    // `maxRetriesPerRequest: 3` (the old value) meant any command still
    // reconnecting after 3 quick retries threw a hard error, fine for a
    // same-machine Redis, but a real network hop has occasional brief blips
    // that fully recover on their own. `null` means "queue and keep retrying
    // per retryStrategy below rather than giving up", the standard
    // recommendation for ioredis over an actual network, and specifically
    // required for the pub/sub clients (a subscriber connection giving up
    // after 3 retries silently breaks cross-instance broadcast).
    maxRetriesPerRequest: null,
    // Exponential-ish backoff, capped at 5s so it doesn't hammer the server
    // during a real outage, but recovers quickly from a momentary drop.
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    connectTimeout: 15000,
    keepAlive: 10000,
    enableAutoPipelining: true,
    lazyConnect: false,
  });

  client.on("connect", () => console.log(`✅ Redis (${name}, ${label}) connected`));
  client.on("error", (err) =>
    console.error(`❌ Redis (${name}, ${label}) error:`, err.message),
  );

  return client;
}

/** Opens the three connections (general, pub, sub) to REDIS_URLS[index]. */
export function buildRedisClients(index: number): RedisTrio {
  const url = REDIS_URLS[index];
  const label = redisLabel(index);
  return {
    main: createClient("main", url, label),
    pub: createClient("pub", url, label),
    sub: createClient("sub", url, label),
    index,
  };
}

// ---------------------------------------------------------------------------
// Live connection + freeze gate
// ---------------------------------------------------------------------------

let live: RedisTrio | null = null;
let initPromise: Promise<void> | null = null;
const retiring: Redis[] = [];

/** Brief window after a swap during which the old connections stay open, so
 *  in-flight scans/pipelines finish and the old subscriber keeps hearing
 *  publishes from peers that have not switched yet. */
const RETIRE_GRACE_MS = 60_000;

interface Gate {
  promise: Promise<void>;
  open: () => void;
  timer: NodeJS.Timeout;
}
let gate: Gate | null = null;

/**
 * Starts holding every Redis command. Used by a rotation for the few seconds
 * its data copy takes. The hold lifts by itself after `maxHoldMs` so a crashed
 * rotation can never wedge the app.
 */
export function freezeRedis(maxHoldMs = 120_000): void {
  if (gate) return;
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  const timer = setTimeout(() => {
    console.warn(`⚠️  Redis freeze exceeded ${maxHoldMs}ms, releasing held commands`);
    unfreezeRedis();
  }, maxHoldMs);
  timer.unref();
  gate = { promise, open, timer };
}

export function unfreezeRedis(): void {
  if (!gate) return;
  const g = gate;
  gate = null;
  clearTimeout(g.timer);
  g.open();
}

export function isRedisFrozen(): boolean {
  return gate !== null;
}

if (!ROTATION_ENABLED) {
  // Single URL: connect immediately, as the app always has.
  live = buildRedisClients(0);
}

/** The live connections. Throws if initRedis() has not completed yet. */
export function getLiveRedis(): RedisTrio {
  if (!live) throw new Error("Redis is not initialised yet: await initRedis() first");
  return live;
}

/** Index (into REDIS_URLS) of the Redis currently in use, or null before init. */
export function activeRedisIndex(): number | null {
  return live ? live.index : null;
}

/**
 * Decides which Redis to connect to and connects. Call once at startup, after
 * Mongo is connected (the active URL is recorded there). A no-op with a single
 * URL. Safe to call repeatedly. Commands issued before it completes simply
 * wait for it.
 */
export function initRedis(): Promise<void> {
  if (live) return Promise.resolve();
  if (!initPromise) {
    initPromise = (async () => {
      const { index, frozen } = await resolveActiveFromMongo();
      const trio = buildRedisClients(index);
      replaySubscriber(trio.sub);
      live = trio;
      console.log(`🔀 Redis rotation active: using ${redisLabel(index)} of ${REDIS_URLS.length}`);
      if (frozen) freezeRedis();
    })().catch((err) => {
      initPromise = null; // allow a retry
      throw err;
    });
  }
  return initPromise;
}

async function resolveActiveFromMongo(): Promise<{ index: number; frozen: boolean }> {
  const now = new Date();
  const want = desiredIndex(now);

  const fresh = {
    activeFp: REDIS_FINGERPRINTS[want],
    activeSince: now,
    lastSwitchAt: null,
    lastMigration: null,
    pendingSwitch: null,
  };
  let doc;
  try {
    // First instance ever to boot creates the record, already pointing at
    // today's URL; everyone else just reads it.
    doc = await RedisRouting.findOneAndUpdate(
      { _id: ROUTING_DOC_ID },
      { $setOnInsert: fresh },
      { upsert: true, new: true },
    ).lean();
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err; // lost the insert race
    doc = await RedisRouting.findById(ROUTING_DOC_ID).lean();
  }
  if (!doc) throw new Error("Redis routing record missing");

  let index = REDIS_FINGERPRINTS.indexOf(doc.activeFp);
  if (index < 0) {
    // The recorded Redis is no longer in REDIS_URLS (it was removed from the
    // list), so there is nothing to copy from. Adopt today's URL.
    console.warn(
      "⚠️  The Redis recorded as active is not in REDIS_URLS any more; switching to today's URL without copying data.",
    );
    const adopted = await RedisRouting.findOneAndUpdate(
      { _id: ROUTING_DOC_ID, activeFp: doc.activeFp },
      {
        $set: {
          activeFp: REDIS_FINGERPRINTS[want],
          activeSince: now,
          lastSwitchAt: now,
          pendingSwitch: null,
        },
      },
      { new: true },
    ).lean();
    const current = adopted ?? (await RedisRouting.findById(ROUTING_DOC_ID).lean());
    index = current ? REDIS_FINGERPRINTS.indexOf(current.activeFp) : -1;
    if (index < 0) index = want;
    doc = current ?? doc;
  }

  const frozen = !!doc.pendingSwitch && doc.pendingSwitch.expiresAt.getTime() > now.getTime();
  return { index, frozen };
}

/** Repeats on `sub` everything the adapter has asked of its subscriber. */
function replaySubscriber(sub: Redis): void {
  for (const l of subRecord.listeners) asRecord(sub)[l.kind](l.event, l.fn);
  const rejoin = (what: string, p: Promise<unknown>) =>
    p.catch((err: Error) => console.error(`❌ Redis resubscribe (${what}) failed:`, err.message));
  if (subRecord.channels.size) rejoin("channels", sub.subscribe(...subRecord.channels));
  if (subRecord.patterns.size) rejoin("patterns", sub.psubscribe(...subRecord.patterns));
}

/**
 * Makes `next` the live connections: replays the subscriber's channels and
 * listeners onto it, then retires the old connections after a grace period.
 * Called by the rotation service (leader after copying, followers on seeing
 * the leader's switch).
 */
export function swapRedis(next: RedisTrio): void {
  const old = live;
  replaySubscriber(next.sub);
  live = next;

  if (old) {
    const olds = [old.main, old.pub, old.sub];
    retiring.push(...olds);
    const t = setTimeout(() => {
      for (const c of olds) {
        const i = retiring.indexOf(c);
        if (i >= 0) retiring.splice(i, 1);
        c.quit().catch(() => c.disconnect());
      }
    }, RETIRE_GRACE_MS);
    t.unref();
  }
}

// ---------------------------------------------------------------------------
// Proxies
// ---------------------------------------------------------------------------

/** Every ioredis method that sends a command (plus its *Buffer twin). Those are
 *  the calls held while frozen. Everything else passes straight through. */
const COMMAND_NAMES: Set<string> = (() => {
  const names = new Set<string>();
  const builtin = (Redis.prototype as unknown as { getBuiltinCommands?: () => string[] })
    .getBuiltinCommands?.();
  if (builtin?.length) {
    for (const n of builtin) {
      names.add(n);
      names.add(`${n}Buffer`);
    }
  } else {
    // Fallback: ioredis defines each command as an all-lowercase method.
    const skip = new Set([
      ...Object.getOwnPropertyNames(EventEmitter.prototype),
      "connect",
      "disconnect",
      "end",
      "duplicate",
      "quit",
    ]);
    for (let p = Redis.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const n of Object.getOwnPropertyNames(p)) {
        if (/^[a-z][a-z0-9]*$/.test(n) && !skip.has(n) && typeof asRecord(p)[n] === "function") {
          names.add(n);
          names.add(`${n}Buffer`);
        }
      }
    }
  }
  for (const n of ["call", "callBuffer", "sendCommand", "eval", "evalsha", "pubsub"]) names.add(n);
  names.delete("quit"); // shutdown must never wait on the gate
  return names;
})();

/** Runs `fn` against the live connection, waiting first for init and for any
 *  freeze. Stays synchronous in the normal case so command auto-pipelining
 *  behaves exactly as it did with a bare client. */
function run<T>(fn: () => T): T | Promise<T> {
  if (live && !gate) return fn();
  return runAsync(fn);
}

async function runAsync<T>(fn: () => T): Promise<T> {
  if (!live) await initRedis();
  while (gate) await gate.promise;
  return fn();
}

function currentOrThrow(pick: (t: RedisTrio) => Redis): Redis {
  if (!live) throw new Error("Redis is not initialised yet: await initRedis() first");
  return pick(live);
}

/** pipeline()/multi(): recorded here and replayed on whichever connection is
 *  live when .exec() runs, so a pipeline built before a swap and executed
 *  after it still hits the right Redis. */
function makeBatch(pick: (t: RedisTrio) => Redis, kind: "pipeline" | "multi", initial: unknown) {
  const ops: Array<[string, unknown[]]> = [];
  const self: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        if (prop === "exec") {
          return () =>
            runAsync(() => {
              const batch = asRecord(asRecord(currentOrThrow(pick))[kind](initial));
              for (const [method, args] of ops) batch[method](...args);
              return batch.exec();
            });
        }
        if (prop === "length") return ops.length;
        return (...args: unknown[]) => {
          ops.push([prop, args]);
          return self;
        };
      },
    },
  );
  return self;
}

function makeCommandProxy(pick: (t: RedisTrio) => Redis): Redis {
  return new Proxy({} as Redis, {
    get(_t, prop) {
      if (typeof prop === "symbol" || prop === "then") return undefined;
      if (COMMAND_NAMES.has(prop)) {
        return (...args: unknown[]) => run(() => asRecord(currentOrThrow(pick))[prop](...args));
      }
      if (prop === "pipeline" || prop === "multi") {
        return (initial?: unknown) => makeBatch(pick, prop, initial);
      }
      if (prop === "status") return live ? pick(live).status : "wait";
      // Everything else (scanStream and friends, options, event methods)
      // goes straight to the live connection.
      const target = currentOrThrow(pick) as unknown as Record<string, unknown>;
      const value = target[prop];
      return typeof value === "function" && prop !== "constructor" ? (value as AnyFn).bind(target) : value;
    },
  });
}

// What the Socket.IO adapter has asked its subscriber to do, so it can be
// repeated on a new connection after a swap (ioredis only re-subscribes
// automatically when reconnecting to the *same* server).
type ListenerKind = "on" | "once" | "addListener" | "prependListener";
const subRecord = {
  listeners: [] as Array<{ kind: ListenerKind; event: string | symbol; fn: (...a: unknown[]) => void; orig: unknown }>,
  channels: new Set<string>(),
  patterns: new Set<string>(),
};

function stringArgs(args: unknown[]): string[] {
  return args.filter((a): a is string => typeof a === "string");
}

function makeSubscriberProxy(): Redis {
  const pick = (t: RedisTrio) => t.sub;
  const proxy: Redis = new Proxy({} as Redis, {
    get(_t, prop) {
      if (typeof prop === "symbol" || prop === "then") return undefined;
      const emitter = () => currentOrThrow(pick) as unknown as EventEmitter;

      if (prop === "on" || prop === "addListener" || prop === "prependListener" || prop === "once") {
        return (event: string | symbol, fn: (...a: unknown[]) => void) => {
          let registered = fn;
          if (prop === "once") {
            registered = (...a: unknown[]) => {
              const i = subRecord.listeners.findIndex((l) => l.fn === registered);
              if (i >= 0) subRecord.listeners.splice(i, 1);
              fn(...a);
            };
          }
          subRecord.listeners.push({ kind: prop, event, fn: registered, orig: fn });
          if (live) asRecord(emitter())[prop](event, registered);
          return proxy;
        };
      }
      if (prop === "off" || prop === "removeListener") {
        return (event: string | symbol, fn: unknown) => {
          const i = subRecord.listeners.findIndex((l) => l.event === event && (l.orig === fn || l.fn === fn));
          if (i >= 0) {
            const [rec] = subRecord.listeners.splice(i, 1);
            if (live) emitter().removeListener(event, rec.fn);
          }
          return proxy;
        };
      }
      if (prop === "subscribe" || prop === "psubscribe" || prop === "unsubscribe" || prop === "punsubscribe") {
        const isPattern = prop === "psubscribe" || prop === "punsubscribe";
        const set = isPattern ? subRecord.patterns : subRecord.channels;
        return (...args: unknown[]) => {
          const names = stringArgs(args);
          if (prop === "subscribe" || prop === "psubscribe") names.forEach((n) => set.add(n));
          else if (names.length) names.forEach((n) => set.delete(n));
          else set.clear(); // unsubscribe() with no arguments drops everything
          // Not held by the freeze: the adapter must be able to subscribe at
          // any time, and a subscription is harmless on a Redis mid-copy.
          return (async () => {
            if (!live) await initRedis();
            return asRecord(currentOrThrow(pick))[prop](...args);
          })();
        };
      }
      if (prop === "status") return live ? live.sub.status : "wait";
      const target = currentOrThrow(pick) as unknown as Record<string, unknown>;
      const value = target[prop];
      return typeof value === "function" && prop !== "constructor" ? (value as AnyFn).bind(target) : value;
    },
  });
  return proxy;
}

// General-purpose client for game state, presence, caching.
export const redis: Redis = makeCommandProxy((t) => t.main);

// Socket.IO's Redis adapter requires two dedicated, exclusive connections
// (one for publishing, one for subscribing), never reuse `redis` for these.
export const pubClient: Redis = makeCommandProxy((t) => t.pub);
export const subClient: Redis = makeSubscriberProxy();

export async function disconnectRedis(): Promise<void> {
  unfreezeRedis();
  const all = [...(live ? [live.main, live.pub, live.sub] : []), ...retiring];
  retiring.length = 0;
  await Promise.all(all.map((c) => c.quit().catch(() => c.disconnect())));
}
