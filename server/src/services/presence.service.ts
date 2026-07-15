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
