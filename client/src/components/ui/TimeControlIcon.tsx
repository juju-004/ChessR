import {
  Zap,
  Flame,
  Rabbit,
  Hourglass,
  Infinity as InfinityIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn.js";
import {
  timeControlCategory,
  timeControlCategoryFromSeconds,
  type TimeControlCategory,
} from "../../timeControls.js";

// Bullet's actual "fast" glyph, blitz's literal flame, and rapid's literal
// rabbit are all the icons requested; classical/unlimited get a sensible
// matching pair (hourglass for a long game, infinity for no clock at all)
// so every bucket in TimeControlCategory has one, not just the three named
// ones.
const CATEGORY_ICON: Record<TimeControlCategory, LucideIcon> = {
  bullet: Zap,
  blitz: Flame,
  rapid: Rabbit,
  classical: Hourglass,
  unlimited: InfinityIcon,
};

const CATEGORY_COLOR: Record<TimeControlCategory, string> = {
  bullet: "text-red-500",
  blitz: "text-orange-500",
  rapid: "text-green-500",
  classical: "text-blue-500",
  unlimited: "text-purple-400",
};

export interface CategoryIconProps {
  category: TimeControlCategory;
  size?: number;
  className?: string;
  /** Overrides the default per-category text color entirely (instead of
   *  appending a second text-color class alongside it, which is a real
   *  conflict here since cn() is a plain join with no Tailwind-aware
   *  merging — whichever class happens to land later in the compiled
   *  stylesheet would silently win). Pass this on a colored background
   *  (e.g. the tournament headline pill) where the category color
   *  wouldn't read well. */
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
      className={cn(monochrome ?? CATEGORY_COLOR[category], "shrink-0", className)}
      aria-hidden="true"
    />
  );
}

export type TimeControlIconProps = {
  size?: number;
  className?: string;
  monochrome?: string;
} & (
  | { baseMinutes: number | null; baseSeconds?: never }
  | { baseSeconds: number | null; baseMinutes?: never }
);

/** Bullet/blitz/rapid/classical/unlimited icon, colored per category. Pass
 *  whichever unit is already on hand: presets/config (CreateTournament,
 *  CageGamePlanEditor's quick-add, challenge modals) carry baseMinutes,
 *  while live game data (Dashboard, Game.tsx, Profile history) carries
 *  baseSeconds. */
export function TimeControlIcon({
  size,
  className,
  monochrome,
  ...tc
}: TimeControlIconProps) {
  const category =
    "baseMinutes" in tc
      ? timeControlCategory(tc.baseMinutes)
      : timeControlCategoryFromSeconds(tc.baseSeconds);
  return (
    <CategoryIcon
      category={category}
      size={size}
      className={className}
      monochrome={monochrome}
    />
  );
}
