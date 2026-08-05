import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Chess } from "chess.js";
import {
  createGame,
  listFriendsActiveGames,
  type ActiveFriendGame,
} from "../api/games.js";
import { ApiRequestError } from "../api/http.js";
import { useAuth } from "../contexts/AuthContext.js";
import { TIME_CONTROLS, formatTimeControl } from "../timeControls.js";
import { turnColor } from "../chessUtils.js";
import { useTokenBalance } from "../hooks/useTokenBalance.js";
import {
  Page,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Select,
  Input,
  Button,
  Badge,
  RCoin,
} from "../components/ui/index.js";

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tcIndex, setTcIndex] = useState(2);
  const [variant, setVariant] = useState<"standard" | "chess960">("standard");
  const [wagerInput, setWagerInput] = useState("0");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeGames, setActiveGames] = useState<ActiveFriendGame[] | null>(
    null,
  );
  const [gamesError, setGamesError] = useState("");
  const { balance, refresh } = useTokenBalance();

  useEffect(() => {
    let cancelled = false;
    listFriendsActiveGames()
      .then((res) => !cancelled && setActiveGames(res.games))
      .catch(() => !cancelled && setGamesError("Failed to load active games."));
    return () => {
      cancelled = true;
    };
  }, []);

  const wagerTokens = Math.max(0, Math.floor(Number(wagerInput) || 0));

  async function handleCreate() {
    const tc = TIME_CONTROLS[tcIndex];
    setError("");
    setCreating(true);
    try {
      const { joinCode } = await createGame(
        { baseMinutes: tc.baseMinutes, incrementSeconds: tc.incrementSeconds },
        variant,
        false,
        wagerTokens,
      );
      refresh().catch(() => {});
      navigate(`/game/${joinCode}`);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not create game",
      );
    } finally {
      setCreating(false);
    }
  }

  function handleJoinByCode() {
    const code = joinCodeInput.trim().toUpperCase();
    if (code) navigate(`/game/${code}`);
  }

  return (
    <Page title={`Welcome, ${user?.username ?? ""}`}>
      <div className="space-y-4">
        <Card className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RCoin size={34} />
            <div>
              <p className="text-sm text-(--primary)">R Coin Balance</p>
              <p className="text-2xl font-bold text-base-content">
                {balance ?? "…"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link to="/wallet/buy">
              <Button size="sm">Buy</Button>
            </Link>
            <Link to="/wallet/withdraw">
              <Button variant="glass" size="sm">
                Withdraw
              </Button>
            </Link>
            <Link className="hidden sm:flex" to="/wallet/transactions">
              <Button variant="glass" size="sm">
                History
              </Button>
            </Link>
          </div>
        </Card>

        <Card variant="solid">
          <CardHeader>
            <CardTitle>Start a new game</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select
              label="Time control"
              value={tcIndex}
              onChange={(e) => setTcIndex(Number(e.target.value))}
            >
              {TIME_CONTROLS.map((tc, i) => (
                <option key={tc.label} value={i}>
                  {tc.label}
                </option>
              ))}
            </Select>

            <Select
              label="Variant"
              value={variant}
              onChange={(e) =>
                setVariant(e.target.value as "standard" | "chess960")
              }
              hint={
                variant === "chess960"
                  ? "Note: castling isn't available in Chess960 games yet — a limitation in the underlying chess library, not a bug."
                  : undefined
              }
            >
              <option value="standard">Standard</option>
              <option value="chess960">Chess960 (Fischer Random)</option>
            </Select>

            <Input
              label="R Coin wager (per player)"
              type="number"
              min={0}
              step={1}
              value={wagerInput}
              onChange={(e) => setWagerInput(e.target.value)}
              placeholder="0 for a free game"
              hint={
                wagerTokens > 0
                  ? `You'll stake ${wagerTokens} R Coins now. Winner takes the full ${wagerTokens * 2}.`
                  : "Leave at 0 to play for free."
              }
            />

            <Button onClick={handleCreate} loading={creating}>
              Create game
            </Button>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </CardContent>
        </Card>

        <Card variant="solid">
          <CardHeader>
            <CardTitle>Join a game by code</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              type="text"
              placeholder="e.g. 7K3M9P"
              maxLength={10}
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
              className="uppercase"
            />
            <Button className="flex" variant="glass" onClick={handleJoinByCode}>
              Join
            </Button>
          </CardContent>
        </Card>

        <Card variant="solid">
          <CardHeader>
            <CardTitle>Friends currently playing</CardTitle>
          </CardHeader>
          <CardContent>
            {gamesError && <p className="text-sm text-red-400">{gamesError}</p>}
            {!gamesError && activeGames === null && (
              <p className="text-sm text-base-content/60">Loading…</p>
            )}
            {activeGames && activeGames.length === 0 && (
              <p className="text-sm text-base-content/60">
                None of your friends are in a game right now.
              </p>
            )}
            {activeGames &&
              activeGames.map((g) => {
                const toMove = turnColor(new Chess(g.fen));
                return (
                  <div
                    key={g._id}
                    className="flex items-center justify-between border-b border-base-300 py-2 last:border-none"
                  >
                    <div className="text-sm text-base-content">
                      <Link
                        to={`/profile/${g.white.username}`}
                        className="hover:underline"
                      >
                        {g.white.username}
                      </Link>{" "}
                      vs{" "}
                      <Link
                        to={`/profile/${g.black.username}`}
                        className="hover:underline"
                      >
                        {g.black.username}
                      </Link>
                      <span className="ml-2 text-base-content/50">
                        · move {Math.ceil(g.moves.length / 2)} · {toMove} to
                        move · {formatTimeControl(g.timeControl)}
                      </span>
                      {g.wagerTokens > 0 && (
                        <Badge variant="warning" className="ml-2">
                          {g.wagerTokens} R wager
                        </Badge>
                      )}
                    </div>
                    <Link to={`/game/${g.joinCode}`}>
                      <Button variant="glass" size="sm">
                        Watch
                      </Button>
                    </Link>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
