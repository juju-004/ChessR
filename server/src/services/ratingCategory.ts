/**
 * The rating ladders. Every rated game feeds exactly ONE of them.
 *
 * Standard chess is chosen by the game's base time (the increment is
 * ignored):
 *
 *   bullet  base time under 3 minutes (Hyper Bullet, 1+0, 2+1, ...)
 *   blitz   3 minutes up to (not including) 8 (3+0, 3+2, 5+0, ...)
 *   rapid   8 minutes and up, plus untimed games (8+0, 10+5, 15+10, 30+0, ...)
 *
 * Only the BASE minutes count: 1+5 is bullet, 5+5 is blitz.
 *
 * The two variants each have their OWN ladder, whatever the time control:
 *
 *   chess960    every Chess960 game
 *   crazyhouse  every Crazyhouse game
 *
 * Kept in its own dependency-free file so models, services and scripts can
 * all import it without pulling in the rating service's DB/Redis imports.
 * The client mirrors this in client/src/timeControls.ts, keep them in step.
 */

/** The three time-based ladders (standard chess only). */
export type TimeRatingCategory = "bullet" | "blitz" | "rapid";

/** Every ladder a player has a rating on. */
export type RatingCategory = TimeRatingCategory | "chess960" | "crazyhouse";

export type GameVariant = "standard" | "chess960" | "crazyhouse";

export const TIME_RATING_CATEGORIES: TimeRatingCategory[] = ["bullet", "blitz", "rapid"];
export const RATING_CATEGORIES: RatingCategory[] = ["bullet", "blitz", "rapid", "chess960", "crazyhouse"];

/** A rating nobody has played yet on starts here (same as RATING_START in
 *  rating.service.ts, repeated so this file stays dependency-free). */
const DEFAULT_RATING = 1500;

export function isVariantCategory(c: RatingCategory): c is "chess960" | "crazyhouse" {
  return c === "chess960" || c === "crazyhouse";
}

/** The time-based ladder for a base time. Never returns a variant ladder,
 *  use ratingCategoryForGame when the variant is known. */
export function ratingCategoryForSeconds(baseSeconds: number | null | undefined): TimeRatingCategory {
  if (baseSeconds === null || baseSeconds === undefined) return "rapid";
  if (baseSeconds < 3 * 60) return "bullet";
  if (baseSeconds < 8 * 60) return "blitz";
  return "rapid";
}

export function ratingCategoryForMinutes(baseMinutes: number | null | undefined): TimeRatingCategory {
  return ratingCategoryForSeconds(baseMinutes === null || baseMinutes === undefined ? null : baseMinutes * 60);
}

/** The ladder a game moves: its variant's own ladder for Chess960 and
 *  Crazyhouse, otherwise the ladder its base time belongs to. */
export function ratingCategoryForGame(
  baseSeconds: number | null | undefined,
  variant?: GameVariant | string | null,
): RatingCategory {
  if (variant === "chess960" || variant === "crazyhouse") return variant;
  return ratingCategoryForSeconds(baseSeconds);
}

export function ratingCategoryForGameMinutes(
  baseMinutes: number | null | undefined,
  variant?: GameVariant | string | null,
): RatingCategory {
  return ratingCategoryForGame(baseMinutes === null || baseMinutes === undefined ? null : baseMinutes * 60, variant);
}

export type CategoryRatings = Record<RatingCategory, number>;

interface RatingFields {
  /** Legacy single rating, now the denormalized BEST of the three time ladders. */
  rating: number;
  ratings?: Partial<CategoryRatings> | null;
}

/** All ratings for a user. A user who hasn't been split yet (no `ratings`
 *  stored) has their old single rating in every time ladder, which is
 *  exactly what the split seeds them with. The variant ladders are new:
 *  nobody has a history there, so they always start fresh at 1500 until
 *  the player's first game of that variant. */
export function resolveRatings(u: RatingFields): CategoryRatings {
  const fallback = typeof u.rating === "number" ? u.rating : DEFAULT_RATING;
  return {
    bullet: u.ratings?.bullet ?? fallback,
    blitz: u.ratings?.blitz ?? fallback,
    rapid: u.ratings?.rapid ?? fallback,
    chess960: u.ratings?.chess960 ?? DEFAULT_RATING,
    crazyhouse: u.ratings?.crazyhouse ?? DEFAULT_RATING,
  };
}

export function ratingFor(u: RatingFields, category: RatingCategory): number {
  return resolveRatings(u)[category];
}

// Tie-break order when two categories share the top rating (e.g. a brand
// new account where all three are 1500).
const BEST_TIE_ORDER: TimeRatingCategory[] = ["blitz", "rapid", "bullet"];

/** The best of the three TIME ladders. The variant ladders are deliberately
 *  left out: `User.rating` is what every list, sort and matchmaking hint
 *  shows as "their rating", and a hot streak on a variant shouldn't change
 *  what standard chess looks like for them. */
export function bestOfRatings(
  r: Pick<CategoryRatings, TimeRatingCategory>,
): { rating: number; category: TimeRatingCategory } {
  let best: TimeRatingCategory = BEST_TIE_ORDER[0];
  for (const c of BEST_TIE_ORDER) {
    if (r[c] > r[best]) best = c;
  }
  return { rating: r[best], category: best };
}

/** A populated player object as shown in a game view: its `rating` becomes
 *  the rating on THAT GAME's ladder (and `ratingCategory` says which), rather
 *  than the player's overall best. Ids / null pass through untouched. */
export function withGameCategoryRating<P>(
  player: P,
  baseSeconds: number | null | undefined,
  variant?: GameVariant | string | null,
): P {
  if (!player || typeof player !== "object" || !("username" in (player as object))) return player;
  const p = player as unknown as RatingFields & Record<string, unknown>;
  const category = ratingCategoryForGame(baseSeconds, variant);
  const { ratings: _drop, ...rest } = p;
  return { ...rest, rating: ratingFor(p, category), ratingCategory: category } as unknown as P;
}
