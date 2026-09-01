import { useState } from "react";
import {
  HelpCircle,
  Sprout,
  Leaf,
  BookOpen,
  Compass,
  Target,
  Flame,
  Star,
  Crown,
  Gem,
} from "lucide-react";
import {
  Badge,
  Popover,
  BADGE_VARIANT_CLASSES,
  type BadgeVariant,
} from "./ui/index.js";
import { HelpTip } from "./HelpTip.js";
import { useRatingTiers } from "../hooks/useRatingTiers.js";
import { getMyRatingProgress, type MyRatingProgress } from "../api/users.js";
import { cn } from "../lib/cn.js";

// Purely cosmetic, color/icon per tier name. Mirrors the tier ladder in
// the server's rating.service.ts (RATING_TIERS), but the server is the
// only source of truth for where the actual rating thresholds sit; this
// just needs the names to match so every tier gets its own look instead of
// falling through to a generic default. Each tier gets a distinct icon,
// escalating in "weight" alongside the color as the ladder climbs.
const TIER_STYLE: Record<string, { variant: BadgeVariant; icon: typeof Star }> =
  {
    Novice: { variant: "neutral", icon: Sprout },
    Beginner: { variant: "secondary", icon: Leaf },
    Apprentice: { variant: "secondary", icon: BookOpen },
    Intermediate: { variant: "primary", icon: Compass },
    Advanced: { variant: "success", icon: Flame },
    Expert: { variant: "success", icon: Star },
    Master: { variant: "warning", icon: Target },
    Elite: { variant: "gradient", icon: Crown },
    "Super Elite": { variant: "gradient", icon: Gem },
  };
const UNRANKED_STYLE = { variant: "neutral" as BadgeVariant, icon: HelpCircle };

type NextTierProgress = MyRatingProgress["pointsToNextTier"];

/** Popover body for the "how far to the next rank" click, shared by both
 *  the static (game-over modal, value already known) and fetched
 *  (profile page, fetched on open) paths. */
function RatingProgressContent({
  category,
  gamesUntilRanked,
  pointsToNextTier,
  loading,
}: {
  category: string | null;
  gamesUntilRanked?: number;
  pointsToNextTier: NextTierProgress;
  loading: boolean;
}) {
  return (
    <div className="max-w-56 p-1.5 text-xs leading-relaxed text-base-content/70">
      {loading ? (
        <p>Loading…</p>
      ) : !category ? (
        <p>
          Unranked — {gamesUntilRanked ?? 0} more rated game
          {(gamesUntilRanked ?? 0) === 1 ? "" : "s"} until your rank is
          calculated.
        </p>
      ) : pointsToNextTier ? (
        <p>
          <span className="font-semibold text-base-content">
            {pointsToNextTier.points}
          </span>{" "}
          point{pointsToNextTier.points === 1 ? "" : "s"} to{" "}
          <span className="font-semibold text-base-content">
            {pointsToNextTier.nextTierName}
          </span>
          .
        </p>
      ) : (
        <p>You've reached the top tier.</p>
      )}
    </div>
  );
}

/** `category` is exactly what the server sent, null means "Unranked"
 *  (fewer than the provisional-game threshold played so far), never an
 *  empty string. Pass `gamesUntilRanked` (from the same API response) to
 *  get a helpful tooltip on the Unranked state instead of a bare label.
 *  `compact` renders just the tier's icon in a small circle (title
 *  attribute carries the tier name) instead of a full icon+text pill,
 *  for tight spots like the in-game player panels, where a text badge
 *  would crowd the clock and username off an already-narrow row.
 *
 *  `showProgress` makes the (non-compact) badge clickable, opening a
 *  popover with how many points stand between here and the next tier.
 *  Pass `pointsToNextTier` when you already have the value (the
 *  game-over modal gets it for free off the game's own rating update) so
 *  no request is made; leave it out and opening the popover fetches the
 *  signed-in user's own progress (the profile page's badge does this).
 *  That fetch is self-only server-side, so only turn this on for the
 *  signed-in user's own badge, never someone else's profile. */
export function RatingBadge({
  category,
  gamesUntilRanked,
  compact = false,
  className,
  showProgress = false,
  pointsToNextTier: pointsToNextTierProp,
}: {
  category: string | null;
  gamesUntilRanked?: number;
  compact?: boolean;
  className?: string;
  showProgress?: boolean;
  pointsToNextTier?: NextTierProgress;
}) {
  const style = category
    ? (TIER_STYLE[category] ?? UNRANKED_STYLE)
    : UNRANKED_STYLE;
  const Icon = style.icon;
  const label = category ?? "Unranked";
  const title = !category
    ? gamesUntilRanked
      ? `Unranked: ${gamesUntilRanked} more rated game${gamesUntilRanked === 1 ? "" : "s"} until your rank is calculated`
      : "Unranked"
    : label;

  const hasStaticValue = pointsToNextTierProp !== undefined;
  const [fetched, setFetched] = useState<MyRatingProgress | null>(null);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(open: boolean) {
    if (!open || hasStaticValue || fetched || loading) return;
    setLoading(true);
    getMyRatingProgress()
      .then(setFetched)
      .catch(() =>
        setFetched({
          ratingCategory: category,
          ratedGamesUntilRanked: gamesUntilRanked ?? 0,
          pointsToNextTier: null,
        }),
      )
      .finally(() => setLoading(false));
  }

  if (compact) {
    return (
      <span
        title={title}
        className={cn(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
          BADGE_VARIANT_CLASSES[style.variant],
          className,
        )}
      >
        <Icon className="h-2.5 w-2.5" />
      </span>
    );
  }

  const badge = (
    <Badge
      variant={style.variant}
      className={cn(showProgress && "cursor-pointer", className)}
      title={!showProgress && !category ? title : undefined}
    >
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );

  if (!showProgress) return badge;

  return (
    <Popover align="start" onOpenChange={handleOpenChange} trigger={badge}>
      <RatingProgressContent
        category={
          hasStaticValue ? category : (fetched?.ratingCategory ?? category)
        }
        gamesUntilRanked={
          hasStaticValue
            ? gamesUntilRanked
            : (fetched?.ratedGamesUntilRanked ?? gamesUntilRanked)
        }
        pointsToNextTier={
          hasStaticValue
            ? (pointsToNextTierProp ?? null)
            : (fetched?.pointsToNextTier ?? null)
        }
        loading={loading && !hasStaticValue}
      />
    </Popover>
  );
}

/** A "?" help tip meant to sit right after a (non-compact) RatingBadge,
 *  listing every tier and the hidden-rating range it covers, e.g.
 *  "1400-1549 Intermediate". Ranges are computed from the same
 *  server-sourced tier list RatingBadge's colors/icons are keyed off of
 *  (see useRatingTiers), never hardcoded here, so this can't silently
 *  drift from RATING_TIERS the way a copy-pasted number would. */
export function RatingTierHelpTip() {
  const tiers = useRatingTiers();

  return (
    <HelpTip>
      <p className="mb-2 font-semibold text-base-content/80">Rank tiers</p>
      {!tiers ? (
        <p>Loading…</p>
      ) : (
        <ul className="space-y-1">
          {tiers.map((tier, i) => {
            const style = TIER_STYLE[tier.name] ?? UNRANKED_STYLE;
            const Icon = style.icon;
            const nextMin = tiers[i + 1]?.min;
            const range = nextMin
              ? `${tier.min}-${nextMin - 1}`
              : `${tier.min}+`;
            return (
              <li key={tier.name} className="flex items-center gap-1.5">
                <Icon className="h-3 w-3 shrink-0" />
                <span className="tabular-nums text-base-content/60">
                  {range}
                </span>
                <span className="font-medium">{tier.name}</span>
              </li>
            );
          })}
        </ul>
      )}
    </HelpTip>
  );
}
