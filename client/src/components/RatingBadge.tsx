import { cn } from "../lib/cn.js";
import { Badge } from "./ui/Badge.js";
import { CategoryIcon } from "./ui/TimeControlIcon.js";
import { RATING_CATEGORY_META, type RatingCategory } from "../timeControls.js";

/** A player's numeric rating, shown in a neutral badge pill. Every place
 *  that displays a rating goes through this (or a Badge directly, see
 *  GameOverModal / QuickPairing), so the treatment stays consistent.
 *  Pass `category` (bullet / blitz / rapid) to label the badge's tooltip
 *  with that ladder, and `showIcon` to draw that ladder's time-control icon
 *  right after the badge (ladders are told apart by icon, not color).
 *  Renders nothing when there's no rating to show. */
export function RatingBadge({
  rating,
  category,
  showIcon = false,
  className,
}: {
  rating?: number | null;
  category?: RatingCategory | null;
  showIcon?: boolean;
  className?: string;
}) {
  if (rating == null) return null;
  const label = category ? RATING_CATEGORY_META[category].label : null;
  const badge = (
    <Badge
      variant="neutral"
      title={label ? `${label} rating ${rating}` : `Rating ${rating}`}
      className={cn("shrink-0 px-2 py-0 tabular-nums", className)}
    >
      {rating}
    </Badge>
  );
  if (!showIcon || !category) return badge;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      {badge}
      <CategoryIcon category={category} size={14} className="text-base-content" />
    </span>
  );
}
