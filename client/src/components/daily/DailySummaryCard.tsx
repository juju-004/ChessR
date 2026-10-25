import { Link } from "react-router-dom";
import { CalendarCheck, Check, ChevronRight } from "lucide-react";
import {
  useDailyChallenges,
  formatCountdown,
} from "../../hooks/useDailyChallenges.js";
import { Card, RCoin } from "../ui/index.js";
import { cn } from "../../lib/cn.js";

/** A one-glance view of today's daily challenges for the dashboard. Renders
 *  nothing until loaded (or if it can't load), so it never blocks the page.
 *
 *  Built as a full `Card` (same surface, radius and padding as the balance
 *  card and quick-link tiles around it) rather than a bare `CardRow`, which
 *  is a "card inside a card" row and looked unstyled sitting directly on the
 *  page. Progress is three segments, one per challenge, so "2 of 3" reads at
 *  a glance without parsing text. */
export function DailySummaryCard() {
  const { state, fetchedAt } = useDailyChallenges();
  if (!state) return null;

  const total = state.challenges.length || 3;
  const done = state.challenges.filter((c) => c.completed).length;
  const msLeft = state.msUntilReset - (Date.now() - fetchedAt);
  const complete = state.dayCompleted;

  return (
    <Link to="/daily" className="block">
      <Card
        variant="solid"
        interactive
        className={cn("flex items-center gap-3.5", !complete && "border-(--primary)/30")}
      >
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
            complete
              ? "bg-green-500/15 text-green-400"
              : "bg-(--primary)/15 text-(--primary)",
          )}
        >
          {complete ? (
            <Check className="h-5 w-5" />
          ) : (
            <CalendarCheck className="h-5 w-5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold text-base-content">
              Daily challenges
            </p>
            <span className="shrink-0 text-xs font-medium text-base-content/50">
              Day {state.day} of 7
            </span>
          </div>

          <div className="mt-2 flex items-center gap-1">
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  i < done
                    ? complete
                      ? "bg-green-400"
                      : "bg-(--primary)"
                    : "bg-base-300",
                )}
              />
            ))}
          </div>

          <p className="mt-1.5 truncate text-xs text-base-content/60">
            {complete
              ? state.weekComplete
                ? "Week complete!"
                : `Done! Day ${state.tomorrow?.day} unlocks in ${formatCountdown(msLeft)}`
              : `${done}/${total} done · ${formatCountdown(msLeft)} left`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2.5 py-1 text-sm font-semibold text-amber-400 tabular-nums">
            +{state.rewardToday} <RCoin size={14} />
          </span>
          <ChevronRight className="h-4 w-4 text-base-content/30" />
        </div>
      </Card>
    </Link>
  );
}
