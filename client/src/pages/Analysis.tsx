import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LineChart } from "lucide-react";
import { Page, Card, Avatar, Badge, Button, Spinner, TimeControlIcon } from "../components/ui/index.js";
import { PageError } from "../components/PageError.js";
import { useAuth } from "../contexts/AuthContext.js";
import { getUserGames, type UserGameHistoryItem } from "../api/users.js";
import { formatTimeControl } from "../timeControls.js";
import { errMsg } from "../lib/errMsg.js";

const GAMES_PER_PAGE = 15;

const resultVariant: Record<UserGameHistoryItem["result"], "success" | "error" | "neutral"> = {
  win: "success",
  loss: "error",
  draw: "neutral",
};

/** Your finished games. Picking one opens its engine review at /analysis/:code. */
export function Analysis() {
  const { user } = useAuth();
  const username = user?.username;

  const [games, setGames] = useState<UserGameHistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (nextPage: number) => {
      if (!username) return;
      setLoading(true);
      getUserGames(username, nextPage, GAMES_PER_PAGE)
        .then((res) => {
          setGames((prev) => (nextPage === 1 ? res.games : [...prev, ...res.games]));
          setPage(res.page);
          setTotalPages(res.totalPages);
          setError(null);
        })
        .catch((err) => setError(errMsg(err)))
        .finally(() => setLoading(false));
    },
    [username],
  );

  useEffect(() => {
    load(1);
  }, [load]);

  if (error && games.length === 0) {
    return (
      <Page title="Analysis">
        <PageError message={error} />
      </Page>
    );
  }

  return (
    <Page title="Analysis" description="Pick a game to review every move with the engine.">
      <Card>
        {loading && games.length === 0 && (
          <div className="flex justify-center py-8">
            <Spinner size="sm" className="text-base-content/40" />
          </div>
        )}

        {!loading && games.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <LineChart className="h-8 w-8 text-base-content/30" />
            <p className="text-sm text-base-content/60">
              No finished games yet. Play one and it will show up here.
            </p>
          </div>
        )}

        <div className="divide-y divide-base-300">
          {games.map((g) => (
            <Link
              key={g.gameId}
              to={`/analysis/${g.joinCode}`}
              className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-(--primary)"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar
                  username={g.opponent?.username ?? "?"}
                  size="sm"
                  gradient={g.opponent?.avatarGradient}
                />
                <div className="min-w-0">
                  <p className="truncate font-medium text-base-content">
                    vs {g.opponent?.username ?? "Unknown"}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-base-content/40">
                    <span
                      className={
                        g.color === "white"
                          ? "inline-block h-2 w-2 rounded-full border border-base-content/30 bg-white"
                          : "inline-block h-2 w-2 rounded-full border border-base-content/30 bg-black"
                      }
                    />
                    <span className="capitalize">{g.color}</span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <TimeControlIcon baseSeconds={g.timeControl.baseSeconds} size={12} />
                      {formatTimeControl(g.timeControl)}
                    </span>
                    <span>·</span>
                    <span>{g.moveCount} moves</span>
                    <span>·</span>
                    <span>{new Date(g.endedAt).toLocaleDateString()}</span>
                  </p>
                </div>
              </div>
              <Badge variant={resultVariant[g.result]} className="shrink-0 uppercase">
                {g.result}
              </Badge>
            </Link>
          ))}
        </div>

        {loading && games.length > 0 && (
          <div className="flex justify-center py-4">
            <Spinner size="sm" className="text-base-content/40" />
          </div>
        )}

        {!loading && page < totalPages && (
          <div className="mt-3 flex justify-center">
            <Button variant="glass" size="sm" onClick={() => load(page + 1)}>
              Load more
            </Button>
          </div>
        )}
      </Card>
    </Page>
  );
}
