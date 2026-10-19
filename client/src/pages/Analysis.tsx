import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Page, Card, Button, Textarea } from "../components/ui/index.js";
import { GameHistoryList } from "../components/lists/GameHistoryList.js";
import { PageError } from "../components/PageError.js";
import { useAuth } from "../contexts/AuthContext.js";
import { getUserGames, type UserGameHistoryItem } from "../api/users.js";
import { errMsg } from "../lib/errMsg.js";
import { PGN_STORAGE_KEY, parsePgnGame } from "../lib/analysis/pgn.js";

const GAMES_PER_PAGE = 15;

/** Your finished games. Picking one opens its engine review at /analysis/:code. */
export function Analysis() {
  const { user } = useAuth();
  const username = user?.username;
  const navigate = useNavigate();

  const [pgn, setPgn] = useState("");
  const [pgnError, setPgnError] = useState<string | null>(null);

  function analysePgn() {
    try {
      parsePgnGame(pgn); // validate before leaving the page
      sessionStorage.setItem(PGN_STORAGE_KEY, pgn.trim());
      navigate("/analysis/pgn");
    } catch (err) {
      setPgnError(errMsg(err));
    }
  }

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

  const pgnCard = (
    <Card className="mb-4">
      <h3 className="mb-1 text-base font-semibold text-base-content">Analyze a PGN</h3>
      <p className="mb-3 text-sm text-base-content/60">
        Paste any game's PGN (from another site or app) to review it with the engine.
      </p>
      <Textarea
        value={pgn}
        onChange={(e) => {
          setPgn(e.target.value);
          setPgnError(null);
        }}
        rows={5}
        placeholder={"[White \"Name\"]\n[Black \"Name\"]\n\n1. e4 e5 2. Nf3 Nc6 ..."}
        error={pgnError ?? undefined}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={analysePgn} disabled={!pgn.trim()}>
          Analyze
        </Button>
      </div>
    </Card>
  );

  if (error && games.length === 0) {
    return (
      <Page title="Analysis">
        {pgnCard}
        <PageError message={error} />
      </Page>
    );
  }

  return (
    <Page title="Analysis" description="Pick a game, or paste a PGN, to review every move with the engine.">
      {pgnCard}

      <Card>
        <GameHistoryList
          games={games}
          loading={loading}
          hasMore={page < totalPages}
          onLoadMore={() => load(page + 1)}
          linkFor={(g) => `/analysis/${g.joinCode}`}
          emptyText="No finished games yet. Play one and it will show up here."
        />
      </Card>
    </Page>
  );
}
