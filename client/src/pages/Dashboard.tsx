import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Swords,
  Trophy,
  Users,
  Plus,
  Hash,
  Wallet,
  ArrowRight,
  ArrowDownToLine,
  History,
  Eye,
  EyeOff,
  type LucideIcon,
} from "lucide-react";
import {
  createGame,
  listFriendsActiveGames,
  listMyActiveGames,
  type ActiveFriendGame,
  type MyActiveGame,
} from "../api/games.js";
import { ApiRequestError } from "../api/http.js";
import { useAuth } from "../contexts/AuthContext.js";
import { TIME_CONTROLS, formatTimeControl } from "../timeControls.js";
import { extractGameCode } from "../lib/utils.js";
import { MAX_WAGER_TOKENS, MIN_STAKE_TOKENS } from "../lib/limits.js";
import { useTokenBalance } from "../hooks/useTokenBalance.js";
import { useBalanceVisibility } from "../hooks/useBalanceVisibility.js";
import { useRakePercent } from "../hooks/useRakePercent.js";
import {
  listOpenTournaments,
  formatTimeControl as formatTournamentTimeControl,
  type Tournament,
} from "../api/tournaments.js";
import { listMyCageMatches, type CageMatch } from "../api/cageMatches.js";
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
  ResponsiveOverlay,
  Avatar,
} from "../components/ui/index.js";

/** A single tappable/clickable tile for the quick-links grid, one icon,
 *  one label, one destination. */
function QuickLink({
  to,
  icon: Icon,
  label,
  accent,
  className = "",
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  accent: string;
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
          className={`flex h-10 w-10 items-center justify-center rounded-full ${accent}`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="text-sm font-semibold text-base-content">{label}</span>
      </Card>
    </Link>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tcIndex, setTcIndex] = useState(2);
  const [variant, setVariant] = useState<"standard" | "chess960">("standard");
  const [wagerInput, setWagerInput] = useState("20");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeGames, setActiveGames] = useState<ActiveFriendGame[] | null>(
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

  const [openTournaments, setOpenTournaments] = useState<Tournament[] | null>(
    null,
  );
  const [cageMatches, setCageMatches] = useState<CageMatch[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyActiveGames()
      .then((res) => !cancelled && setMyGame(res.games[0] ?? null))
      .catch(() => !cancelled && setMyGame(null));
    listFriendsActiveGames()
      .then((res) => !cancelled && setActiveGames(res.games))
      .catch(() => !cancelled && setGamesError("Failed to load active games."));
    listOpenTournaments("pending")
      .then((res) => !cancelled && setOpenTournaments(res.tournaments))
      .catch(() => !cancelled && setOpenTournaments([]));
    listMyCageMatches()
      .then((res) => !cancelled && setCageMatches(res.matches))
      .catch(() => !cancelled && setCageMatches([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const wagerTokens = Math.min(
    MAX_WAGER_TOKENS,
    Math.max(MIN_STAKE_TOKENS, Math.floor(Number(wagerInput) || 0)),
  );
  const rakePercent = useRakePercent();
  const wagerRake =
    rakePercent !== null
      ? Math.floor((wagerTokens * 2 * rakePercent) / 100)
      : null;

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
    const code = extractGameCode(joinCodeInput);
    if (code) navigate(`/game/${code}`);
  }

  const activeCageMatches =
    cageMatches?.filter((m) => m.status === "active") ?? [];
  const recentCageMatches =
    cageMatches?.filter((m) => m.status === "finished").slice(0, 3) ?? [];

  return (
    <Page title={`Welcome, ${user?.username ?? ""}`}>
      <div className="space-y-4">
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
              <RCoin size={14} /> R Coin Balance
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

        {/* Quick links, the three other big areas of the app, one tap
         *  away, with an icon so this reads at a glance instead of as a
         *  wall of text links. */}
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <QuickLink
            to="/players"
            icon={Users}
            label="Players"
            accent="bg-blue-500/15 text-blue-400"
          />
          <QuickLink
            to="/cage"
            icon={Swords}
            label="Cage matches"
            accent="bg-rose-500/15 text-rose-400"
          />
          <QuickLink
            to="/tournaments"
            icon={Trophy}
            label="Tournaments"
            accent="bg-amber-500/15 text-amber-400"
            className="col-span-2 sm:col-span-1"
          />
        </div>

        {/* Play, create/join, collapsed behind a ResponsiveOverlay trigger
         *  (Modal on phone, Popover on desktop) instead of two permanently
         *  expanded forms taking up the top of the dashboard. */}
        <Card variant="solid">
          <CardHeader>
            <CardTitle>Play</CardTitle>
          </CardHeader>
          {myGame ? (
            // Mirrors the "Friends currently playing" row below, this is
            // the same "who, at what point, for what stakes" summary,
            // just for your own game instead of a friend's, and a
            // "Resume" action instead of "Watch". Shown instead of the
            // create/join form below because there's nothing to create or
            // join right now anyway, one game at a time (see
            // MAX_ACTIVE_GAMES_PER_USER server-side).
            <CardContent>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-(--primary)/40 bg-(--primary)/5 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex shrink-0 -space-x-2">
                    <Avatar
                      username={myGame.white.username}
                      gradient={myGame.white.avatarGradient}
                      size="sm"
                      className="ring-2 rounded-full ring-base-100"
                    />
                    {myGame.black && (
                      <Avatar
                        username={myGame.black.username}
                        gradient={myGame.black.avatarGradient}
                        size="sm"
                        className="ring-2 rounded-full ring-base-100"
                      />
                    )}
                  </div>
                  <div className="min-w-0 text-sm text-base-content">
                    <div className="truncate font-medium">
                      {myGame.black ? (
                        <>
                          {myGame.white._id === user?.id
                            ? "You"
                            : myGame.white.username}{" "}
                          <span className="text-base-content/40">vs</span>{" "}
                          {myGame.black._id === user?.id
                            ? "You"
                            : myGame.black.username}
                        </>
                      ) : (
                        "Waiting for an opponent…"
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-base-content/50">
                      <span>
                        {myGame.moves.length > 0
                          ? `Move ${Math.ceil(myGame.moves.length / 2)} · `
                          : ""}
                        {formatTimeControl(myGame.timeControl)}
                      </span>
                      {myGame.wagerTokens > 0 && (
                        <Badge variant="warning">
                          <span className="inline-flex items-center gap-1">
                            {myGame.wagerTokens} <RCoin size={10} />
                          </span>
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <Link to={`/game/${myGame.joinCode}`} className="shrink-0">
                  <Button size="sm">Resume</Button>
                </Link>
              </div>
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
                  >
                    <option value="standard">Standard</option>
                    <option value="chess960">Chess960 </option>
                  </Select>

                  <Input
                    label={
                      <span className="inline-flex items-center gap-1">
                        <RCoin size={12} /> Coin wager
                      </span>
                    }
                    type="number"
                    min={MIN_STAKE_TOKENS}
                    max={MAX_WAGER_TOKENS}
                    step={1}
                    value={wagerInput}
                    onChange={(e) => setWagerInput(e.target.value)}
                    hint={
                      wagerRake !== null
                        ? `You'll stake ${wagerTokens} R Coins now. Winner takes ${wagerTokens * 2 - wagerRake} (${rakePercent}% platform fee).`
                        : `You'll stake ${wagerTokens} R Coins now.`
                    }
                  />

                  <Button
                    className="w-full mt-3"
                    onClick={handleCreate}
                    loading={creating}
                    disabled={wagerTokens < MIN_STAKE_TOKENS}
                  >
                    Create game
                  </Button>
                  {error && <p className="text-sm text-red-400">{error}</p>}
                </div>
              </ResponsiveOverlay>

              <div className="flex flex-1 gap-2">
                <Input
                  type="text"
                  placeholder="Join by code or link, e.g. 7K3M9P"
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

        {(gamesError || activeGames === null || activeGames.length > 0) && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>Friends currently playing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {gamesError && (
                <p className="text-sm text-red-400">{gamesError}</p>
              )}
              {!gamesError && activeGames === null && (
                <p className="text-sm text-base-content/60">Loading…</p>
              )}
              {activeGames &&
                activeGames.map((g) => {
                  return (
                    <div
                      key={g._id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100/60 px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex shrink-0 -space-x-2">
                          <Avatar
                            username={g.white.username}
                            gradient={g.white.avatarGradient}
                            size="sm"
                            className="ring-2 rounded-full ring-base-100"
                          />
                          <Avatar
                            username={g.black.username}
                            gradient={g.black.avatarGradient}
                            size="sm"
                            className="ring-2 rounded-full ring-base-100"
                          />
                        </div>
                        <div className="min-w-0 text-sm text-base-content">
                          <div className="truncate">
                            <Link
                              to={`/profile/${g.white.username}`}
                              className="hover:underline"
                            >
                              {g.white.username}
                            </Link>{" "}
                            <span className="text-base-content/40">vs</span>{" "}
                            <Link
                              to={`/profile/${g.black.username}`}
                              className="hover:underline"
                            >
                              {g.black.username}
                            </Link>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-base-content/50">
                            <span>
                              Move {Math.ceil(g.moves.length / 2)} ·{" "}
                              {formatTimeControl(g.timeControl)}
                            </span>
                            {g.wagerTokens > 0 && (
                              <Badge variant="warning">
                                <span className="inline-flex items-center gap-1">
                                  {g.wagerTokens} <RCoin size={10} />
                                </span>
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <Link to={`/game/${g.joinCode}`} className="shrink-0">
                        <Button variant="glass" size="sm">
                          Watch
                        </Button>
                      </Link>
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        )}

        <Card variant="solid">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" /> Open tournaments
            </CardTitle>
            <Link
              to="/tournaments"
              className="text-sm text-(--primary) hover:underline"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {openTournaments === null && (
              <p className="text-sm text-base-content/60">Loading…</p>
            )}
            {openTournaments && openTournaments.length === 0 && (
              <p className="text-sm text-base-content/60">
                No open tournaments right now.
              </p>
            )}
            {openTournaments &&
              openTournaments.slice(0, 4).map((t) => (
                <Link
                  key={t._id}
                  to={`/tournaments/${t.code}`}
                  className="flex items-center justify-between gap-2 border-b border-base-300 py-2 last:border-none hover:text-(--primary)"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-base-content">
                      {t.name}
                    </p>
                    <p className="text-xs text-base-content/50">
                      {formatTournamentTimeControl(t)} · {t.players.length}/
                      {t.maxPlayers} players
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-base-content/40" />
                </Link>
              ))}
          </CardContent>
        </Card>

        <Card variant="solid">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Swords className="h-4 w-4 text-rose-400" /> Cage matches
            </CardTitle>
            <Link
              to="/cage"
              className="text-sm text-(--primary) hover:underline"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {cageMatches === null && (
              <p className="text-sm text-base-content/60">Loading…</p>
            )}
            {cageMatches &&
              activeCageMatches.length === 0 &&
              recentCageMatches.length === 0 && (
                <p className="text-sm text-base-content/60">
                  No cage matches yet.
                </p>
              )}
            {[...activeCageMatches, ...recentCageMatches].map((m) => {
              const opponent =
                m.player1._id === user?.id ? m.player2 : m.player1;
              return (
                <Link
                  key={m._id}
                  to={`/cage/${m.matchCode}`}
                  className="flex items-center justify-between gap-2 border-b border-base-300 py-2 last:border-none hover:text-(--primary)"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-base-content">
                      vs {opponent.username}
                    </p>
                    <p className="text-xs text-base-content/50">
                      Leg {m.currentLegIndex + 1}/{m.legs.length}
                    </p>
                  </div>
                  <Badge
                    variant={m.status === "active" ? "success" : "neutral"}
                  >
                    {m.status === "active" ? "Active" : "Finished"}
                  </Badge>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-2 pb-2 text-xs text-base-content/50">
          <Link to="/about" className="hover:text-base-content hover:underline">
            About us
          </Link>
          <span className="text-base-content/20">·</span>
          <Link to="/terms" className="hover:text-base-content hover:underline">
            Terms of Service
          </Link>
        </footer>
      </div>
    </Page>
  );
}
