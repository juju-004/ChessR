/**
 * The three rating ladders. Every rated game feeds exactly ONE of them,
 * chosen by the game's base time (the increment is ignored):
 *
 *   bullet  base time under 3 minutes (Hyper Bullet, 1+0, 2+1, ...)
 *   blitz   3 minutes up to (not including) 8 (3+0, 3+2, 5+0, ...)
 *   rapid   8 minutes and up, plus untimed games (8+0, 10+5, 15+10, 30+0, ...)
 *
 * Only the BASE minutes count: 1+5 is bullet, 5+5 is blitz.
 *
 * Kept in its own dependency-free file so models, services and scripts can
 * all import it without pulling in the rating service's DB/Redis imports.
 * The client mirrors this in client/src/timeControls.ts, keep them in step.
 */
export type RatingCategory = "bullet" | "blitz" | "rapid";

export const RATING_CATEGORIES: RatingCategory[] = ["bullet", "blitz", "rapid"];

export function ratingCategoryForSeconds(baseSeconds: number | null | undefined): RatingCategory {
  if (baseSeconds === null || baseSeconds === undefined) return "rapid";
  if (baseSeconds < 3 * 60) return "bullet";
  if (baseSeconds < 8 * 60) return "blitz";
  return "rapid";
}

export function ratingCategoryForMinutes(baseMinutes: number | null | undefined): RatingCategory {
  return ratingCategoryForSeconds(baseMinutes === null || baseMinutes === undefined ? null : baseMinutes * 60);
}

export type CategoryRatings = Record<RatingCategory, number>;

interface RatingFields {
  /** Legacy single rating, now the denormalized BEST of the three. */
  rating: number;
  ratings?: Partial<CategoryRatings> | null;
}

/** All three ratings for a user. A user who hasn't been split yet (no
 *  `ratings` stored) has their old single rating in every category, which
 *  is exactly what the split seeds them with. */
export function resolveRatings(u: RatingFields): CategoryRatings {
  const fallback = typeof u.rating === "number" ? u.rating : 1500;
  return {
    bullet: u.ratings?.bullet ?? fallback,
    blitz: u.ratings?.blitz ?? fallback,
    rapid: u.ratings?.rapid ?? fallback,
  };
}

export function ratingFor(u: RatingFields, category: RatingCategory): number {
  return resolveRatings(u)[category];
}

// Tie-break order when two categories share the top rating (e.g. a brand
// new account where all three are 1500).
const BEST_TIE_ORDER: RatingCategory[] = ["blitz", "rapid", "bullet"];

export function bestOfRatings(r: CategoryRatings): { rating: number; category: RatingCategory } {
  let best: RatingCategory = BEST_TIE_ORDER[0];
  for (const c of BEST_TIE_ORDER) {
    if (r[c] > r[best]) best = c;
  }
  return { rating: r[best], category: best };
}

/** A populated player object as shown in a game view: its `rating` becomes
 *  the rating on THAT GAME's ladder (and `ratingCategory` says which), rather
 *  than the player's overall best. Ids / null pass through untouched. */
export function withGameCategoryRating<P>(player: P, baseSeconds: number | null | undefined): P {
  if (!player || typeof player !== "object" || !("username" in (player as object))) return player;
  const p = player as unknown as RatingFields & Record<string, unknown>;
  const category = ratingCategoryForSeconds(baseSeconds);
  const { ratings: _drop, ...rest } = p;
  return { ...rest, rating: ratingFor(p, category), ratingCategory: category } as unknown as P;
}
