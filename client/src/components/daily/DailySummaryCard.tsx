import { Link } from "react-router-dom";
import { CalendarCheck, Check, ChevronRight } from "lucide-react";
import {
  useDailyChallenges,
  formatCountdown,
} from "../../hooks/useDailyChallenges.js";
import { CardRow, ProgressBar, RCoin } from "../ui/index.js";

/** A one-glance view of today's daily challenges for the dashboard. Renders
 *  nothing until loaded (or if it can't load), so it never blocks the page. */
export function DailySummaryCard() {
  const { state, fetchedAt } = useDailyChallenges();
  if (!state) return null;

  const done = state.challenges.filter((c) => c.completed).length;
  const msLeft = state.msUntilReset - (Date.now() - fetchedAt);

  return (
    <Link to="/daily" className="block">
      <CardRow highlight={!state.dayCompleted}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full " +
              (state.dayCompleted
                ? "bg-green-500/15 text-green-400"
                : "bg-(--primary)/15 text-(--primary)")
            }
          >
            {state.dayCompleted ? (
              <Check className="h-5 w-5" />
            ) : (
              <CalendarCheck className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-base-content">
              <span className="hidden md:inline-flex">Daily challenges ·</span>{" "}
              Day {state.day} of 7
            </p>
            {state.dayCompleted ? (
              <p className="truncate text-xs text-base-content/60">
                {state.weekComplete
                  ? "Week complete!"
                  : `Done! Day ${state.tomorrow?.day} unlocks in ${formatCountdown(msLeft)}.`}
              </p>
            ) : (
              <div className="mt-1.5 flex items-center gap-2">
                <ProgressBar value={done} total={3} />
                <span className="shrink-0 text-xs tabular-nums text-base-content/60">
                  {done}/3 · {formatCountdown(msLeft)} left
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-400">
            +{state.rewardToday} <RCoin size={14} />
          </span>
          <ChevronRight className="h-4 w-4 text-base-content/30" />
        </div>
      </CardRow>
    </Link>
  );
}
