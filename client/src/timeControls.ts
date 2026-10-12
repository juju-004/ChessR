export interface TimeControlOption {
  label: string;
  baseMinutes: number | null;
  incrementSeconds: number;
}

// Single source of truth for every time-control select in the app (game
// creation, tournament creation, cage match leg editor, etc). Previously
// three near-identical lists had drifted out of sync (different bullet/
// blitz presets, tournament creation missing "Unlimited", the cage match
// editor missing "Hyper Bullet"/"Bullet · 2+1"/the two Rapid variants),
// this is now the one list every page imports, so a preset added or
// changed here shows up everywhere consistently.
export const TIME_CONTROLS: TimeControlOption[] = [
  { label: "Hyper Bullet · ½+0", baseMinutes: 0.5, incrementSeconds: 0 },
  { label: "Bullet · 1+0", baseMinutes: 1, incrementSeconds: 0 },
  { label: "Bullet · 2+1", baseMinutes: 2, incrementSeconds: 1 },
  { label: "Blitz · 3+0", baseMinutes: 3, incrementSeconds: 0 },
  { label: "Blitz · 3+2", baseMinutes: 3, incrementSeconds: 2 },
  { label: "Blitz · 5+0", baseMinutes: 5, incrementSeconds: 0 },
  { label: "Rapid · 8+0", baseMinutes: 8, incrementSeconds: 0 },
  { label: "Rapid · 10+0", baseMinutes: 10, incrementSeconds: 0 },
  { label: "Rapid · 10+5", baseMinutes: 10, incrementSeconds: 5 },
  { label: "Rapid · 15+10", baseMinutes: 15, incrementSeconds: 10 },
  { label: "Classical · 30+0", baseMinutes: 30, incrementSeconds: 0 },
  { label: "Unlimited", baseMinutes: null, incrementSeconds: 0 },
];

export function formatTimeControl(tc: {
  baseSeconds: number | null;
  incrementSeconds: number;
}): string {
  if (tc.baseSeconds === null) return "Unlimited";
  // Under a minute (Hyper Bullet is 30s): Math.round(0.5) would print it as
  // "1+0", so show the half-minute / seconds form instead.
  if (tc.baseSeconds === 30) return `½+${tc.incrementSeconds}`;
  if (tc.baseSeconds < 60) return `${tc.baseSeconds}s+${tc.incrementSeconds}`;
  return `${Math.round(tc.baseSeconds / 60)}+${tc.incrementSeconds}`;
}

// Same bullet/blitz/rapid/classical buckets used for category labels
// elsewhere (rating ladder, cage match badges), reused here so a game's
// piece-slide speed matches the pace of the time control it's actually
// played at, rather than one fixed duration for every game. Faster time
// controls get snappier, more immediate-feeling animation; slower ones get
// a more deliberate, easier-to-follow one.
export function animationDurationForTimeControl(
  baseSeconds: number | null,
): number {
  if (baseSeconds === null) return 220; // unlimited/correspondence, treat as classical
  const baseMinutes = baseSeconds / 60;
  // Bullet: David found piece animation actively hurt at this speed —
  // 0 here means "no animation" (see the animationEnabled derivation in
  // Game.tsx, which treats a 0 duration as disabling animation outright
  // rather than asking chessground to animate over 0ms).
  if (baseMinutes < 3) return 0; // bullet, instant
  if (baseMinutes < 5) return 50; // blitz, still snappy but not zero
  if (baseMinutes < 10) return 120; // blitz, still snappy but not zero
  if (baseMinutes < 30) return 150; // rapid
  return 220; // classical, normal, slower
}

export type TimeControlCategory =
  | "bullet"
  | "blitz"
  | "rapid"
  | "classical"
  | "unlimited";

// Single source of truth for the bullet/blitz/rapid/classical/unlimited
// bucketing, same thresholds as animationDurationForTimeControl above and
// CageGamePlanEditor's legCategory (which can't reuse this directly since
// the server's LegCategory type has no "unlimited" bucket and treats a
// null base as classical instead). Used to pick the icon/color shown next
// to a time control everywhere else in the app (see
// components/ui/TimeControlIcon.tsx).
export function timeControlCategory(
  baseMinutes: number | null,
): TimeControlCategory {
  if (baseMinutes === null) return "unlimited";
  // Base minutes only (the increment is ignored). Same lines the rating
  // ladders use (see ratingCategoryForSeconds below), so a game's icon color
  // always matches the rating it moves. Rated as rapid from 8 minutes up;
  // 20+ shows as classical here but still counts on the rapid ladder.
  if (baseMinutes < 3) return "bullet";
  if (baseMinutes < 8) return "blitz";
  if (baseMinutes < 20) return "rapid";
  return "classical";
}

// Same bucketing, for the many call sites (live game data, Profile/
// Dashboard history rows) that carry baseSeconds rather than a preset's
// baseMinutes.
export function timeControlCategoryFromSeconds(
  baseSeconds: number | null,
): TimeControlCategory {
  return timeControlCategory(baseSeconds === null ? null : baseSeconds / 60);
}

// --- Rating ladders ----------------------------------------------------------
// Three ratings per player. Which one a game moves depends on its base time
// only (never the increment): bullet < 3 min, blitz < 8 min, rapid 8 min and
// up (classical and untimed included). Mirrors server/src/services/ratingCategory.ts.
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

/** Per-ladder styling, the same red / orange / blue the time-control icons
 *  use (see components/ui/TimeControlIcon.tsx). Full class names so Tailwind
 *  can see them. */
export const RATING_CATEGORY_META: Record<
  RatingCategory,
  { label: string; badge: string; text: string }
> = {
  bullet: { label: "Bullet", badge: "bg-red-500/15 text-red-500", text: "text-red-500" },
  blitz: { label: "Blitz", badge: "bg-orange-500/15 text-orange-500", text: "text-orange-500" },
  rapid: { label: "Rapid", badge: "bg-blue-500/15 text-blue-500", text: "text-blue-500" },
};

