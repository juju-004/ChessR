import { cn } from "../lib/cn.js";
import { Badge } from "./ui/Badge.js";

/** A player's numeric rating, shown in a badge pill. Every place that
 *  displays a rating goes through this (or a Badge directly, see
 *  GameOverModal / QuickPairing), so the treatment stays consistent.
 *  Renders nothing when there's no rating to show. */
export function RatingBadge({
  rating,
  className,
}: {
  rating?: number | null;
  className?: string;
}) {
  if (rating == null) return null;
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
