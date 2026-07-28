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

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tcIndex, setTcIndex] = useState(2);
  const [variant, setVariant] = useState<"standard" | "chess960">("standard");
  const [wagerInput, setWagerInput] = useState("0");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [error, setError] = useState("");
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
    }
  }

  function handleJoinByCode() {
    const code = joinCodeInput.trim().toUpperCase();
    if (code) navigate(`/game/${code}`);
  }

  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-amber-900/50 bg-amber-950/20 p-5">
        <div>
          <p className="text-sm text-amber-400">R Token Balance</p>
          <p className="text-2xl font-bold text-neutral-100">
            {balance ?? "…"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/wallet/buy"
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Buy
          </Link>
          <Link
            to="/wallet/withdraw"
            className="rounded-md bg-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-100 hover:bg-neutral-600"
          >
            Withdraw
          </Link>
          <Link
            to="/wallet/transactions"
            className="rounded-md bg-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-100 hover:bg-neutral-600"
          >
            History
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h1 className="mb-3 text-xl font-bold text-neutral-100">
          Welcome, {user?.username}
        </h1>

        <label className="mb-1 block text-sm text-neutral-400">
          Time control
        </label>
        <select
          value={tcIndex}
          onChange={(e) => setTcIndex(Number(e.target.value))}
          className="mb-3 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
        >
          {TIME_CONTROLS.map((tc, i) => (
            <option key={tc.label} value={i}>
              {tc.label}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-sm text-neutral-400">Variant</label>
        <select
          value={variant}
          onChange={(e) =>
            setVariant(e.target.value as "standard" | "chess960")
          }
          className="mb-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
        >
          <option value="standard">Standard</option>
          <option value="chess960">Chess960 (Fischer Random)</option>
        </select>
        {variant === "chess960" && (
          <p className="mb-3 text-xs text-amber-400">
            Note: castling isn't available in Chess960 games yet — a limitation
            in the underlying chess library, not a bug.
          </p>
        )}
        {variant === "standard" && <div className="mb-3" />}

        <label className="mb-1 block text-sm text-neutral-400">
          R token wager (per player)
        </label>
        <input
          type="number"
          min={0}
          step={1}
          value={wagerInput}
          onChange={(e) => setWagerInput(e.target.value)}
          placeholder="0 for a free game"
          className="mb-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
        />
        <p className="mb-3 text-xs text-neutral-500">
          {wagerTokens > 0
            ? `You'll stake ${wagerTokens} R tokens now. Winner takes the full ${wagerTokens * 2}.`
            : "Leave at 0 to play for free."}
        </p>

        <button
          onClick={handleCreate}
          className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
        >
          Create game
        </button>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-2 text-lg font-semibold text-neutral-100">
          Join a game by code
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. 7K3M9P"
            maxLength={10}
            value={joinCodeInput}
            onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 uppercase text-neutral-100"
          />
          <button
            onClick={handleJoinByCode}
            className="rounded-md bg-neutral-700 px-4 py-2 font-semibold text-neutral-100 hover:bg-neutral-600"
          >
            Go to game
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-2 text-lg font-semibold text-neutral-100">
          Friends currently playing
        </h2>
        {gamesError && <p className="text-sm text-red-400">{gamesError}</p>}
        {!gamesError && activeGames === null && (
          <p className="text-sm text-neutral-400">Loading…</p>
        )}
        {activeGames && activeGames.length === 0 && (
          <p className="text-sm text-neutral-400">
            None of your friends are in a game right now.
          </p>
        )}
        {activeGames &&
          activeGames.map((g) => {
            const toMove = turnColor(new Chess(g.fen));
            return (
              <div
                key={g._id}
                className="flex items-center justify-between border-b border-neutral-800 py-2 last:border-none"
              >
                <div className="text-sm text-neutral-200">
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
                  <span className="ml-2 text-neutral-500">
                    · move {g.moves.length} · {toMove} to move ·{" "}
                    {formatTimeControl(g.timeControl)}
                  </span>
                  {g.wagerTokens > 0 && (
                    <span className="ml-2 rounded bg-amber-900/40 px-1.5 py-0.5 text-xs font-semibold text-amber-300">
                      {g.wagerTokens} R wager
                    </span>
                  )}
                </div>
                <Link
                  to={`/game/${g.joinCode}`}
                  className="rounded-md bg-neutral-700 px-3 py-1.5 text-sm font-semibold text-neutral-100 hover:bg-neutral-600"
                >
                  Watch
                </Link>
              </div>
            );
          })}
      </div>
    </div>
  );
}
