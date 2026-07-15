import Redis from 'ioredis';
import { env } from './env.js';

function createClient(name: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
    lazyConnect: false,
  });

  client.on('connect', () => console.log(`✅ Redis (${name}) connected`));
  client.on('error', (err) => console.error(`❌ Redis (${name}) error:`, err.message));

  return client;
}

// General-purpose client for game state, presence, caching.
export const redis = createClient('main');

// Socket.IO's Redis adapter requires two dedicated, exclusive connections
// (one for publishing, one for subscribing) — never reuse `redis` for these.
export const pubClient = createClient('pub');
export const subClient = createClient('sub');

export async function disconnectRedis(): Promise<void> {
  await Promise.all([redis.quit(), pubClient.quit(), subClient.quit()]);
}
