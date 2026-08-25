import {
  HelpCircle,
  Sprout,
  Leaf,
  BookOpen,
  Compass,
  Target,
  Flame,
  Star,
  Award,
  Trophy,
  Crown,
  Gem,
  Sparkles,
} from "lucide-react";
import { Badge, BADGE_VARIANT_CLASSES, type BadgeVariant } from "./ui/index.js";
import { cn } from "../lib/cn.js";

// Purely cosmetic, color/icon per tier name. Mirrors the tier ladder in
// the server's rating.service.ts (RATING_TIERS), but the server is the
// only source of truth for where the actual rating thresholds sit; this
// just needs the names to match so every tier gets its own look instead of
// falling through to a generic default. Each tier gets a distinct icon,
// escalating in "weight" alongside the color as the ladder climbs.
const TIER_STYLE: Record<string, { variant: BadgeVariant; icon: typeof Star }> = {
  Novice: { variant: "neutral", icon: Sprout },
  Beginner: { variant: "secondary", icon: Leaf },
  Apprentice: { variant: "secondary", icon: BookOpen },
  Intermediate: { variant: "primary", icon: Compass },
  Proficient: { variant: "primary", icon: Target },
  Advanced: { variant: "success", icon: Flame },
  Expert: { variant: "success", icon: Star },
  Master: { variant: "warning", icon: Award },
  Grandmaster: { variant: "warning", icon: Trophy },
  Elite: { variant: "gradient", icon: Crown },
  "Elite II": { variant: "gradient", icon: Gem },
  "Elite III": { variant: "gradient", icon: Sparkles },
};
const UNRANKED_STYLE = { variant: "neutral" as BadgeVariant, icon: HelpCircle };

/** `category` is exactly what the server sent, null means "Unranked"
 *  (fewer than the provisional-game threshold played so far), never an
 *  empty string. Pass `gamesUntilRanked` (from the same API response) to
 *  get a helpful tooltip on the Unranked state instead of a bare label.
 *  `compact` renders just the tier's icon in a small circle (title
 *  attribute carries the tier name) instead of a full icon+text pill, 
 *  for tight spots like the in-game player panels, where a text badge
 *  would crowd the clock and username off an already-narrow row. */
export function RatingBadge({
  category,
  gamesUntilRanked,
  compact = false,
  className,
}: {
  category: string | null;
  gamesUntilRanked?: number;
  compact?: boolean;
  className?: string;
}) {
  const style = category ? (TIER_STYLE[category] ?? UNRANKED_STYLE) : UNRANKED_STYLE;
  const Icon = style.icon;
  const label = category ?? "Unranked";
  const title = !category
    ? gamesUntilRanked
      ? `Unranked: ${gamesUntilRanked} more rated game${gamesUntilRanked === 1 ? "" : "s"} until your rank is calculated`
      : "Unranked"
    : label;

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

  return (
    <Badge variant={style.variant} className={className} title={!category ? title : undefined}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}
