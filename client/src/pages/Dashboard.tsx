import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Chess } from "chess.js";
import {
  Swords,
  Trophy,
  Users,
  Plus,
  Hash,
  Wallet,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
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
} from "../components/ui/index.js";

/** A single tappable/clickable tile for the quick-links grid — one icon,
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
  const [wagerInput, setWagerInput] = useState("10");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeGames, setActiveGames] = useState<ActiveFriendGame[] | null>(
    null,
  );
  const [gamesError, setGamesError] = useState("");
  const { balance, refresh } = useTokenBalance();

  const [openTournaments, setOpenTournaments] = useState<Tournament[] | null>(
    null,
  );
  const [cageMatches, setCageMatches] = useState<CageMatch[] | null>(null);

  useEffect(() => {
    let cancelled = false;
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

  const wagerTokens = Math.max(1, Math.floor(Number(wagerInput) || 0));
  const rakePercent = useRakePercent();
  const wagerRake = rakePercent !== null ? Math.floor((wagerTokens * 2 * rakePercent) / 100) : null;

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

  const activeCageMatches =
    cageMatches?.filter((m) => m.status === "active") ?? [];
  const recentCageMatches =
    cageMatches
      ?.filter((m) => m.status === "finished")
      .slice(0, 3) ?? [];

  return (
    <Page title={`Welcome, ${user?.username ?? ""}`}>
      <div className="space-y-4">
        <Card variant="solid" className="elevated-responsive flex items-center justify-between">
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
              <Button size="sm">
                <Wallet className="h-4 w-4" /> Buy
              </Button>
            </Link>
            <Link className="hidden sm:flex" to="/wallet/withdraw">
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

        {/* Quick links — the three other big areas of the app, one tap
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

        {/* Play — create/join, collapsed behind a ResponsiveOverlay trigger
         *  (Modal on phone, Popover on desktop) instead of two permanently
         *  expanded forms taking up the top of the dashboard. */}
        <Card variant="solid">
          <CardHeader>
            <CardTitle>Play</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <ResponsiveOverlay
              title="Create a new game"
              align="start"
              className="w-80 max-w-[calc(100vw-2rem)]"
              trigger={
                <Button className="w-full sm:w-auto">
                  <Plus className="h-4 w-4" /> Create game
                </Button>
              }
            >
              <div className="space-y-3">
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
                  min={1}
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
                  className="w-full"
                  onClick={handleCreate}
                  loading={creating}
                  disabled={wagerTokens < 1}
                >
                  Create game
                </Button>
                {error && <p className="text-sm text-red-400">{error}</p>}
              </div>
            </ResponsiveOverlay>

            <div className="flex flex-1 gap-2">
              <Input
                type="text"
                placeholder="Join by code, e.g. 7K3M9P"
                maxLength={10}
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                className="uppercase"
                leadingIcon={<Hash className="h-4 w-4" />}
              />
              <Button variant="glass" onClick={handleJoinByCode}>
                Join
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card variant="solid">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" /> Open tournaments
            </CardTitle>
            <Link to="/tournaments" className="text-sm text-(--primary) hover:underline">
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
            <Link to="/cage" className="text-sm text-(--primary) hover:underline">
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
                  <Badge variant={m.status === "active" ? "success" : "neutral"}>
                    {m.status === "active" ? "Active" : "Finished"}
                  </Badge>
                </Link>
              );
            })}
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
