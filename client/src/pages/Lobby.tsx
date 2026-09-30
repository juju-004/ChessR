import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Play, Gamepad2 } from "lucide-react";
import {
  cancelGame,
  createGame,
  joinGame,
  listMyActiveGames,
  listOpenGames,
  type GameVariant,
  type MyActiveGame,
  type OpenGame,
} from "../api/games.js";
import { ApiRequestError } from "../api/http.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useConfirm } from "../contexts/ConfirmContext.js";
import { useTokenBalance } from "../hooks/useTokenBalance.js";
import { useRakePercent } from "../hooks/useRakePercent.js";
import { RestrictionBanner } from "../components/RestrictionBanner.js";
import { RatingBadge } from "../components/RatingBadge.js";
import { TIME_CONTROLS, formatTimeControl } from "../timeControls.js";
import { MAX_WAGER_TOKENS, MIN_STAKE_TOKENS } from "../lib/limits.js";
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
  Avatar,
  Spinner,
  ResponsiveOverlay,
  TimeControlIcon,
} from "../components/ui/index.js";

// Safety net for a dropped socket event, the list is otherwise pushed live.
const POLL_MS = 20_000;

function variantLabel(v: GameVariant) {
  return v === "chess960" ? "Chess960" : "Standard";
}

/** The open-games lobby: put up a game with a wager, and accept anyone
 *  else's. The list is pushed live over the socket (lobby:changed), see
 *  lobbySocket.ts / game.service.ts server-side. */
export function Lobby() {
  const { user } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { balance, refresh } = useTokenBalance();
  const rakePercent = useRakePercent();

  const [games, setGames] = useState<OpenGame[] | null>(null);
  const [myGame, setMyGame] = useState<MyActiveGame | null | undefined>(
    undefined,
  );
  const [loadError, setLoadError] = useState("");

  const [tcIndex, setTcIndex] = useState(5);
  const [variant, setVariant] = useState<GameVariant>("standard");
  const [wagerInput, setWagerInput] = useState("0");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    id: string;
    message: string;
  } | null>(null);

  // Lets the fetch below notice "my table just got taken" (waiting -> active)
  // and drop the host straight into the game instead of leaving them
  // staring at a lobby while their clock starts.
  const prevMyStatus = useRef<MyActiveGame["status"] | null>(null);

  const load = useCallback(async () => {
    try {
      const [open, mine] = await Promise.all([
        listOpenGames(),
        listMyActiveGames(),
      ]);
      setGames(open.games);
      const mineNow = mine.games[0] ?? null;
      if (
        mineNow &&
        mineNow.status === "active" &&
        prevMyStatus.current === "waiting"
      ) {
        prevMyStatus.current = "active";
        navigate(`/game/${mineNow.joinCode}`);
        return;
      }
      prevMyStatus.current = mineNow?.status ?? null;
      setMyGame(mineNow);
      setLoadError("");
    } catch {
      setLoadError("Couldn't load the lobby. Retrying…");
      setGames((g) => g ?? []);
      setMyGame((m) => (m === undefined ? null : m));
    }
  }, [navigate]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!socket) return;
    const s = socket;
    const watch = () => {
      s.emit("lobby:watch");
      // Anything that changed while we were disconnected.
      load();
    };
    s.on("connect", watch);
    s.on("lobby:changed", load);
    if (s.connected) s.emit("lobby:watch");
    return () => {
      s.off("connect", watch);
      s.off("lobby:changed", load);
      s.emit("lobby:unwatch");
    };
  }, [socket, load]);

  const wagerTokens = Math.min(
    MAX_WAGER_TOKENS,
    Math.max(0, Math.floor(Number(wagerInput) || 0)),
  );
  const wagerBelowFloor = wagerTokens > 0 && wagerTokens < MIN_STAKE_TOKENS;
  const wagerTooHigh = balance !== null && wagerTokens > balance;
  const winnerTakes =
    rakePercent !== null && wagerTokens > 0
      ? wagerTokens * 2 - Math.floor((wagerTokens * 2 * rakePercent) / 100)
      : null;

  const hasGame = !!myGame;
  // The listing's own row (Cancel/Open) is part of the list itself, sorted
  // to the top, rather than living in a separate card.
  const sorted = [...(games ?? [])].sort(
    (a, b) =>
      Number(b.white._id === user?.id) - Number(a.white._id === user?.id),
  );

  async function handleCreate() {
    const tc = TIME_CONTROLS[tcIndex];
    setCreateError("");
    setCreating(true);
    try {
      await createGame(
        { baseMinutes: tc.baseMinutes, incrementSeconds: tc.incrementSeconds },
        variant,
        false,
        wagerTokens,
      );
      refresh().catch(() => {});
      setCreateOpen(false);
      await load();
    } catch (err) {
      setCreateError(
        err instanceof ApiRequestError ? err.message : "Could not create game",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleCancel(game: { _id: string }) {
    setBusyId(game._id);
    try {
      await cancelGame(game._id);
      refresh().catch(() => {});
      await load();
    } catch (err) {
      setCreateError(
        err instanceof ApiRequestError ? err.message : "Could not cancel game",
      );
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleAccept(game: OpenGame) {
    setRowError(null);
    if (game.wagerTokens > 0) {
      const ok = await confirm({
        title: `Accept this ${game.wagerTokens} R game?`,
        description: `${game.wagerTokens} R will be staked from your balance against ${game.white.username}. The winner takes the pot.`,
        confirmLabel: "Accept & play",
      });
      if (!ok) return;
    }
    setBusyId(game._id);
    try {
      const res = await joinGame(game._id);
      refresh().catch(() => {});
      navigate(`/game/${res.joinCode}`);
    } catch (err) {
      setRowError({
        id: game._id,
        message:
          err instanceof ApiRequestError ? err.message : "Could not join game",
      });
      load();
    } finally {
      setBusyId(null);
    }
  }

  const createForm = (
    <div className="space-y-3 px-4 md:px-2">
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
        onChange={(e) => setVariant(e.target.value as GameVariant)}
      >
        <option value="standard">Standard</option>
        <option value="chess960">Chess960</option>
      </Select>
      <Input
        label={
          <span className="inline-flex items-center gap-1">
            <RCoin size={12} /> Wager (optional)
          </span>
        }
        type="number"
        min={0}
        max={MAX_WAGER_TOKENS}
        step={1}
        value={wagerInput}
        onChange={(e) => setWagerInput(e.target.value)}
        error={
          wagerBelowFloor
            ? `Enter 0 for a free game, or at least ${MIN_STAKE_TOKENS} R`
            : wagerTooHigh
              ? "Not enough R Coins"
              : undefined
        }
        hint={
          wagerBelowFloor || wagerTooHigh
            ? undefined
            : wagerTokens === 0
              ? "Free game, no R Coins at stake"
              : winnerTakes !== null
                ? `Winner takes ${winnerTakes}`
                : undefined
        }
      />
      <Button
        className="mt-1 w-full"
        onClick={handleCreate}
        loading={creating}
        disabled={wagerBelowFloor || wagerTooHigh}
      >
        <Plus className="h-4 w-4" /> List game
      </Button>
      {wagerTokens > 0 && !wagerBelowFloor && !wagerTooHigh && (
        <p className="text-center text-xs text-base-content/50">
          Your {wagerTokens} R is held while the game is listed and refunded if
          you cancel.
        </p>
      )}
      {createError && <p className="text-sm text-red-400">{createError}</p>}
    </div>
  );

  return (
    <Page
      title="Lobby"
      description="Accept a listed game, or put up your own."
      responsiveDescription
      back="/"
      actions={
        <ResponsiveOverlay
          title="List a new game"
          icon={<Plus />}
          align="end"
          className="w-80 max-w-[calc(100vw-2rem)]"
          open={createOpen}
          onOpenChange={(o) => {
            setCreateOpen(o);
            if (o) setCreateError("");
          }}
          trigger={
            <Button
              disabled={hasGame}
              title={
                hasGame ? "Finish or cancel your current game first" : undefined
              }
            >
              <Plus className="h-4 w-4" /> List new game
            </Button>
          }
        >
          {createForm}
        </ResponsiveOverlay>
      }
    >
      <div className="space-y-4">
        <RestrictionBanner />

        {/* In a live game already, the one-game-at-a-time rule (see
         *  MAX_ACTIVE_GAMES_PER_USER server-side) blocks listing/accepting,
         *  so say so and offer the way back in. */}
        {myGame?.status === "active" && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-(--primary)/40 bg-(--primary)/5 px-4 py-3">
            <p className="min-w-0 truncate text-sm font-medium text-base-content">
              You're in a game with{" "}
              {myGame.white._id === user?.id
                ? myGame.black?.username
                : myGame.white.username}
            </p>
            <Link to={`/game/${myGame.joinCode}`} className="shrink-0">
              <Button size="sm">
                <Play className="h-4 w-4" /> Resume
              </Button>
            </Link>
          </div>
        )}

        <Card variant="solid">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gamepad2 className="h-4 w-4 text-blue-600" /> Open games
              {games && games.length > 0 && (
                <Badge variant="neutral">{games.length}</Badge>
              )}
            </CardTitle>
            {loadError && (
              <span className="text-xs text-red-400">{loadError}</span>
            )}
          </CardHeader>
          <CardContent className="space-y-2.5">
            {games === null && (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            )}
            {games && sorted.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600/15 text-blue-600">
                  <Gamepad2 className="h-6 w-6" />
                </span>
                <p className="text-sm font-semibold text-base-content">
                  No open games right now
                </p>
                <p className="max-w-xs text-xs text-base-content/50">
                  Be the first, hit “List new game” and someone will pick it up.
                </p>
              </div>
            )}
            {sorted.map((g) => {
              const mine = g.white._id === user?.id;
              const cantAfford = balance !== null && g.wagerTokens > balance;
              const disabled = hasGame || cantAfford;
              return (
                <div key={g._id}>
                  <div
                    className={`flex flex-col gap-2.5 rounded-2xl border px-3.5 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
                      mine
                        ? "border-(--primary)/40 bg-(--primary)/5"
                        : "border-base-300 bg-base-100/60 hover:border-base-content/20"
                    }`}
                  >
                    {/* Below sm the card stacks into two rows (who + time
                     *  control on top, wager + action buttons underneath)
                     *  so the player name gets the whole card width instead
                     *  of what's left beside the buttons, that side-by-side
                     *  layout was truncating names to a few letters on
                     *  phones. From sm up it's the original single row. */}
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar
                        username={g.white.username}
                        gradient={g.white.avatarGradient}
                        size="md"
                      />
                      <div className="min-w-0 flex-1 text-sm text-base-content">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Link
                            to={`/profile/${g.white.username}`}
                            className="min-w-0 truncate font-semibold hover:underline"
                          >
                            {mine ? "You" : g.white.username}
                          </Link>
                          <span className="shrink-0">
                            <RatingBadge rating={g.white.rating} />
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-base-content/50">
                          <span className="inline-flex items-center gap-1">
                            <TimeControlIcon
                              baseSeconds={g.timeControl.baseSeconds}
                              size={12}
                            />
                            {formatTimeControl(g.timeControl)}
                          </span>
                          <span>· {variantLabel(g.variant)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-base-300/60 pt-2.5 sm:justify-end sm:border-t-0 sm:pt-0">
                      {g.wagerTokens > 0 ? (
                        <span className="inline-flex items-center gap-1 text-sm font-bold text-amber-400 tabular-nums">
                          {g.wagerTokens} <RCoin size={14} />
                        </span>
                      ) : (
                        <Badge variant="neutral">Free</Badge>
                      )}
                      {mine ? (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="glass"
                            size="sm"
                            loading={busyId === g._id}
                            onClick={() => handleCancel(g)}
                          >
                            Cancel
                          </Button>
                          <Link to={`/game/${g.joinCode}`}>
                            <Button size="sm">Open</Button>
                          </Link>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          loading={busyId === g._id}
                          disabled={disabled}
                          title={
                            hasGame
                              ? "Finish or cancel your current game first"
                              : cantAfford
                                ? "Not enough R Coins"
                                : undefined
                          }
                          onClick={() => handleAccept(g)}
                        >
                          Accept
                        </Button>
                      )}
                    </div>
                  </div>
                  {rowError?.id === g._id && (
                    <p className="mt-1 px-1 text-sm text-red-400">
                      {rowError.message}
                    </p>
                  )}
                </div>
              );
            })}
            {createError && !createOpen && (
              <p className="text-sm text-red-400">{createError}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
