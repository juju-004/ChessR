import { Game } from "../models/Game.js";
import { User } from "../models/User.js";
import { updateOnlineRank } from "./presence.service.js";
import {
  ratingCategoryForGame,
  isVariantCategory,
  resolveRatings,
  bestOfRatings,
  TIME_RATING_CATEGORIES,
  type RatingCategory,
} from "./ratingCategory.js";

export { ratingCategoryForSeconds, type RatingCategory } from "./ratingCategory.js";

// --- Rating ------------------------------------------------------------------
// Five ladders per player: bullet (base time under 3 min), blitz (under 8
// min) and rapid (8 min and up, plus untimed) for standard chess, plus one
// ladder each for Chess960 and Crazyhouse, see ratingCategory.ts. Every
// decisive/drawn game, standalone, cage-match leg or tournament pairing,
// feeds exactly one of them: a variant game moves its variant's ladder
// whatever its time control, a standard game the ladder its time control
// belongs to. `User.rating` is the player's best of the three TIME ladders,
// kept in step here so lists/sorts that show "their rating" keep working.

export const RATING_START = 1500;

// How hard a brand-new player's first result moves their rating. With the
// schedule in getKFactor below, game 1 has K = 550, so beating an equally
// rated opponent is worth 550 * 0.5 = +275 (and losing one is -275), the
// same "placement" feel as a new lichess account. Each further game
// shrinks that bonus geometrically: roughly +208, +160, +123, +97, +77 ...
// for equal-strength wins, settling into the normal schedule by ~20 games.
const PROVISIONAL_BONUS_K = 510;
const PROVISIONAL_DECAY = 0.74;

/**
 * K-factor by games played so far (before this game). Two parts added
 * together:
 *   - an established-player base that steps down with experience
 *     (40 -> 32 -> 24 -> 16 -> 10), and
 *   - a provisional bonus that starts large and decays geometrically, so
 *     the first game swings hugely, the next few swing a lot less, and by
 *     around 20 games it has effectively vanished.
 * Not a true Glicko-2 model (no per-player uncertainty value is stored),
 * just a schedule that reproduces the same "big early swings that keep
 * shrinking" shape without any extra fields on the user.
 */
export function getKFactor(ratedGamesPlayed: number): number {
  let base: number;
  if (ratedGamesPlayed < 10) base = 40;
  else if (ratedGamesPlayed < 20) base = 32;
  else if (ratedGamesPlayed < 40) base = 24;
  else if (ratedGamesPlayed < 80) base = 16;
  else base = 10;
  return Math.round(base + PROVISIONAL_BONUS_K * PROVISIONAL_DECAY ** ratedGamesPlayed);
}

function expectedScore(myRating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - myRating) / 400));
}

export interface RatingSideUpdate {
  /** Which ladder this game moved. */
  category: RatingCategory;
  /** Rated games played in that category, after this game. */
  ratedGamesPlayed: number;
  /** How many rating points this game moved this player, positive or
   *  negative. */
  delta: number;
  /** The player's actual rating after this game, shown alongside delta so
   *  the game-over modal can read e.g. "1523 (+8)". */
  newRating: number;
}

export interface RatingUpdateResult {
  white: RatingSideUpdate;
  black: RatingSideUpdate;
}

/**
 * Applies one game's rating change to both players. Guarded by an atomic
 * flip of `ratingApplied` on the Game doc, safe to call from more than one
 * place for the same game (it is: the live game-over flow, tournament
 * withdrawal, and boot-time reconciliation can each reach a decisive
 * finish), only the first call actually moves anything. A no-op (returns
 * null) for a null (aborted/no-result) outcome, only real decisive wins
 * and draws count, or if this game already had its rating applied by a
 * previous call.
 *
 * Returns each side's new rating and delta so a caller can show the raw
 * number and change. Both players' deltas are
 * computed from a single fresh read of both ratings, then applied via
 * $inc. If the same player has two games finish within moments of each
 * other (they can have up to MAX_ACTIVE_GAMES_PER_USER active at once),
 * both deltas end up computed against a very slightly stale
 * opponent-comparison base rather than a serialized one-at-a-time update,
 * a minor, self-correcting approximation, not worth the added complexity
 * of a lock/transaction for a number that's already only an
 * approximation of skill.
 */
export async function applyRatingForGame(
  gameId: string,
  whiteId: string,
  blackId: string,
  result: "white" | "black" | "draw" | null,
): Promise<RatingUpdateResult | null> {
  if (!result) return null;

  const claimed = await Game.findOneAndUpdate(
    { _id: gameId, ratingApplied: false },
    { $set: { ratingApplied: true } },
  );
  if (!claimed) return null;
  // Odds games (each player on their own clock) are rated like any other
  // game, on the ladder of the faster of the two clocks (game.timeControl).

  const category = ratingCategoryForGame(claimed.timeControl?.baseSeconds ?? null, claimed.variant);
  const fields = "rating ratings ratedGames ratedGamesPlayed";
  const [white, black] = await Promise.all([
    User.findById(whiteId).select(fields).lean(),
    User.findById(blackId).select(fields).lean(),
  ]);
  if (!white || !black) return null;

  const whiteBase = resolveRatings(white);
  const blackBase = resolveRatings(black);
  // Games per category. A pre-split account has no per-category counts yet,
  // so fall back to its old total, which keeps its K-factor unchanged
  // instead of suddenly treating an established player as a newcomer. The
  // variant ladders never had a pre-split history, so theirs start at 0.
  const gamesIn = (u: typeof white, c: RatingCategory) =>
    u.ratedGames?.[c] ?? (isVariantCategory(c) ? 0 : (u.ratedGamesPlayed ?? 0));

  const whiteExpected = expectedScore(whiteBase[category], blackBase[category]);
  const blackExpected = 1 - whiteExpected;
  const whiteActual = result === "white" ? 1 : result === "draw" ? 0.5 : 0;
  const blackActual = 1 - whiteActual;

  const whiteDelta = Math.round(getKFactor(gamesIn(white, category)) * (whiteActual - whiteExpected));
  const blackDelta = Math.round(getKFactor(gamesIn(black, category)) * (blackActual - blackExpected));

  const applySide = async (
    id: string,
    u: typeof white,
    base: ReturnType<typeof resolveRatings>,
    delta: number,
  ) => {
    const seeded = !!u.ratings && !!u.ratedGames;
    // Does this player already have a stored rating AND game count on THIS
    // ladder? Always true for the time ladders once seeded; false for a
    // variant ladder until their first game of that variant.
    const hasLadder =
      seeded && u.ratings?.[category] !== undefined && u.ratedGames?.[category] !== undefined;
    const update = hasLadder
      ? { $inc: { [`ratings.${category}`]: delta, [`ratedGames.${category}`]: 1, ratedGamesPlayed: 1 } }
      : seeded
        ? {
            // First game on this ladder (a variant): $inc on a missing
            // field would start it from 0, so write the real starting
            // rating plus this game's change explicitly instead.
            $set: {
              [`ratings.${category}`]: base[category] + delta,
              [`ratedGames.${category}`]: gamesIn(u, category) + 1,
            },
            $inc: { ratedGamesPlayed: 1 },
          }
        : {
            // First rated game since the split: persist every ladder
            // (the time ones seeded from the old single rating, the
            // variants at their starting rating) in one go, with this
            // game's category already advanced.
            $set: {
              ratings: { ...base, [category]: base[category] + delta },
              ratedGames: {
                bullet: gamesIn(u, "bullet") + (category === "bullet" ? 1 : 0),
                blitz: gamesIn(u, "blitz") + (category === "blitz" ? 1 : 0),
                rapid: gamesIn(u, "rapid") + (category === "rapid" ? 1 : 0),
                chess960: gamesIn(u, "chess960") + (category === "chess960" ? 1 : 0),
                crazyhouse: gamesIn(u, "crazyhouse") + (category === "crazyhouse" ? 1 : 0),
              },
            },
            $inc: { ratedGamesPlayed: 1 },
          };
    const updated = await User.findByIdAndUpdate(id, update, { new: true })
      .select("rating ratings ratedGames ratedGamesPlayed")
      .lean();
    if (!updated) return null;
    // Keep the denormalized best-of-three in step. A variant game can't
    // change it (the variant ladders aren't part of it), so skip the
    // extra write and the online-rank update for those.
    if (TIME_RATING_CATEGORIES.includes(category as (typeof TIME_RATING_CATEGORIES)[number])) {
      const best = bestOfRatings(resolveRatings(updated));
      await User.updateOne({ _id: id }, { $set: { rating: best.rating, ratingCategory: best.category } });
      void updateOnlineRank(id, best.rating).catch(() => {});
    }
    return updated;
  };

  const [updatedWhite, updatedBlack] = await Promise.all([
    applySide(whiteId, white, whiteBase, whiteDelta),
    applySide(blackId, black, blackBase, blackDelta),
  ]);

  return {
    white: {
      category,
      ratedGamesPlayed: updatedWhite?.ratedGames?.[category] ?? gamesIn(white, category) + 1,
      delta: whiteDelta,
      newRating: updatedWhite ? resolveRatings(updatedWhite)[category] : whiteBase[category] + whiteDelta,
    },
    black: {
      category,
      ratedGamesPlayed: updatedBlack?.ratedGames?.[category] ?? gamesIn(black, category) + 1,
      delta: blackDelta,
      newRating: updatedBlack ? resolveRatings(updatedBlack)[category] : blackBase[category] + blackDelta,
    },
  };
}
