import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, Trophy } from "lucide-react";
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
  RCoinAmount,
  Tabs,
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

function Row({ row, board, isMe }: { row: SeasonRow; board: SeasonBoard; isMe: boolean }) {
  const main = board === "games" ? row.games : fmtPoints(row.points);
  const sub =
    board === "games"
      ? `${fmtPoints(row.points)} pts`
      : `${row.games} games · ${row.wins}W ${row.draws}D ${row.losses}L`;
  return (
    <li className={cn("flex items-center gap-3 px-4 py-2.5", isMe && "bg-primary/10")}>
      <span className={cn("w-7 text-center text-sm font-semibold tabular-nums", row.rank <= 3 && "text-amber-400")}>
        {row.rank}
      </span>
      <Avatar username={row.username} gradient={row.avatarGradient} size="sm" />
      <div className="min-w-0 flex-1">
        <Link to={`/profile/${row.username}`} className="block truncate text-sm font-medium hover:underline">
          {row.username}
          {isMe && <span className="ml-1.5 text-xs text-base-content/50">(you)</span>}
        </Link>
        <p className="truncate text-xs text-base-content/50">{sub}</p>
      </div>
      {row.prize > 0 && <RCoinAmount value={row.prize} size={14} className="text-xs text-amber-300" />}
      <span className="w-12 text-right text-base font-semibold tabular-nums">{main}</span>
    </li>
  );
}

/** Season leaderboards: most games played and most points, 15-day seasons
 *  with R prizes for the top five of each board. */
export function Leaderboard() {
  const [data, setData] = useState<SeasonLeaderboard | null>(null);
  const [past, setPast] = useState<PastSeason[]>([]);
  const [board, setBoard] = useState<SeasonBoard>("games");
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

  if (!data) {
    return (
      <Page title="Leaderboard" back="/">
        {error ? <PageError message={error} /> : <CenteredSpinner className="py-16" />}
      </Page>
    );
  }

  const b = data.boards[board];
  const meInTop = b.me ? b.top.some((r) => r.user === b.me!.user) : false;
  const msLeft = new Date(data.endsAt).getTime() - now;

  return (
    <Page
      title={`Season ${data.season}`}
      description={`${fmtDate(data.startsAt)} to ${fmtDate(data.endsAt)}. Win = 1 point, draw = 0.5.`}
      responsiveDescription
      back="/"
    >
      <div className="space-y-4">
        <Card variant="solid">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <Badge variant="neutral">
              <Clock className="mr-1 h-3.5 w-3.5" />
              {formatLeft(msLeft)}
            </Badge>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/70">
              {data.prizes.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  {i + 1}.<RCoinAmount value={p} size={13} />
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <Tabs
          items={[
            { value: "games", label: "Most games" },
            { value: "points", label: "Most points" },
          ]}
          value={board}
          onChange={(v) => setBoard(v as SeasonBoard)}
        />
        {board === "points" && data.minGamesForPointsPrize > 0 && (
          <p className="text-xs text-base-content/50">
            Play at least {data.minGamesForPointsPrize} games this season to be eligible for a points prize.
          </p>
        )}

        <Card variant="solid">
          {b.top.length === 0 ? (
            <CardContent className="py-10 text-center text-sm text-base-content/60">
              No games finished this season yet. Play one to get on the board.
            </CardContent>
          ) : (
            <ul className="divide-y divide-base-content/5">
              {b.top.map((r) => (
                <Row key={r.user} row={r} board={board} isMe={r.user === b.me?.user} />
              ))}
              {b.me && !meInTop && (
                <>
                  <li className="px-4 py-1 text-center text-xs text-base-content/40">...</li>
                  <Row row={b.me} board={board} isMe />
                </>
              )}
            </ul>
          )}
        </Card>

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
