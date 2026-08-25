import { Redis } from "ioredis";
import { env } from "./env.js";

function createClient(name: string): Redis {
  const client = new Redis(env.REDIS_URL, {
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

  client.on("connect", () => console.log(`✅ Redis (${name}) connected`));
  client.on("error", (err) =>
    console.error(`❌ Redis (${name}) error:`, err.message),
  );

  return client;
}

// General-purpose client for game state, presence, caching.
export const redis = createClient("main");

// Socket.IO's Redis adapter requires two dedicated, exclusive connections
// (one for publishing, one for subscribing), never reuse `redis` for these.
export const pubClient = createClient("pub");
export const subClient = createClient("sub");

export async function disconnectRedis(): Promise<void> {
  await Promise.all([redis.quit(), pubClient.quit(), subClient.quit()]);
}
