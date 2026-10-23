import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Plus,
  Hash,
  Wallet,
  ArrowDownToLine,
  History,
  Eye,
  EyeOff,
  Zap,
  type LucideIcon,
  Gamepad2,
} from "lucide-react";
import {
  createGame,
  listFollowingActiveGames,
  listMyActiveGames,
  listOpenGames,
  type ActiveFollowingGame,
  type MyActiveGame,
} from "../api/games.js";
import { ApiRequestError } from "../api/http.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useSocket } from "../contexts/SocketContext.js";
import { DailySummaryCard } from "../components/daily/DailySummaryCard.js";
import { LiveGameRow } from "../components/lists/LiveGameRow.js";
import { RestrictionBanner } from "../components/RestrictionBanner.js";
import {
  GameSettingsFields,
  useGameSettings,
} from "../components/game/GameSettingsFields.js";
import { extractGameCode } from "../lib/utils.js";
import { useTokenBalance } from "../hooks/useTokenBalance.js";
import { useBalanceVisibility } from "../hooks/useBalanceVisibility.js";
import { useRakePercent } from "../hooks/useRakePercent.js";
import {
  Page,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  Button,
  RCoin,
  ListCard,
  ResponsiveOverlay,
} from "../components/ui/index.js";

/** A single tappable/clickable tile for the quick-links grid, one icon,
 *  one label, one destination. */
function QuickLink({
  to,
  icon: Icon,
  label,
  accent,
  badge,
  className = "",
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  accent: string;
  /** Small count pill on the icon's corner; hidden when 0/undefined. */
  badge?: number;
  className?: string;
}) {
  return (
    <Link to={to} className={`flex-1 ${className}`}>
      <Card
        variant="solid"
        interactive
        className="flex h-full flex-col items-center gap-2 py-5 text-center"
      >
        <span
          className={`relative flex h-10 w-10 items-center justify-center rounded-full ${accent}`}
        >
          <Icon className="h-5 w-5" />
          {badge !== undefined && badge > 0 && (
            <span
              aria-label={`${badge} open ${badge === 1 ? "game" : "games"}`}
              className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold leading-none text-white tabular-nums ring-2 ring-base-100"
            >
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </span>
        <span className="text-sm font-semibold text-base-content">{label}</span>
      </Card>
    </Link>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const gameSettings = useGameSettings(2);
  const { wagerTokens, wagerBelowFloor } = gameSettings;
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeGames, setActiveGames] = useState<ActiveFollowingGame[] | null>(
    null,
  );
  const [gamesError, setGamesError] = useState("");
  // Your own current game, if you have one (at most one, see
  // MAX_ACTIVE_GAMES_PER_USER server-side). When set, the Play card below
  // shows this instead of the create/join form, there's nothing to create
  // or join while it's occupied anyway.
  const [myGame, setMyGame] = useState<MyActiveGame | null | undefined>(
    undefined,
  );
  const { balance, refresh } = useTokenBalance();
  const { hidden: balanceHidden, toggle: toggleBalanceHidden } =
    useBalanceVisibility();

  // Number of open games in the lobby that someone else posted (the ones
  // you could actually join), shown as a badge on the Lobby tile. Pushed
  // live via lobby:changed, same signal the Lobby page itself uses.
  const socket = useSocket();
  const [lobbyCount, setLobbyCount] = useState(0);
  const lobbyInFlight = useRef(false);
  const lobbyQueued = useRef(false);
  const loadLobbyCount = useCallback(async () => {
    if (lobbyInFlight.current) {
      lobbyQueued.current = true;
      return;
    }
    lobbyInFlight.current = true;
    try {
      const { games } = await listOpenGames();
      setLobbyCount(games.filter((g) => g.white._id !== user?.id).length);
    } catch {
      // Badge is decorative; keep the last known count.
    } finally {
      lobbyInFlight.current = false;
      if (lobbyQueued.current) {
        lobbyQueued.current = false;
        void loadLobbyCount();
      }
    }
  }, [user?.id]);

  useEffect(() => {
    void loadLobbyCount();
    if (!socket) return;
    const s = socket;
    const watch = () => {
      s.emit("lobby:watch");
      void loadLobbyCount();
    };
    s.on("connect", watch);
    s.on("lobby:changed", loadLobbyCount);
    if (s.connected) s.emit("lobby:watch");
    return () => {
      s.off("connect", watch);
      s.off("lobby:changed", loadLobbyCount);
      s.emit("lobby:unwatch");
    };
  }, [socket, loadLobbyCount]);

  useEffect(() => {
    let cancelled = false;
    listMyActiveGames()
      .then((res) => !cancelled && setMyGame(res.games[0] ?? null))
      .catch(() => !cancelled && setMyGame(null));
    listFollowingActiveGames()
      .then((res) => !cancelled && setActiveGames(res.games))
      .catch(() => !cancelled && setGamesError("Failed to load active games."));

    return () => {
      cancelled = true;
    };
  }, []);

  const rakePercent = useRakePercent();
  const wagerRake =
    rakePercent !== null
      ? Math.floor((wagerTokens * 2 * rakePercent) / 100)
      : null;

  async function handleCreate() {
    const { timeControl: tc, variant } = gameSettings;
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
    const code = extractGameCode(joinCodeInput);
    if (code) navigate(`/game/${code}`);
  }

  return (
    <Page title={`Welcome, ${user?.username ?? ""}`}>
      <div className="space-y-4">
        <RestrictionBanner />
        <Card
          variant="solid"
          className="bg-black/0! border-black/0! from-primary/0 to-primary/10 bg-linear-to-tr relative overflow-hidden p-5"
        >
          {/* A faint oversized coin watermark, bleeding off the top-right
           *  corner, the kind of restrained brand flourish an actual
           *  fintech balance card leans on instead of a flat, un-styled
           *  block. Purely decorative: aria-hidden, and pointer-events-none
           *  so it never intercepts the buttons below it. */}
          <RCoin
            size={140}
            className="pointer-events-none absolute -top-8 -right-8 opacity-[0.07]"
          />

          <div className="relative flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-base-content/50 uppercase">
              <RCoin size={14} /> Rabah Coin Balance
            </p>
            <button
              type="button"
              onClick={toggleBalanceHidden}
              aria-label={balanceHidden ? "Show balance" : "Hide balance"}
              className="flex h-7 w-7 items-center justify-center rounded-full text-base-content/40 transition-colors hover:bg-base-content/10 hover:text-base-content/70"
            >
              {balanceHidden ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
            </button>
          </div>

          <p className="relative mt-1 text-4xl font-bold tracking-tight text-base-content tabular-nums">
            {balanceHidden ? (
              <span aria-label="Balance hidden">••••••</span>
            ) : balance ? (
              balance.toLocaleString()
            ) : (
              "…"
            )}
          </p>

          <div className="relative mt-5 flex flex-wrap gap-2">
            <Link to="/wallet/buy" className="flex-1 sm:flex-none">
              <Button size="sm" fullWidth className="sm:w-auto">
                <Wallet className="h-4 w-4" /> Buy
              </Button>
            </Link>
            <Link to="/wallet/withdraw" className="flex-1 sm:flex-none">
              <Button variant="glass" size="sm" fullWidth className="sm:w-auto">
                <ArrowDownToLine className="h-4 w-4" /> Withdraw
              </Button>
            </Link>
            <Link to="/wallet/transactions" className="flex-1 hidden sm:flex">
              <Button variant="glass" size="sm" fullWidth className="sm:w-auto">
                <History className="h-4 w-4" /> History
              </Button>
            </Link>
          </div>
        </Card>

        {/* Quick links, the other big areas of the app, one tap
         *  away, with an icon so this reads at a glance instead of as a
         *  wall of text links. */}
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <QuickLink
            to="/lobby"
            icon={Gamepad2}
            label="Lobby"
            accent="bg-blue-600/15 text-blue-500"
            badge={lobbyCount}
          />
          <QuickLink
            to="/play"
            icon={Zap}
            label="Quick pairing"
            accent="bg-emerald-500/15 text-emerald-400"
          />
        </div>

        <DailySummaryCard />

        {/* Play, create/join, collapsed behind a ResponsiveOverlay trigger
         *  (Modal on phone, Popover on desktop) instead of two permanently
         *  expanded forms taking up the top of the dashboard. */}
        <Card variant="solid">
          <CardHeader>
            <CardTitle>Play</CardTitle>
          </CardHeader>
          {myGame ? (
            // Mirrors the "Following currently playing" row below, this is
            // the same "who, at what point, for what stakes" summary,
            // just for your own game instead of a followed player's, and a
            // "Resume" action instead of "Watch". Shown instead of the
            // create/join form below because there's nothing to create or
            // join right now anyway, one game at a time (see
            // MAX_ACTIVE_GAMES_PER_USER server-side).
            <CardContent>
              <LiveGameRow
                highlight
                white={{
                  username: myGame.white.username,
                  avatarGradient: myGame.white.avatarGradient,
                  label: myGame.white._id === user?.id ? "You" : undefined,
                }}
                black={
                  myGame.black && {
                    username: myGame.black.username,
                    avatarGradient: myGame.black.avatarGradient,
                    label: myGame.black._id === user?.id ? "You" : undefined,
                  }
                }
                timeControl={myGame.timeControl}
                moveCount={myGame.moves.length}
                wagerTokens={myGame.wagerTokens}
                action={
                  <Link to={`/game/${myGame.joinCode}`}>
                    <Button size="sm">Resume</Button>
                  </Link>
                }
              />
            </CardContent>
          ) : (
            <CardContent className="flex flex-col gap-3 sm:flex-row">
              <ResponsiveOverlay
                title="Create a new game"
                align="start"
                icon={<Plus></Plus>}
                className="w-80 max-w-[calc(100vw-2rem)]"
                trigger={
                  <Button className="w-full sm:w-auto">
                    <Plus className="h-4 w-4" /> Create game
                  </Button>
                }
              >
                <div className="space-y-3 px-4 md:px-2">
                  <GameSettingsFields
                    settings={gameSettings}
                    wagerHint={
                      wagerTokens === 0
                        ? "Free game, no R Coins at stake"
                        : wagerRake !== null
                          ? `Winner takes ${wagerTokens * 2 - wagerRake}`
                          : undefined
                    }
                  />

                  <Button
                    className="w-full mt-3"
                    onClick={handleCreate}
                    loading={creating}
                    disabled={wagerBelowFloor}
                  >
                    Create game
                  </Button>
                  {error && <p className="text-sm text-red-400">{error}</p>}
                </div>
              </ResponsiveOverlay>

              <div className="flex flex-1 gap-2">
                <Input
                  type="text"
                  placeholder="Join by code or link, e.g. 7kM3pR"
                  maxLength={200}
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                  leadingIcon={<Hash className="h-4 w-4" />}
                />
                <Button variant="glass" onClick={handleJoinByCode}>
                  Join
                </Button>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Only games of people you follow, and only once there is
         *  something to show. Rendering the card while the request was
         *  still in flight made it flash on the dashboard for users
         *  whose followed players aren't playing. */}
        {(gamesError || (activeGames !== null && activeGames.length > 0)) && (
          <ListCard title="Following currently playing">
            {gamesError && <p className="text-sm text-red-400">{gamesError}</p>}
            {activeGames?.map((g) => (
              <LiveGameRow
                key={g._id}
                white={{
                  username: g.white.username,
                  avatarGradient: g.white.avatarGradient,
                  profileHref: `/profile/${g.white.username}`,
                }}
                black={{
                  username: g.black.username,
                  avatarGradient: g.black.avatarGradient,
                  profileHref: `/profile/${g.black.username}`,
                }}
                timeControl={g.timeControl}
                moveCount={g.moves.length}
                wagerTokens={g.wagerTokens}
                action={
                  <Link to={`/game/${g.joinCode}`}>
                    <Button variant="glass" size="sm">
                      Watch
                    </Button>
                  </Link>
                }
              />
            ))}
          </ListCard>
        )}

        <footer className="flex flex-col items-center gap-y-1 pt-2 pb-2 text-xs text-base-content/50">
          <div className="flex items-center justify-center gap-x-4">
            <Link
              to="/about"
              className="hover:text-base-content hover:underline"
            >
              About us
            </Link>
            <span className="text-base-content/20">·</span>
            <Link
              to="/terms"
              className="hover:text-base-content hover:underline"
            >
              Terms of Service
            </Link>
          </div>
        </footer>
      </div>
    </Page>
  );
}
