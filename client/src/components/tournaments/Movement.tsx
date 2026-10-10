import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "../../lib/cn.js";

/** Arrow + number of places moved in the league table since the previous
 *  tournament. Renders nothing when there's nothing to compare against. */
export function Movement({ movement }: { movement: number | null | undefined }) {
  if (movement === null || movement === undefined) return null;
  if (movement === 0) {
    return (
      <Minus className="h-3 w-3 text-base-content/30" aria-label="No change" />
    );
  }
  const up = movement > 0;
  const n = Math.abs(movement);
  return (
    <span
      className={cn(
        "inline-flex items-center text-[11px] font-semibold",
        up ? "text-green-500" : "text-red-400",
      )}
      title={`${up ? "Up" : "Down"} ${n} ${n === 1 ? "place" : "places"}`}
    >
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {n}
    </span>
  );
}
