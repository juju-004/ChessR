import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Flame, Lock, PartyPopper, Trophy } from "lucide-react";
import {
  useDailyChallenges,
  formatCountdown,
} from "../hooks/useDailyChallenges.js";
import { ChallengeIcon } from "../components/daily/ChallengeIcon.js";
import { PageError } from "../components/PageError.js";
import { cn } from "../lib/cn.js";
import {
  Page,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  RCoin,
  ListCard,
  ProgressBar,
  CenteredSpinner,
} from "../components/ui/index.js";

/** Re-renders every 30s so the reset countdown stays honest. */
function useTick(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** The week strip. On phones each day keeps a readable minimum width and the
 *  strip scrolls sideways instead of squeezing seven cards into the screen;
 *  from `sm` up all seven fit in a grid. On mount (and whenever the active day
 *  changes) it scrolls, inside the strip only, never the page, so the active
 *  day is in view, and only if it isn't already. */
function WeekStrip({
  week,
  activeDay,
}: {
  week: Array<{
    day: number;
    status: "done" | "today" | "upcoming";
    reward: number;
    bonus: number;
  }>;
  /** The day to bring into view: today, or the last finished day once the
   *  week is complete. */
  activeDay: number;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const el = strip.querySelector<HTMLElement>(`[data-day="${activeDay}"]`);
    if (!el) return;
    const left = el.offsetLeft - strip.offsetLeft;
    const right = left + el.offsetWidth;
    const fullyVisible =
      left >= strip.scrollLeft && right <= strip.scrollLeft + strip.clientWidth;
    if (fullyVisible) return;
    strip.scrollTo({
      left: left - (strip.clientWidth - el.offsetWidth) / 2,
      behavior: "smooth",
    });
  }, [activeDay]);

  return (
    <div
      ref={stripRef}
      className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-7 sm:overflow-visible sm:px-0 sm:pb-0"
    >
      {week.map((d) => (
        <div
          key={d.day}
          data-day={d.day}
          className={cn(
            "flex min-w-[4.5rem] shrink-0 flex-1 snap-center flex-col items-center gap-1 rounded-xl border px-1 py-2 text-center transition-colors sm:min-w-0 sm:shrink",
            d.status === "done" && "border-green-500/40 bg-green-500/10",
            d.status === "today" && "border-(--primary) bg-(--primary)/10",
            d.status === "upcoming" && "border-base-300 bg-base-100/40",
          )}
        >
          <span className="text-[10px] font-medium uppercase text-base-content/50">
            Day {d.day}
          </span>
          <span className="flex h-6 items-center justify-center">
            {d.status === "done" ? (
              <Check className="h-5 w-5 text-green-400" />
            ) : d.status === "today" ? (
              <Flame className="h-5 w-5 text-(--primary)" />
            ) : d.day === 7 ? (
              <Trophy className="h-5 w-5 text-base-content/30" />
            ) : (
              <Lock className="h-4 w-4 text-base-content/30" />
            )}
          </span>
          <span
            className={cn(
              "text-xs font-semibold tabular-nums",
              d.status === "upcoming"
                ? "text-base-content/50"
                : "text-base-content",
            )}
          >
            +{d.reward + d.bonus}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The Daily challenges page: three challenges a day for seven days, each day
 *  harder and better paid than the last. Miss a day and the week starts over. */
export function DailyChallenges() {
  const { state, error, fetchedAt } = useDailyChallenges();
  const now = useTick();

  if (!state) {
    return (
      <Page title="Daily challenges" back="/">
        {error ? (
          <PageError message={error} />
        ) : (
          <CenteredSpinner className="py-16" />
        )}
      </Page>
    );
  }

  const msLeft = state.msUntilReset - (now - fetchedAt);
  const doneCount = state.challenges.filter((c) => c.completed).length;
  const urgent = !state.dayCompleted && msLeft < 3 * 3600_000;
  const activeDay =
    state.week.find((d) => d.status === "today")?.day ??
    [...state.week].reverse().find((d) => d.status === "done")?.day ??
    1;

  return (
    <Page
      title="Daily challenges"
      description="Finish 3 a day for 7 days. Each day is harder and pays more. Miss a day and you start over."
      responsiveDescription
      back="/"
    >
      <div className="space-y-4">
        {state.resetNotice && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <p className="font-medium">Your week started over</p>
            <p className="mt-0.5 text-amber-200/80">
              You missed a day, so you're back on Day 1
              {state.resetNotice.fromDay > 1
                ? ` (you had reached Day ${state.resetNotice.fromDay})`
                : ""}
              . Finish every day this time to reach the big rewards.
            </p>
          </div>
        )}

        {/* ---- where you are --------------------------------------------- */}
        <Card variant="solid">
          <CardContent className="space-y-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-base-content/50">
                  {state.weekComplete
                    ? "Week complete"
                    : `Day ${state.day} of 7`}
                </p>
                <p className="mt-0.5 text-2xl font-bold text-base-content">
                  {state.dayCompleted
                    ? "Done for today"
                    : `${doneCount}/3 done`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-base-content/50">
                  {state.dayCompleted ? "Earned today" : "Today's reward"}
                </p>
                <p className="inline-flex items-center gap-1 text-2xl font-bold text-amber-400">
                  +{state.rewardToday} <RCoin size={20} />
                </p>
              </div>
            </div>

            <WeekStrip week={state.week} activeDay={activeDay} />
          </CardContent>
        </Card>

        {/* ---- finished states -------------------------------------------- */}
        {state.dayCompleted && (
          <Card variant="solid">
            <CardContent className="flex items-center gap-3 py-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-500/15 text-green-400">
                <PartyPopper className="h-5 w-5" />
              </span>
              <div className="min-w-0 text-sm">
                {state.weekComplete ? (
                  <>
                    <p className="font-semibold text-base-content">
                      You finished the whole week!
                    </p>
                    <p className="text-base-content/60">
                      A fresh week starts tomorrow in {formatCountdown(msLeft)}.
                      Come back for Day 1.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-base-content">
                      Day {state.day} complete!
                    </p>
                    <p className="inline-flex flex-wrap items-center gap-x-1 text-base-content/60">
                      Come back in {formatCountdown(msLeft)} for Day{" "}
                      {state.tomorrow?.day}, worth{" "}
                      <span className="inline-flex items-center gap-0.5 font-medium text-amber-400">
                        {state.tomorrow?.reward} <RCoin size={12} />
                      </span>
                      . Skip it and the week starts over.
                    </p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ---- today's challenges ------------------------------------------ */}
        <ListCard
          title="Today's challenges"
          actions={
            !state.dayCompleted ? (
              <Badge variant={urgent ? "error" : "neutral"}>
                {urgent ? "Ends in " : "Resets in "}
                {formatCountdown(msLeft)}
              </Badge>
            ) : undefined
          }
        >
          {state.challenges.map((c) => (
            <div
              key={c.id}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors",
                c.completed
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-base-300 bg-base-100/60",
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  c.completed
                    ? "bg-green-500/15 text-green-400"
                    : "bg-(--primary)/15 text-(--primary)",
                )}
              >
                {c.completed ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <ChallengeIcon icon={c.icon} className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    c.completed
                      ? "text-base-content/60 line-through"
                      : "text-base-content",
                  )}
                >
                  {c.title}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <ProgressBar
                    value={c.progress}
                    total={c.target}
                    highlight={!c.completed}
                  />
                  <span className="shrink-0 text-xs tabular-nums text-base-content/50">
                    {c.progress}/{c.target}
                  </span>
                </div>
              </div>
              {!c.completed && (
                <Link to={c.link} className="shrink-0">
                  <Button size="sm" variant="glass">
                    Go
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </ListCard>

        {/* ---- your record -------------------------------------------------- */}
        <Card variant="solid">
          <CardHeader>
            <CardTitle>Your record</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Current streak"
              value={`${state.streak} ${state.streak === 1 ? "day" : "days"}`}
            />
            <Stat
              label="Best streak"
              value={`${state.bestStreak} ${state.bestStreak === 1 ? "day" : "days"}`}
            />
            <Stat label="Weeks finished" value={String(state.weeksCompleted)} />
            <Stat
              label="Total earned"
              value={
                <span className="inline-flex items-center gap-1">
                  {state.totalEarned} <RCoin size={14} />
                </span>
              }
            />
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-base-content/50">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-base-content">{value}</p>
    </div>
  );
}
