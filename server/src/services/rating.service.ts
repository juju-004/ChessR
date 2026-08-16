import { Game } from "../models/Game.js";
import { User } from "../models/User.js";

// --- Hidden rating -----------------------------------------------------------
// Deliberately NOT the lichess/chess.com model of a separate rating per time
// control + variant. Every decisive/drawn game — bullet, blitz, rapid,
// classical, standard, Chess960, a standalone game, a cage-match leg, a
// tournament pairing — feeds into ONE number per player. The player never
// sees this number directly; only the tier name it maps to (see
// getRatingCategory below) is ever shown.

export const RATING_START = 1500;

// Below this many rated games, a player's tier reads as "Unranked" no
// matter what their hidden rating actually is — not enough data yet for the
// number to mean anything, and showing a tier this early is exactly what
// let a player who's only beaten a couple of weaker opponents rocket to a
// misleadingly high badge.
export const PROVISIONAL_GAMES_THRESHOLD = 15;

/**
 * K-factor by games played so far (before this game) — this is the
 * "large swings at first, settling down later" behavior. Not a true
 * Glicko-2 rating-deviation model (no separate uncertainty value tracked
 * per player), just a bucketed K-factor schedule that approximates the same
 * shape: a brand-new player's rating can swing up to 40 points off a single
 * result, a well-established one (80+ rated games) moves by at most 10.
 */
function getKFactor(ratedGamesPlayed: number): number {
  if (ratedGamesPlayed < 10) return 40;
  if (ratedGamesPlayed < 20) return 32;
  if (ratedGamesPlayed < 40) return 24;
  if (ratedGamesPlayed < 80) return 16;
  return 10;
}

function expectedScore(myRating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - myRating) / 400));
}

export interface RatingSideUpdate {
  previousCategory: string | null;
  newCategory: string | null;
  ratedGamesPlayed: number;
}

export interface RatingUpdateResult {
  white: RatingSideUpdate;
  black: RatingSideUpdate;
}

/**
 * Applies one game's rating change to both players. Guarded by an atomic
 * flip of `ratingApplied` on the Game doc — safe to call from more than one
 * place for the same game (it is: the live game-over flow, tournament
 * withdrawal, and boot-time reconciliation can each reach a decisive
 * finish), only the first call actually moves anything. A no-op (returns
 * null) for a null (aborted/no-result) outcome — only real decisive wins
 * and draws count — or if this game already had its rating applied by a
 * previous call.
 *
 * Returns each side's tier category before and after the game (not the raw
 * rating), so a caller can show a "you just ranked up to X" moment without
 * ever exposing the hidden number itself. Both players' deltas are
 * computed from a single fresh read of both ratings, then applied via
 * $inc. If the same player has two games finish within moments of each
 * other (they can have up to MAX_ACTIVE_GAMES_PER_USER active at once),
 * both deltas end up computed against a very slightly stale
 * opponent-comparison base rather than a serialized one-at-a-time update —
 * a minor, self-correcting approximation, not worth the added complexity
 * of a lock/transaction for a hidden number that's already only an
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

  const whiteDelta = Math.round(getKFactor(white.ratedGamesPlayed) * (whiteActual - whiteExpected));
  const blackDelta = Math.round(getKFactor(black.ratedGamesPlayed) * (blackActual - blackExpected));

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
      previousCategory: getRatingCategory(white.rating, white.ratedGamesPlayed),
      newCategory: updatedWhite
        ? getRatingCategory(updatedWhite.rating, updatedWhite.ratedGamesPlayed)
        : null,
      ratedGamesPlayed: updatedWhite?.ratedGamesPlayed ?? white.ratedGamesPlayed + 1,
    },
    black: {
      previousCategory: getRatingCategory(black.rating, black.ratedGamesPlayed),
      newCategory: updatedBlack
        ? getRatingCategory(updatedBlack.rating, updatedBlack.ratedGamesPlayed)
        : null,
      ratedGamesPlayed: updatedBlack?.ratedGamesPlayed ?? black.ratedGamesPlayed + 1,
    },
  };
}

// --- Public-facing tier ladder ------------------------------------------------
// Ordered low to high; `min` is inclusive and the top tier has no ceiling.
// Purely cosmetic — tweak freely, it's read fresh from the hidden rating
// every time rather than stored, so there's nothing to migrate.
export interface RatingTier {
  name: string;
  min: number;
}

export const RATING_TIERS: RatingTier[] = [
  { name: "Novice", min: 0 },
  { name: "Beginner", min: 1100 },
  { name: "Apprentice", min: 1250 },
  { name: "Intermediate", min: 1400 },
  { name: "Proficient", min: 1550 },
  { name: "Advanced", min: 1700 },
  { name: "Expert", min: 1850 },
  { name: "Master", min: 2000 },
  { name: "Grandmaster", min: 2150 },
  { name: "Elite", min: 2300 },
  { name: "Elite II", min: 2450 },
  { name: "Elite III", min: 2600 },
];

/** The tier name to actually show for a player, or null for "Unranked"
 *  (fewer than PROVISIONAL_GAMES_THRESHOLD rated games so far). */
export function getRatingCategory(rating: number, ratedGamesPlayed: number): string | null {
  if (ratedGamesPlayed < PROVISIONAL_GAMES_THRESHOLD) return null;
  let current = RATING_TIERS[0].name;
  for (const tier of RATING_TIERS) {
    if (rating >= tier.min) current = tier.name;
    else break;
  }
  return current;
}

/** How many more rated games until a tier first appears — 0 once already
 *  past the threshold. Client-friendly framing for the "Unranked" state
 *  ("4 games until your rank is calculated") instead of just a boolean. */
export function gamesUntilRanked(ratedGamesPlayed: number): number {
  return Math.max(0, PROVISIONAL_GAMES_THRESHOLD - ratedGamesPlayed);
}
