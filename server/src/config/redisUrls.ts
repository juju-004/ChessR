import { createHash } from 'node:crypto';
import { env } from './env.js';

/** The configured Redis URLs, de-duplicated, in the order given. */
export const REDIS_URLS: string[] = (() => {
  const raw = env.REDIS_URLS?.trim() ? env.REDIS_URLS : (env.REDIS_URL ?? '');
  const urls = raw
    .split(/[,\s]+/)
    .map((u) => u.trim())
    .filter(Boolean);
  return Array.from(new Set<string>(urls));
})();

/** True when there is more than one URL, i.e. rotation is in play. */
export const ROTATION_ENABLED = REDIS_URLS.length > 1;

/** Short, non-reversible id for a URL (what Mongo stores instead of the URL). */
export function fingerprint(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 12);
}

export const REDIS_FINGERPRINTS: string[] = REDIS_URLS.map(fingerprint);

/** Host only, safe to log (no credentials). */
export function redisLabel(index: number): string {
  const url = REDIS_URLS[index];
  try {
    return `#${index + 1} ${new URL(url).host}`;
  } catch {
    return `#${index + 1}`;
  }
}

const ROTATION_TZ = env.REDIS_ROTATION_TZ || env.DAILY_CHALLENGE_TZ;

/** Whole days since the epoch, counted on the calendar of ROTATION_TZ. */
export function rotationDayNumber(now: Date = new Date()): number {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROTATION_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // "2026-10-23"
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Which URL today's calendar day calls for. Pure function of the date and the
 *  URL list, so every instance computes the same answer. */
export function desiredIndex(now: Date = new Date()): number {
  return rotationDayNumber(now) % REDIS_URLS.length;
}
