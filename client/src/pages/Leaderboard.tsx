import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import {
  getPastSeasons,
  getSeasonLeaderboard,
  type PastSeason,
  type SeasonBoard,
  type SeasonLeaderboard,
  type SeasonRow,
} from "../api/seasonLeaderboard.js";
import { PageError } from "../components/PageError.js";
import { HelpTip } from "../components/HelpTip.js";
import { cn } from "../lib/cn.js";
import {
  Page,
  Card,
  CardContent,
  Avatar,
  Badge,
  RCoin,
  CenteredSpinner,
} from "../components/ui/index.js";

const errMsg = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong";

function formatLeft(ms: number): string {
  if (ms <= 0) return "Ending now";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

/** Clock icon with a minute hand that sweeps round forever (see
 *  .clock-hand-sweep in index.css), so the season countdown visibly runs. */
function RunningClock({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 12l3.5 2" />
      <path d="M12 12V6" className="clock-hand-sweep" />
    </svg>
  );
}

const fmtPoints = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

/** Each board shows at most this many rows (the server caps it too). */
const BOARD_LIMIT = 20;

const minGamesText = (n: number) =>
  `Play at least ${n} games this season to be eligible for a prize.`;

const BOARDS: { key: SeasonBoard; title: string }[] = [
  { key: "games", title: "Most games played" },
  { key: "points", title: "Most points" },
];

/** Width of the right-hand stat columns, shared by the header strip and the
 *  rows so the numbers line up exactly. */
const STAT_COL = "w-9 sm:w-10";

/** One compact stat pill. Fixed width + tabular numbers keep a column of
 *  them visually aligned from the first row to the last. */
function StatPill({
  value,
  suffix,
  tone,
  title,
}: {
  value: number;
  suffix: string;
  tone: "win" | "draw";
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        STAT_COL,
        "inline-flex items-baseline justify-center gap-px rounded-md px-0.5 py-px text-sm font-semibold tabular-nums leading-tight",
        tone === "win"
          ? "bg-emerald-500/12 text-emerald-500"
          : "bg-amber-500/12 text-amber-500",
      )}
    >
      {value}
      <span className="text-[10px] font-bold opacity-80">{suffix}</span>
    </span>
  );
}

function HeaderStrip({ board }: { board: SeasonBoard }) {
  const cell =
    "text-[10px] font-semibold uppercase tracking-wider text-base-content/40";
  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5 sm:px-4">
      <span className={cn(cell, "w-5 shrink-0 text-center")}>#</span>
      <span className={cn(cell, "flex-1")}>Player</span>
      {board === "games" ? (
        <span className={cn(cell, "w-12 text-center")}>Games</span>
      ) : (
        <>
          <span className={cn(cell, STAT_COL, "text-center")}>Won</span>
          <span className={cn(cell, STAT_COL, "text-center")}>Drawn</span>
        </>
      )}
    </div>
  );
}

function Row({
  row,
  board,
  isMe,
  index,
}: {
  row: SeasonRow;
  board: SeasonBoard;
  isMe: boolean;
  index: number;
}) {
  // The points board shows wins and draws instead of the points score; the
  // tooltip has the full record.
  const record = `${row.wins} won, ${row.draws} drawn, ${row.losses} lost`;
  return (
    <li
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors sm:px-4 sm:py-3",
        // Zebra striping instead of divider lines. Done by index (not
        // odd:/even:) because cn() doesn't merge classes, so a stripe class
        // would fight the "me" highlight.
        isMe
          ? "bg-primary/12 ring-1 ring-inset ring-primary/25"
          : index % 2 === 1
            ? "bg-base-content/4"
            : "bg-transparent",
      )}
    >
      {/* The prize replaces the serial number on the places that win one.
          Kept as narrow as the content allows (a prize tops out at 3
          digits, a top-20 rank at 2) so the avatar sits close to it. */}
      {row.prize > 0 ? (
        <span
          className="flex w-5 shrink-0 flex-col items-center gap-0.5 leading-none"
          title={`${row.prize} R prize for place ${row.rank}`}
        >
          <RCoin size={12} />
          <span className="text-[10px] font-semibold tabular-nums text-amber-300">
            {row.prize}
          </span>
        </span>
      ) : (
        <span
          className={cn(
            "w-5 shrink-0 text-center font-semibold tabular-nums whitespace-nowrap text-base-content/60",
            // A rank outside the top 20 (your own row) can be 3-4 digits.
            row.rank >= 100 ? "text-[10px]" : "text-sm",
          )}
        >
          {row.rank}
        </span>
      )}
      <Avatar
        username={row.username}
        gradient={row.avatarGradient}
        size="xs"
        mdSize="compact"
      />
      <div className="min-w-0 flex-1">
        <Link
          to={`/profile/${row.username}`}
          className="block truncate text-sm font-medium hover:underline"
        >
          {row.username}
          {isMe && (
            <span className="ml-1.5 text-xs text-base-content/50">(you)</span>
          )}
        </Link>
      </div>
      {board === "games" ? (
        <span className="w-12 text-center text-base font-semibold tabular-nums whitespace-nowrap">
          {row.games}
        </span>
      ) : (
        <>
          <StatPill value={row.wins} suffix="W" tone="win" title={record} />
          <StatPill value={row.draws} suffix="D" tone="draw" title={record} />
        </>
      )}
    </li>
  );
}

/** Season leaderboards: most games played and most points, 15-day seasons
 *  with R prizes for the top five of each board. */
export function Leaderboard() {
  const [data, setData] = useState<SeasonLeaderboard | null>(null);
  const [past, setPast] = useState<PastSeason[]>([]);
  // Which board the mobile swipe view is on (both show side by side on PC).
  const [activeBoard, setActiveBoard] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setData(await getSeasonLeaderboard());
      setError("");
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void load();
    getPastSeasons()
      .then((r) => setPast(r.seasons))
      .catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 30_000);
    const r = setInterval(() => void load(), 60_000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [load]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    setActiveBoard(el.scrollLeft > max / 2 ? 1 : 0);
  }, []);

  function goTo(index: number) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({
      left: index * (el.scrollWidth - el.clientWidth),
      behavior: "smooth",
    });
  }

  if (!data) {
    return (
      <Page title="Leaderboard" back="/">
        {error ? (
          <PageError message={error} />
        ) : (
          <CenteredSpinner className="py-16" />
        )}
      </Page>
    );
  }

  const msLeft = new Date(data.endsAt).getTime() - now;

  return (
    <Page
      title={
        <span className="flex items-center gap-2.5">
          {/* Phone: the header names the board you're looking at (the page
              swipes between them). md and up show both boards, so it names
              the season instead. */}
          <span className="flex min-w-0 items-center gap-1.5 md:hidden">
            <span className="truncate">{BOARDS[activeBoard].title}</span>
            {BOARDS[activeBoard].key === "points" &&
              data.minGamesForPointsPrize > 0 && (
                <HelpTip className="">
                  <span className="whitespace-normal!">
                    {minGamesText(data.minGamesForPointsPrize)}
                  </span>
                </HelpTip>
              )}
          </span>
          <span className="hidden md:inline">Season {data.season}</span>
          <Badge variant="neutral" className="shrink-0 text-xs font-medium">
            <RunningClock className="mr-1 h-3.5 w-3.5" />
            {formatLeft(msLeft)}
          </Badge>
        </span>
      }
      description={`${fmtDate(data.startsAt)} to ${fmtDate(data.endsAt)}. Win = 1 point, draw = 0.5.`}
      responsiveDescription
      back="/"
    >
      <div className="space-y-5">
        {/* Mobile-only swipe hint: arrows show which way there's another
            board, the dots show where you are. Both are tappable. */}
        <div className="flex items-center justify-center gap-3 md:hidden">
          <button
            type="button"
            aria-label="Show most games board"
            onClick={() => goTo(0)}
            disabled={activeBoard === 0}
            className="rounded-full p-1 text-base-content/70 transition-opacity disabled:opacity-20"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1.5">
            {BOARDS.map((bd, i) => (
              <button
                key={bd.key}
                type="button"
                aria-label={`Show ${bd.title} board`}
                onClick={() => goTo(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  activeBoard === i
                    ? "w-5 bg-primary"
                    : "w-1.5 bg-base-content/25",
                )}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Show most points board"
            onClick={() => goTo(1)}
            disabled={activeBoard === 1}
            className="rounded-full p-1 text-base-content/70 transition-opacity disabled:opacity-20"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* PC: two boards side by side. Mobile: one board per screen, swipe
            left/right (scroll-snap). */}
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto scrollbar-none md:grid md:snap-none md:grid-cols-2 md:gap-4 md:overflow-visible [&::-webkit-scrollbar]:hidden"
        >
          {BOARDS.map(({ key, title }) => {
            const b = data.boards[key];
            const rows = b.top.slice(0, BOARD_LIMIT);
            const meInTop = b.me
              ? rows.some((r) => r.user === b.me!.user)
              : false;
            return (
              <section
                key={key}
                className="min-w-full snap-center self-start md:min-w-0"
              >
                {/* Phone shows the board's name in the page header instead
                    (it follows the swipe), so this heading is md+ only. */}
                <div className="mb-2 hidden items-center gap-1.5 px-3 md:flex">
                  <h2 className="text-lg font-extrabold tracking-tight md:text-xl">
                    {title}
                  </h2>
                  {key === "points" && data.minGamesForPointsPrize > 0 && (
                    <HelpTip>
                      {minGamesText(data.minGamesForPointsPrize)}gjgj
                    </HelpTip>
                  )}
                </div>
                {rows.length === 0 ? (
                  <p className="py-10 text-center text-sm text-base-content/60">
                    No games finished this season yet.
                  </p>
                ) : (
                  <>
                    <HeaderStrip board={key} />
                    <ul className="space-y-1">
                      {rows.map((r, i) => (
                        <Row
                          key={r.user}
                          row={r}
                          board={key}
                          isMe={r.user === b.me?.user}
                          index={i}
                        />
                      ))}
                      {b.me && !meInTop && (
                        <>
                          <li className="py-0.5 text-center text-xs leading-none tracking-widest text-base-content/30">
                            ...
                          </li>
                          <Row row={b.me} board={key} isMe index={0} />
                        </>
                      )}
                    </ul>
                  </>
                )}
              </section>
            );
          })}
        </div>

        {past.length > 0 && (
          <div className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Trophy className="h-4 w-4 text-amber-400" /> Past winners
            </h2>
            {past.map((s) => (
              <Card key={s.season} variant="solid">
                <CardContent className="space-y-1 px-1 py-4 text-sm">
                  <p className="font-medium">Season {s.season}</p>
                  {(["games", "points"] as SeasonBoard[]).map((bd) => {
                    const w = s.winners.find(
                      (x) => x.board === bd && x.rank === 1,
                    );
                    return (
                      <p key={bd} className="text-xs text-base-content/70">
                        {bd === "games" ? "Most games" : "Most points"}:{" "}
                        {w ? (
                          <Link
                            to={`/profile/${w.username}`}
                            className="font-medium text-base-content hover:underline"
                          >
                            {w.username}
                            {bd === "games" && w.value != null
                              ? ` (${fmtPoints(w.value)})`
                              : ""}
                          </Link>
                        ) : (
                          "no winner"
                        )}
                      </p>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
