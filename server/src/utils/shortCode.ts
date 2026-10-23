import { customAlphabet } from "nanoid";

/**
 * Alphabet for game join codes and puzzle race codes: digits plus upper- and
 * lower-case letters, minus i/I and o/O (they read as 1 and 0 in most
 * typefaces). Codes are CASE-SENSITIVE, "aB3xYz" and "AB3XYZ" are different
 * codes, so nothing may upper/lower-case a code before looking it up.
 *
 * Tournament and cage match codes keep their own (uppercase-only) alphabets.
 */
export const SHORT_CODE_ALPHABET =
  "0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjklmnpqrstuvwxyz";

export const generateShortCode = customAlphabet(SHORT_CODE_ALPHABET, 6);

/**
 * Games live at the site root (chessr.org/AbC123), so a game code must never
 * equal the first segment of a real page, or that game would be unreachable
 * (the page would win the route). Compared case-insensitively because the
 * client router matches /Wallet to /wallet.
 *
 * KEEP IN SYNC with RESERVED_PATH_WORDS in client/src/lib/gamePath.ts and
 * client/middleware.ts. Add the first segment of any new top-level route to
 * all three.
 */
const RESERVED_PATH_WORDS: ReadonlySet<string> = new Set([
  "about", "account-details", "admin", "api", "assets", "cage",
  "choose-username", "create", "daily", "dashboard", "find", "friends",
  "game", "invite", "leaderboard", "league", "leagues", "lobby", "logout",
  "notifications", "organization", "play", "players", "profile", "public",
  "puzzles", "replay", "report", "search", "settings", "signin", "signup",
  "static", "terms", "tournaments", "verify-email", "wallet",
]);

export function isReservedGameCode(code: string): boolean {
  return RESERVED_PATH_WORDS.has(code.toLowerCase());
}

/** A fresh game join code that is not a reserved page name. */
export function generateGameCode(): string {
  let code = generateShortCode();
  while (isReservedGameCode(code)) code = generateShortCode();
  return code;
}
