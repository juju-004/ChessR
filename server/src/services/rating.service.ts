import { Game } from "../models/Game.js";
import { User } from "../models/User.js";

// --- Rating ------------------------------------------------------------------
// Deliberately NOT the lichess/chess.com model of a separate rating per time
// control + variant. Every decisive/drawn game, bullet, blitz, rapid,
// classical, standard, Chess960, a standalone game, a cage-match leg, a
// tournament pairing, feeds into ONE number per player, shown as-is.

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

  const [white, black] = await Promise.all([
    User.findById(whiteId).select("rating ratedGamesPlayed").lean(),
    User.findById(blackId).select("rating ratedGamesPlayed").lean(),
  ]);
  if (!white || !black) return null;

  const whiteExpected = expectedScore(white.rating, black.rating);
  const blackExpected = 1 - whiteExpected;
  const whiteActual = result === "white" ? 1 : result === "draw" ? 0.5 : 0;
  const blackActual = 1 - whiteActual;

  const whiteDelta = Math.round(
    getKFactor(white.ratedGamesPlayed) * (whiteActual - whiteExpected),
  );
  const blackDelta = Math.round(
    getKFactor(black.ratedGamesPlayed) * (blackActual - blackExpected),
  );

  const [updatedWhite, updatedBlack] = await Promise.all([
    User.findByIdAndUpdate(
      whiteId,
      { $inc: { rating: whiteDelta, ratedGamesPlayed: 1 } },
      { new: true },
    )
      .select("rating ratedGamesPlayed")
      .lean(),
    User.findByIdAndUpdate(
      blackId,
      { $inc: { rating: blackDelta, ratedGamesPlayed: 1 } },
      { new: true },
    )
      .select("rating ratedGamesPlayed")
      .lean(),
  ]);

  return {
    white: {
      ratedGamesPlayed:
        updatedWhite?.ratedGamesPlayed ?? white.ratedGamesPlayed + 1,
      delta: whiteDelta,
      newRating: updatedWhite?.rating ?? white.rating + whiteDelta,
    },
    black: {
      ratedGamesPlayed:
        updatedBlack?.ratedGamesPlayed ?? black.ratedGamesPlayed + 1,
      delta: blackDelta,
      newRating: updatedBlack?.rating ?? black.rating + blackDelta,
    },
  };
}
