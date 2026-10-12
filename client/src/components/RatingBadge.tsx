import { cn } from "../lib/cn.js";
import { Badge } from "./ui/Badge.js";
import { RATING_CATEGORY_META, type RatingCategory } from "../timeControls.js";

/** A player's numeric rating, shown in a badge pill. Every place that
 *  displays a rating goes through this (or a Badge directly, see
 *  GameOverModal / QuickPairing), so the treatment stays consistent.
 *  Pass `category` (bullet / blitz / rapid) to color it like that ladder's
 *  time-control icon (red / orange / blue); without one it stays neutral.
 *  Renders nothing when there's no rating to show. */
export function RatingBadge({
  rating,
  category,
  className,
}: {
  rating?: number | null;
  category?: RatingCategory | null;
  className?: string;
}) {
  if (rating == null) return null;
  const meta = category ? RATING_CATEGORY_META[category] : null;
  if (!meta) {
    return (
      <Badge
        variant="neutral"
        title={`Rating ${rating}`}
        className={cn("shrink-0 px-2 py-0 tabular-nums", className)}
      >
        {rating}
      </Badge>
    );
  }
  return (
    <span
      title={`${meta.label} rating ${rating}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0 text-xs font-semibold tabular-nums",
        meta.badge,
        className,
      )}
    >
      {rating}
    </span>
  );
}
