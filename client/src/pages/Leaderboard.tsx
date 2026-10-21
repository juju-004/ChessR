import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Clock, Trophy } from "lucide-react";
import {
  getPastSeasons,
  getSeasonLeaderboard,
  type PastSeason,
  type SeasonBoard,
  type SeasonLeaderboard,
  type SeasonRow,
} from "../api/seasonLeaderboard.js";
import { PageError } from "../components/PageError.js";
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

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

function formatLeft(ms: number): string {
  if (ms <= 0) return "Ending now";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${d}d ${h}h left` : `${h}h ${m}m left`;
}

const fmtPoints = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Each board shows at most this many rows (the server caps it too). */
const BOARD_LIMIT = 20;

const BOARDS: { key: SeasonBoard; title: string }[] = [
  { key: "games", title: "Most games played" },
  { key: "points", title: "Most points" },
];

function Row({ row, board, isMe }: { row: SeasonRow; board: SeasonBoard; isMe: boolean }) {
  const main = board === "games" ? row.games : fmtPoints(row.points);
  const sub =
    board === "games"
      ? `${fmtPoints(row.points)} pts`
      : `${row.games} games · ${row.wins}W ${row.draws}D ${row.losses}L`;
  return (
    <li className={cn("flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5", isMe && "bg-primary/10")}>
      {/* The prize replaces the serial number on the places that win one. */}
      {row.prize > 0 ? (
        <span
          className="flex w-8 shrink-0 flex-col items-center gap-0.5 leading-none sm:w-9"
          title={`${row.prize} R prize for place ${row.rank}`}
        >
          <RCoin size={12} />
          <span className="text-[11px] font-semibold tabular-nums text-amber-300">{row.prize}</span>
        </span>
      ) : (
        <span className="w-8 shrink-0 text-center text-sm font-semibold tabular-nums text-base-content/70 sm:w-9">
          {row.rank}
        </span>
      )}
      <Avatar username={row.username} gradient={row.avatarGradient} size="xs" mdSize="sm" />
      <div className="min-w-0 flex-1">
        <Link to={`/profile/${row.username}`} className="block truncate text-sm font-medium hover:underline">
          {row.username}
          {isMe && <span className="ml-1.5 text-xs text-base-content/50">(you)</span>}
        </Link>
        <p className="truncate text-xs text-base-content/50">{sub}</p>
      </div>
      <span className="min-w-10 text-right text-base font-semibold tabular-nums">{main}</span>
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
    getPastSeasons().then((r) => setPast(r.seasons)).catch(() => {});
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
    el.scrollTo({ left: index * (el.scrollWidth - el.clientWidth), behavior: "smooth" });
  }

  if (!data) {
    return (
      <Page title="Leaderboard" back="/">
        {error ? <PageError message={error} /> : <CenteredSpinner className="py-16" />}
      </Page>
    );
  }

  const msLeft = new Date(data.endsAt).getTime() - now;

  return (
    <Page
      title={
        <span className="flex items-center gap-2.5">
          Season {data.season}
          <Badge variant="neutral" className="shrink-0 text-xs font-medium">
            <Clock className="mr-1 h-3.5 w-3.5" />
            {formatLeft(msLeft)}
          </Badge>
        </span>
      }
      description={`${fmtDate(data.startsAt)} to ${fmtDate(data.endsAt)}. Win = 1 point, draw = 0.5.`}
      responsiveDescription
      back="/"
    >
      <div className="space-y-4">
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
                  activeBoard === i ? "w-5 bg-primary" : "w-1.5 bg-base-content/25",
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
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto [scrollbar-width:none] md:grid md:snap-none md:grid-cols-2 md:gap-4 md:overflow-visible [&::-webkit-scrollbar]:hidden"
        >
          {BOARDS.map(({ key, title }) => {
            const b = data.boards[key];
            const rows = b.top.slice(0, BOARD_LIMIT);
            const meInTop = b.me ? rows.some((r) => r.user === b.me!.user) : false;
            return (
              <Card
                key={key}
                variant="solid"
                className="min-w-full snap-center self-start overflow-hidden p-0 md:min-w-0"
              >
                <div className="border-b border-base-content/5 px-3 py-3 sm:px-4">
                  <h2 className="text-sm font-semibold">{title}</h2>
                  {key === "points" && data.minGamesForPointsPrize > 0 && (
                    <p className="mt-0.5 text-xs text-base-content/50">
                      Play at least {data.minGamesForPointsPrize} games this season to be eligible for a prize.
                    </p>
                  )}
                </div>
                {rows.length === 0 ? (
                  <CardContent className="py-10 text-center text-sm text-base-content/60">
                    No games finished this season yet. Play one to get on the board.
                  </CardContent>
                ) : (
                  <ul className="divide-y divide-base-content/5">
                    {rows.map((r) => (
                      <Row key={r.user} row={r} board={key} isMe={r.user === b.me?.user} />
                    ))}
                    {b.me && !meInTop && (
                      <>
                        <li className="px-4 py-1 text-center text-xs text-base-content/40">...</li>
                        <Row row={b.me} board={key} isMe />
                      </>
                    )}
                  </ul>
                )}
              </Card>
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
                <CardContent className="space-y-1 py-3 text-sm">
                  <p className="font-medium">Season {s.season}</p>
                  {(["games", "points"] as SeasonBoard[]).map((bd) => {
                    const w = s.winners.find((x) => x.board === bd && x.rank === 1);
                    return (
                      <p key={bd} className="text-xs text-base-content/70">
                        {bd === "games" ? "Most games" : "Most points"}:{" "}
                        {w ? (
                          <Link to={`/profile/${w.username}`} className="font-medium text-base-content hover:underline">
                            {w.username} ({fmtPoints(w.value)})
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
