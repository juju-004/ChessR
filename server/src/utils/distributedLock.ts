import { randomUUID } from 'node:crypto';
import { redis } from '../config/redis.js';

// Release-only-if-still-ours, so a lock that already expired and got
// re-acquired by someone else never gets deleted out from under them by a
// late finally-block from the original holder.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Runs `fn` while holding a Redis lock on `key`, waiting (with jitter) for
 * up to `maxWaitMs` to acquire it if someone else already holds it. Needed
 * anywhere multiple requests, possibly on different server instances (the
 * app runs behind the Redis socket.io adapter specifically because there
 * can be more than one), might otherwise read-modify-write the same
 * document concurrently, since a plain Mongoose `.save()` has no built-in
 * protection against that (see tryArenaPairings for the case this was
 * built for).
 *
 * Returns null if the lock couldn't be acquired within maxWaitMs, callers
 * decide whether that's worth logging, most callers here treat it as "some
 * other in-flight call will handle it, safe to just skip this attempt".
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  { ttlMs = 5000, maxWaitMs = 3000 }: { ttlMs?: number; maxWaitMs?: number } = {},
): Promise<T | null> {
  const token = randomUUID();
  const deadline = Date.now() + maxWaitMs;

  for (;;) {
    const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (acquired === 'OK') {
      try {
        return await fn();
      } finally {
        await redis.eval(RELEASE_SCRIPT, 1, key, token).catch((err) => {
          console.error(`failed to release lock ${key}:`, err);
        });
      }
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 60));
  }
}
