import type { ComponentType } from "react";
import {
  ArrowDownToLine,
  Hourglass,
  Infinity as InfinityIcon,
  Shuffle,
} from "lucide-react";
import { cn } from "@/lib/cn.js";
import { BulletGlyph, BlitzGlyph, RapidGlyph } from "./TimeControlGlyphs.js";
import {
  timeControlCategory,
  timeControlCategoryFromSeconds,
  type TimeControlCategory,
} from "../../timeControls.js";

// Bullet, blitz and rapid use the custom glyphs in TimeControlGlyphs.tsx;
// classical/unlimited keep a sensible matching pair (hourglass for a long
// game, infinity for no clock at all) so every bucket in TimeControlCategory
// has one. The two variant rating ladders sit alongside them: a shuffle for
// Chess960 (random back rank), a piece dropping onto a line for Crazyhouse.
type CategoryIconComponent = ComponentType<{
  size?: number;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

export type VariantIconCategory = "chess960" | "crazyhouse";

const CATEGORY_ICON: Record<
  TimeControlCategory | VariantIconCategory,
  CategoryIconComponent
> = {
  bullet: BulletGlyph,
  blitz: BlitzGlyph,
  rapid: RapidGlyph,
  classical: Hourglass,
  unlimited: InfinityIcon,
  chess960: Shuffle,
  crazyhouse: ArrowDownToLine,
};

export interface CategoryIconProps {
  category: TimeControlCategory | VariantIconCategory;
  size?: number;
  className?: string;
  /** Optional text-color class. The icon has no color of its own: it
   *  inherits the surrounding text color. Pass this on a colored
   *  background (e.g. the tournament headline pill) to force one. */
  monochrome?: string;
}

/** Lower-level version for callers that already have a bucketed category
 *  (e.g. CageGamePlanEditor's own legCategory, which buckets a null base
 *  as "classical" rather than "unlimited" to match the server's
 *  LegCategory type) instead of a raw baseMinutes value. */
export function CategoryIcon({
  category,
  size = 14,
  className,
  monochrome,
}: CategoryIconProps) {
  const Icon = CATEGORY_ICON[category];
  return (
    <Icon
      size={size}
      className={cn(monochrome, "shrink-0", className)}
      aria-hidden="true"
    />
  );
}

export interface TimeControlIconProps {
  /** Pass exactly one of these, whichever unit is already on hand:
   *  presets/config (CreateTournament, CageGamePlanEditor's quick-add,
   *  challenge modals) carry baseMinutes, while live game data (Dashboard,
   *  Game.tsx, Profile history) carries baseSeconds. Plain optional props
   *  rather than a discriminated union — TypeScript's `"x" in obj`
   *  narrowing doesn't reliably discriminate a union whose branches share
   *  an optional `?: never` key, which is exactly this shape. */
  baseMinutes?: number | null;
  baseSeconds?: number | null;
  size?: number;
  className?: string;
  monochrome?: string;
}

/** Bullet/blitz/rapid/classical/unlimited icon, in the surrounding text color. */
export function TimeControlIcon({
  baseMinutes,
  baseSeconds,
  size,
  className,
  monochrome,
}: TimeControlIconProps) {
  const category =
    baseMinutes !== undefined
      ? timeControlCategory(baseMinutes)
      : timeControlCategoryFromSeconds(baseSeconds ?? null);
  return (
    <CategoryIcon
      category={category}
      size={size}
      className={className}
      monochrome={monochrome}
    />
  );
}
