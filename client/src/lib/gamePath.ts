/**
 * The one place that knows what a game URL looks like.
 *
 * A game lives at the site root: chessr.org/AbC123. That single-segment shape
 * overlaps with every other top-level page (/lobby, /wallet, ...), so three
 * rules keep the two apart, and every caller goes through this file instead of
 * re-deriving them:
 *
 *   1. React Router ranks fixed routes above `/:code`, so /lobby etc. always
 *      win over the game route.
 *   2. A segment only counts as a game code if it is exactly 6 letters/digits
 *      and is not a reserved word (below). Anything else on `/:code` renders
 *      NotFound, so a typo like /dashbord is a 404, not "game not found".
 *   3. The server never issues a game code that is a reserved word
 *      (server/src/utils/shortCode.ts), so a real game can never be shadowed
 *      by a page.
 *
 * Never hard-code a game URL (the old "/game/" + code form, or a
 * pathname.startsWith check on it); use gameHref / isGamePath /
 * gameCodeFromPath.
 *
 * KEEP IN SYNC: RESERVED_PATH_WORDS is mirrored in
 * server/src/utils/shortCode.ts and client/middleware.ts. When you add a
 * top-level route in App.tsx, add its first segment to all three.
 */

/** Game codes are exactly 6 chars. Legacy all-uppercase codes (which may
 *  contain I/O/L/0/1) are still valid, so this is deliberately wider than the
 *  alphabet new codes are generated from. Case-sensitive, never case-fold. */
const GAME_CODE_PATTERN = /^[0-9A-Za-z]{6}$/;

/** First path segments owned by real pages (and static asset roots). Compared
 *  case-insensitively, because React Router matches /Wallet to /wallet. */
export const RESERVED_PATH_WORDS: ReadonlySet<string> = new Set([
  "about",
  "account-details",
  "admin",
  "api",
  "assets",
  "cage",
  "choose-username",
  "create",
  "daily",
  "dashboard",
  "find",
  "friends",
  "game",
  "invite",
  "leaderboard",
  "league",
  "leagues",
  "lobby",
  "logout",
  "notifications",
  "organization",
  "play",
  "players",
  "profile",
  "public",
  "puzzles",
  "replay",
  "report",
  "search",
  "settings",
  "signin",
  "signup",
  "static",
  "terms",
  "tournaments",
  "verify-email",
  "wallet",
]);

export function isReservedPathWord(segment: string): boolean {
  return RESERVED_PATH_WORDS.has(segment.toLowerCase());
}

/** True if `value` can be the code of a game (format only, not existence). */
export function isGameCode(value: string | undefined | null): value is string {
  return !!value && GAME_CODE_PATTERN.test(value) && !isReservedPathWord(value);
}

/** Router path for a game, e.g. "/AbC123". */
export function gameHref(code: string): string {
  return `/${encodeURIComponent(code)}`;
}

/** The game code if `pathname` is a game page ("/AbC123" or "/AbC123/"), else
 *  null. */
export function gameCodeFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/([^/]+)\/?$/);
  if (!match) return null;
  let segment: string;
  try {
    segment = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return isGameCode(segment) ? segment : null;
}

export function isGamePath(pathname: string): boolean {
  return gameCodeFromPath(pathname) !== null;
}

/** True if `pathname` is `base` itself or anything beneath it ("/admin" and
 *  "/admin/reports", but not "/admin7"). A plain startsWith("/admin") would
 *  also swallow the game code "admin7". */
export function isUnderPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}
