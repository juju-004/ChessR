import { Medal } from "lucide-react";
import { ordinalSuffix } from "../../api/tournaments.js";
import { cn } from "../../lib/cn.js";

const RANK_MEDAL_CLASSES: Record<number, string> = {
  1: "bg-amber-400/15 text-amber-500",
  2: "bg-slate-300/25 text-slate-400",
  3: "bg-orange-400/15 text-orange-500",
};

/** Standings row-number cell, a plain rank for 4th and below, a small
 *  colored medal icon for the top 3 so the podium reads at a glance
 *  without needing to actually count down the column. Slightly smaller on
 *  phones so the # column can stay narrow (see STANDINGS_RANK_TH). */
export function RankBadge({ rank }: { rank: number }) {
  const medalClass = RANK_MEDAL_CLASSES[rank];
  if (!medalClass) {
    return (
      <span className="flex h-5 w-5 items-center justify-center text-xs font-medium text-base-content/50 md:h-6 md:w-6 md:text-sm">
        {rank}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-full md:h-6 md:w-6",
        medalClass,
      )}
      title={`${rank}${ordinalSuffix(rank)} place`}
    >
      <Medal className="h-3 w-3 md:h-3.5 md:w-3.5" />
    </span>
  );
}

/** Header + body cell classes for the standings "#" column: tight on
 *  phones (just the badge), the old roomy width from md up. Shared so every
 *  standings table narrows the same way. The body cell has no right padding,
 *  the header's width alone sizes the column (table-fixed). */
export const STANDINGS_RANK_TH = "w-7 py-2 pl-1.5 pr-0 md:w-10 md:pl-3";
export const STANDINGS_RANK_TD = "py-2 pl-1.5 pr-0 md:pl-3";
