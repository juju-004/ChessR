import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Plus, Puzzle, Timer } from "lucide-react";
import {
  createRace,
  DIFFICULTY_LABEL,
  getMyRace,
  listOpenRaces,
  type PuzzleRace,
} from "../api/puzzleRaces.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useTokenBalance } from "../hooks/useTokenBalance.js";
import { useRakePercent } from "../hooks/useRakePercent.js";
import { errMsg } from "../lib/errMsg.js";
import { RestrictionBanner } from "../components/RestrictionBanner.js";
import {
  RaceSettingsFields,
  useRaceSettings,
} from "../components/puzzles/RaceSettingsFields.js";
import {
  Page,
  Card,
  CardContent,
  Button,
  Badge,
  RCoin,
  AvatarStack,
  CardRow,
  CenteredSpinner,
  ListCard,
  ResponsiveOverlay,
} from "../components/ui/index.js";

// Safety net for a dropped socket event; the list is otherwise pushed live.
const POLL_MS = 60_000;

/** What the winner receives from a pot after the platform's cut. */
export function winnerTakes(pot: number, rakePercent: number | null): number | null {
  if (rakePercent === null || pot <= 0) return null;
  return pot - Math.floor((pot * rakePercent) / 100);
}

/** The Puzzle Races page: put up a race (optionally with a coin wager) or
 *  join one somebody else listed. Everyone in a race gets the same puzzles
 *  and the first to solve them all takes the pot. The list is pushed live over
 *  the socket (puzzleRaces:changed), see puzzleRaceSocket.ts server-side. */
export function PuzzleRaces() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const socket = useSocket();
  const { balance, refresh } = useTokenBalance();
  const rakePercent = useRakePercent();

  const [races, setRaces] = useState<PuzzleRace[] | null>(null);
  const [mine, setMine] = useState<{ code: string; status: "waiting" | "active" } | null>(null);
  const [loadError, setLoadError] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const settings = useRaceSettings();
  const { wagerTokens, wagerBelowFloor } = settings;

  const load = useCallback(async () => {
    try {
      const [open, current] = await Promise.all([listOpenRaces(), getMyRace()]);
      setRaces(open.races);
      setMine(current.race);
      setLoadError("");
    } catch (err) {
      setLoadError(errMsg(err));
      setRaces((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!socket) return;
    const s = socket;
    const watch = () => {
      s.emit("puzzleRaces:watch");
      load(); // anything that changed while we were disconnected
    };
    s.on("connect", watch);
    s.on("puzzleRaces:changed", load);
    if (s.connected) s.emit("puzzleRaces:watch");
    return () => {
      s.off("connect", watch);
      s.off("puzzleRaces:changed", load);
      s.emit("puzzleRaces:unwatch");
    };
  }, [socket, load]);

  const wagerTooHigh = balance !== null && wagerTokens > balance;
  const inRace = !!mine;

  async function handleCreate() {
    setCreateError("");
    setCreating(true);
    try {
      const { code } = await createRace({
        difficulty: settings.difficulty,
        puzzleCount: settings.puzzleCount,
        maxPlayers: settings.maxPlayers,
        wagerTokens,
      });
      refresh().catch(() => {});
      setCreateOpen(false);
      navigate(`/puzzles/${code}`);
    } catch (err) {
      setCreateError(errMsg(err));
    } finally {
      setCreating(false);
    }
  }

  const pot = wagerTokens * settings.maxPlayers;
  const takes = winnerTakes(pot, rakePercent);

  const hasOpenRaces = (races?.length ?? 0) > 0;
  const showDescription = races !== null && !hasOpenRaces && !mine;

  const createForm = (
    <div className="space-y-3 px-4 md:px-2">
      <RaceSettingsFields
        settings={settings}
        wagerError={wagerTooHigh ? "Not enough R Coins" : undefined}
        wagerHint={
          wagerTokens === 0
            ? "Free race, no R Coins at stake"
            : takes !== null
              ? `Full table: winner takes ${takes}`
              : undefined
        }
      />
      <Button
        className="mt-1 w-full"
        onClick={handleCreate}
        loading={creating}
        disabled={wagerBelowFloor || wagerTooHigh}
      >
        <Plus className="h-4 w-4" /> Open race
      </Button>
      {wagerTokens > 0 && !wagerBelowFloor && !wagerTooHigh && (
        <p className="text-center text-xs text-base-content/50">
          Your {wagerTokens} R is held while the race is open and refunded if
          you cancel.
        </p>
      )}
      {createError && <p className="text-sm text-red-400">{createError}</p>}
    </div>
  );

  return (
    <Page
      title="Puzzle races"
      description="Everyone solves the same puzzles. First to finish wins the pot."
      responsiveDescription
      back="/"
      actions={
        <ResponsiveOverlay
          title="Open a race"
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
              disabled={inRace}
              title={inRace ? "Finish or leave your current race first" : undefined}
            >
              <Plus className="h-4 w-4" /> New race
            </Button>
          }
        >
          {createForm}
        </ResponsiveOverlay>
      }
    >
      <div className="space-y-4">
        <RestrictionBanner />

        {mine && (
          <CardRow highlight>
            <p className="min-w-0 truncate text-sm font-medium text-base-content">
              {mine.status === "active"
                ? "Your race is underway."
                : "You're waiting in a race that hasn't started."}
            </p>
            <Link to={`/puzzles/${mine.code}`} className="shrink-0">
              <Button size="sm">{mine.status === "active" ? "Back to race" : "Open"}</Button>
            </Link>
          </CardRow>
        )}

        {races === null && !loadError && <CenteredSpinner className="py-8" />}

        {loadError && !hasOpenRaces && (
          <p className="text-sm text-red-400">{loadError}</p>
        )}

        {hasOpenRaces && (
        <ListCard title="Open races">
          {races?.map((r) => {
            const isMine = r.players.some((p) => p.userId === user?.id);
            const host = r.players.find((p) => p.userId === r.creatorId);
            const full = r.players.length >= r.maxPlayers;
            return (
              <CardRow key={r.id} to={`/puzzles/${r.code}`} highlight={isMine}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <AvatarStack players={r.players} />
                  <div className="min-w-0 text-sm text-base-content">
                    <div className="truncate font-medium">
                      {host?.username ?? "Someone"}'s race
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-base-content/50">
                      <span className="inline-flex items-center gap-1">
                        <Puzzle className="h-3 w-3" />
                        {r.puzzleCount} · {DIFFICULTY_LABEL[r.difficulty]}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Timer className="h-3 w-3" />
                        {Math.round(r.timeLimitSeconds / 60)} min
                      </span>
                      <span>
                        {r.players.length}/{r.maxPlayers} players
                      </span>
                      {r.wagerTokens > 0 ? (
                        <Badge variant="warning">
                          <span className="inline-flex items-center gap-1">
                            {r.wagerTokens} <RCoin size={10} /> each
                          </span>
                        </Badge>
                      ) : (
                        <Badge variant="neutral">Free</Badge>
                      )}
                      {full && !isMine && <Badge variant="neutral">Full</Badge>}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-base-content/30" />
              </CardRow>
            );
          })}
        </ListCard>
        )}

        {/* Only when there's nothing else on the page (no race of yours, no
         *  open races): the explainer then fills the empty space. */}
        {showDescription && (
        <Card variant="solid">
          <CardContent className="space-y-1.5 py-4 text-sm text-base-content/60">
            <p className="font-medium text-base-content">How a race works</p>
            <p>
              Everyone in the race gets the same puzzles, easiest first. Find the
              best move each time; a wrong move locks you out for 5 seconds.
            </p>
            <p>
              The first player to solve them all wins. If time runs out, whoever
              solved the most wins. With a wager, every racer stakes the same
              amount and the winner takes the pot
              {rakePercent ? ` (minus a ${rakePercent}% platform fee)` : ""};
              if nobody solves a puzzle, everyone is refunded.
            </p>
          </CardContent>
        </Card>
        )}
      </div>
    </Page>
  );
}
