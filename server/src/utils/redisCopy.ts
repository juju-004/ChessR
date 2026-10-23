import type { Redis } from 'ioredis';

export interface CopyResult {
  /** Keys found in the source. */
  scanned: number;
  /** Keys written to the destination. */
  copied: number;
  /** Keys not copied: gone by the time they were read, or of a type that is not supported. */
  skipped: number;
  /** Keys that were in the destination but not in the source, and were removed. */
  removedStale: number;
  /** Individual commands that failed. Zero on a clean copy. */
  failures: number;
  durationMs: number;
}

const BATCH = 100;
const CHUNK = 1000; // members/elements per write command

type PipelineResult = Array<[Error | null, unknown]> | null;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function scanAll(client: Redis): Promise<string[]> {
  const keys: string[] = [];
  for await (const batch of client.scanStream({ count: 500 })) {
    keys.push(...(batch as string[]));
  }
  return [...new Set(keys)]; // SCAN may repeat keys
}

/**
 * Copies every key from `src` to `dst`, with its type, value and remaining
 * TTL, using only plain read/write commands (no DUMP/RESTORE, which some
 * hosted Redis services don't offer). Each key is overwritten in the
 * destination, so it ends up identical to the source.
 *
 * With `cleanTarget`, keys that exist only in the destination are deleted
 * afterwards. The destination was last live days ago, so what it still holds
 * is stale (old presence entries, leftover locks). This assumes the Redis
 * instances in REDIS_URLS are dedicated to this app.
 *
 * Throws only if the source can't be scanned at all; per-key problems are
 * counted in `failures`.
 */
export async function copyRedisData(
  src: Redis,
  dst: Redis,
  { cleanTarget }: { cleanTarget: boolean },
): Promise<CopyResult> {
  const startedAt = Date.now();
  const result: CopyResult = { scanned: 0, copied: 0, skipped: 0, removedStale: 0, failures: 0, durationMs: 0 };

  const srcKeys = await scanAll(src);
  result.scanned = srcKeys.length;

  const countFailures = (res: PipelineResult) => {
    for (const [err] of res ?? []) if (err) result.failures++;
  };

  for (const keys of chunks(srcKeys, BATCH)) {
    // Type and TTL of each key.
    const metaPipe = src.pipeline();
    for (const k of keys) metaPipe.type(k).pttl(k);
    const meta = (await metaPipe.exec()) as PipelineResult;
    if (!meta) throw new Error('source returned no result for TYPE/PTTL');

    const live: Array<{ key: string; type: string; pttl: number }> = [];
    keys.forEach((key, i) => {
      const [typeErr, type] = meta[i * 2];
      const [ttlErr, pttl] = meta[i * 2 + 1];
      if (typeErr || ttlErr) {
        result.failures++;
        return;
      }
      if ((pttl as number) === -2 || type === 'none') {
        result.skipped++; // expired between SCAN and now
        return;
      }
      live.push({ key, type: type as string, pttl: pttl as number });
    });

    // Values.
    const readPipe = src.pipeline();
    const readable = live.filter(({ type }) => ['string', 'hash', 'list', 'set', 'zset'].includes(type));
    result.skipped += live.length - readable.length;
    for (const { key, type } of readable) {
      if (type === 'string') readPipe.getBuffer(key);
      else if (type === 'hash') readPipe.hgetall(key);
      else if (type === 'list') readPipe.lrange(key, 0, -1);
      else if (type === 'set') readPipe.smembers(key);
      else readPipe.zrange(key, 0, -1, 'WITHSCORES');
    }
    const values = readable.length ? ((await readPipe.exec()) as PipelineResult) : [];
    if (readable.length && !values) throw new Error('source returned no result for value reads');

    // Writes.
    const writePipe = dst.pipeline();
    let writes = 0;
    readable.forEach(({ key, type, pttl }, i) => {
      const [err, value] = (values as NonNullable<PipelineResult>)[i];
      if (err || value === null || value === undefined) {
        if (err) result.failures++;
        else result.skipped++;
        return;
      }
      writePipe.del(key);
      if (type === 'string') {
        writePipe.set(key, value as Buffer);
      } else if (type === 'hash') {
        const fields = value as Record<string, string>;
        if (!Object.keys(fields).length) return;
        writePipe.hset(key, fields);
      } else if (type === 'list') {
        for (const part of chunks(value as string[], CHUNK)) writePipe.rpush(key, ...part);
      } else if (type === 'set') {
        for (const part of chunks(value as string[], CHUNK)) writePipe.sadd(key, ...part);
      } else {
        // ZRANGE ... WITHSCORES returns [member, score, member, score, ...];
        // ZADD wants [score, member, ...].
        const flat = value as string[];
        const args: string[] = [];
        for (let j = 0; j < flat.length; j += 2) args.push(flat[j + 1], flat[j]);
        for (const part of chunks(args, CHUNK * 2)) writePipe.zadd(key, ...part);
      }
      if (pttl > 0) writePipe.pexpire(key, pttl);
      result.copied++;
      writes++;
    });
    if (writes) countFailures((await writePipe.exec()) as PipelineResult);
  }

  if (cleanTarget) {
    const wanted = new Set(srcKeys);
    const stale = (await scanAll(dst)).filter((k) => !wanted.has(k));
    for (const part of chunks(stale, BATCH)) {
      await dst.del(...part);
      result.removedStale += part.length;
    }
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}
