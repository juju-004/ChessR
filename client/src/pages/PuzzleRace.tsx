import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, Copy, Crown, Puzzle, Timer, Users } from "lucide-react";
import {
  cancelRace,
  DIFFICULTY_LABEL,
  getRaceByCode,
  joinRace,
  leaveRace,
  startRace,
  type MoveResult,
  type PuzzleRace as Race,
  type PuzzleView,
  type RacePlayer,
} from "../api/puzzleRaces.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useTokenBalance } from "../hooks/useTokenBalance.js";
import { useRakePercent } from "../hooks/useRakePercent.js";
import { errMsg } from "../lib/errMsg.js";
import { cn } from "../lib/cn.js";
import { PuzzleBoard } from "../components/puzzles/PuzzleBoard.js";
import { PageError } from "../components/PageError.js";
import { winnerTakes } from "./PuzzleRaces.js";
import {
  Page,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Avatar,
  RCoin,
  ListRow,
  CenteredSpinner,
  ProgressBar,
} from "../components/ui/index.js";

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Re-renders on an interval while `active`, for countdowns. */
function useNow(active: boolean, ms = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

type Phase =
  | "waiting"
  | "countdown"
  | "running"
  | "timeup"
  | "finished"
  | "cancelled";

export function PuzzleRacePage() {
  const { code = "" } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const socket = useSocket();
  const { refresh } = useTokenBalance();
  const rakePercent = useRakePercent();

  const [race, setRace] = useState<Race | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [puzzle, setPuzzle] = useState<PuzzleView | null>(null);
  const [lockUntil, setLockUntil] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState<"join" | "start" | "leave" | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  // server clock minus ours; every state message refreshes it
  const offsetRef = useRef(0);

  const applyState = useCallback((state: Race) => {
    offsetRef.current = state.serverNow - Date.now();
    setRace((prev) =>
      prev &&
      prev.createdAt === state.createdAt &&
      prev.serverNow > state.serverNow
        ? prev
        : state,
    );
  }, []);

  // Initial load over REST so the page works before the socket is up.
  useEffect(() => {
    let cancelled = false;
    getRaceByCode(code)
      .then(({ race }) => {
        if (cancelled) return;
        // Codes are case-sensitive; move to the real one if the server
        // resolved a differently-cased legacy code.
        if (race.code !== code) {
          navigate(`/puzzles/${race.code}`, { replace: true });
          return;
        }
        applyState(race);
      })
      .catch(() => !cancelled && setNotFound(true));
    return () => {
      cancelled = true;
    };
  }, [code, applyState]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Asks the server for the race state and MY current puzzle. */
  const sync = useCallback(() => {
    if (!socket) return;
    socket.emit(
      "puzzleRace:watch",
      { code },
      (res: {
        ok: boolean;
        state?: Race;
        puzzle?: PuzzleView | null;
        lockMs?: number;
        error?: string;
      }) => {
        if (!res?.ok || !res.state) return;
        applyState(res.state);
        setPuzzle(res.puzzle ?? null);
        setLockUntil(Date.now() + (res.lockMs ?? 0));
      },
    );
  }, [socket, code, applyState]);

  useEffect(() => {
    if (!socket) return;
    const s = socket;
    const onState = (state: Race) => {
      if (state.code === code) applyState(state);
    };
    s.on("connect", sync);
    s.on("puzzleRace:state", onState);
    if (s.connected) sync();
    return () => {
      s.off("connect", sync);
      s.off("puzzleRace:state", onState);
      s.emit("puzzleRace:unwatch", { code });
    };
  }, [socket, code, sync, applyState]);

  const me: RacePlayer | undefined = race?.players.find(
    (p) => p.userId === user?.id,
  );
  const isPlayer = !!me;
  const isCreator = !!race && race.creatorId === user?.id;

  const tickActive = race?.status === "active";
  const now = useNow(!!tickActive);
  const serverNow = now + offsetRef.current;

  const phase: Phase = !race
    ? "waiting"
    : race.status === "waiting"
      ? "waiting"
      : race.status === "finished"
        ? "finished"
        : race.status === "cancelled"
          ? "cancelled"
          : race.startsAt && serverNow < race.startsAt
            ? "countdown"
            : race.endsAt && serverNow >= race.endsAt
              ? "timeup"
              : "running";

  // Entering the running phase as a player: make sure the puzzle is loaded.
  const status = race?.status;
  useEffect(() => {
    if (status === "active" && isPlayer) sync();
  }, [status, isPlayer, sync]);

  // Past the end time but not yet finalised: nudge the server until it is.
  useEffect(() => {
    if (phase !== "timeup") return;
    const id = setInterval(sync, 2000);
    return () => clearInterval(id);
  }, [phase, sync]);

  // Money moved: refresh the balance badge when the race is settled.
  useEffect(() => {
    if (status === "finished" || status === "cancelled")
      refresh().catch(() => {});
  }, [status, refresh]);

  const submitMove = useCallback(
    (move: {
      from: string;
      to: string;
      promotion?: "q" | "r" | "b" | "n";
      index: number;
      moveIdx: number;
    }) =>
      new Promise<MoveResult>((resolve) => {
        if (!socket) return resolve({ ok: false, status: "stale" });
        socket
          .timeout(6000)
          .emit(
            "puzzleRace:move",
            { code, ...move },
            (err: unknown, res: MoveResult) =>
              resolve(err || !res ? { ok: false, status: "stale" } : res),
          );
      }),
    [socket, code],
  );

  const onSolved = useCallback(
    (next: PuzzleView | null) => {
      setPuzzle(next);
      if (!next) sync();
    },
    [sync],
  );
  const onWrong = useCallback(
    (lockMs: number) => setLockUntil(Date.now() + lockMs),
    [],
  );
  const onResync = useCallback(() => {
    sync();
    setNonce((n) => n + 1);
  }, [sync]);

  async function run(
    kind: "join" | "start" | "leave",
    fn: () => Promise<unknown>,
    after?: () => void,
  ) {
    setError("");
    setBusy(kind);
    try {
      await fn();
      refresh().catch(() => {});
      after?.();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/puzzles/${code}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy the link");
    }
  }

  const ranked = useMemo(() => {
    if (!race) return [];
    return [...race.players].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (b.solved !== a.solved) return b.solved - a.solved;
      return (a.lastSolveMs ?? Infinity) - (b.lastSolveMs ?? Infinity);
    });
  }, [race]);

  if (notFound) {
    return (
      <Page title="Puzzle race" back="/puzzles">
        <PageError message="That race doesn't exist." />
      </Page>
    );
  }
  if (!race) {
    return (
      <Page title="Puzzle race" back="/puzzles">
        <CenteredSpinner className="py-16" />
      </Page>
    );
  }

  const lockLeft = Math.max(0, lockUntil - now);
  const locked = lockLeft > 0;
  const full = race.players.length >= race.maxPlayers;
  const takes = winnerTakes(
    race.wagerTokens * race.players.length,
    rakePercent,
  );
  const timeLeft = race.endsAt
    ? race.endsAt - serverNow
    : race.timeLimitSeconds * 1000;

  const statusBadge =
    phase === "waiting" ? (
      <Badge variant="warning">
        Waiting <span className="hidden sm:inline-flex">for players</span>
      </Badge>
    ) : phase === "countdown" ? (
      <Badge variant="primary">Starting…</Badge>
    ) : phase === "running" || phase === "timeup" ? (
      <Badge variant="success">Live</Badge>
    ) : phase === "finished" ? (
      <Badge variant="neutral">Finished</Badge>
    ) : (
      <Badge variant="error">Cancelled</Badge>
    );

  return (
    <Page
      title="Puzzle race"
      description={`Race ${race.code}`}
      back="/puzzles"
      actions={statusBadge}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,min(44rem,calc(100dvh-13rem)))_minmax(0,1fr)]">
        {/* ---- the play area ------------------------------------------------ */}
        {phase === "running" && isPlayer && puzzle && !me?.finished ? (
          // On phones the board bleeds out of the page's side gutter
          // (-mx-4 cancels Page's px-4), same end result as the game page,
          // which simply isn't wrapped in <Page>. From sm up the normal
          // gutter and centred width apply again.
          <div className="-mx-4 space-y-2 sm:mx-auto sm:w-full lg:max-w-[min(100%,calc(100dvh-13rem))]">
            <div className="flex items-center justify-between px-4 text-sm sm:px-0">
              <span className="font-medium text-base-content">
                Puzzle {puzzle.index + 1} of {puzzle.total}
              </span>
              <span className="inline-flex items-center gap-1 font-mono text-base-content/70">
                <Timer className="h-4 w-4" />
                {formatClock(timeLeft)}
              </span>
            </div>
            <div className="relative">
              <PuzzleBoard
                key={`${puzzle.index}-${nonce}`}
                puzzle={puzzle}
                disabled={locked}
                onMove={submitMove}
                onWrong={onWrong}
                onSolved={onSolved}
                onResync={onResync}
              />
              {locked && (
                // z-30: chessground's pieces and overlays carry their own
                // z-index, without one the pill could slide behind them.
                <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center">
                  <span className="rounded-full bg-red-500/90 px-3 py-1 text-xs font-semibold text-white shadow">
                    Wrong move, locked {Math.ceil(lockLeft / 100) / 10}s
                  </span>
                </div>
              )}
            </div>
            <p className="px-4 text-center text-xs text-base-content/50 sm:px-0">
              Find the best move for{" "}
              <span className="font-medium text-base-content">
                {puzzle.orientation === "white" ? "White" : "Black"}
              </span>
            </p>
          </div>
        ) : (
          <Card variant="solid">
            <CardContent className="p-3 sm:p-4">
              <Stage
                phase={phase}
                race={race}
                me={me}
                isPlayer={isPlayer}
                serverNow={serverNow}
                timeLeft={timeLeft}
                loadingPuzzle={
                  phase === "running" && isPlayer && !me?.finished && !puzzle
                }
              />
            </CardContent>
          </Card>
        )}

        {/* ---- side column ------------------------------------------------- */}
        <div className="space-y-4">
          <Card variant="solid">
            <CardHeader>
              <CardTitle>Race</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <Stat icon={<Puzzle className="h-4 w-4" />} label="Puzzles">
                {race.puzzleCount} · {DIFFICULTY_LABEL[race.difficulty]}
              </Stat>
              <Stat icon={<Timer className="h-4 w-4" />} label="Time limit">
                {Math.round(race.timeLimitSeconds / 60)} min
              </Stat>
              <Stat icon={<Users className="h-4 w-4" />} label="Players">
                {race.players.length}/{race.maxPlayers}
              </Stat>
              <Stat
                icon={<RCoin size={14} />}
                label={race.wagerTokens > 0 ? "Pot" : "Wager"}
              >
                {race.wagerTokens > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    {race.wagerTokens * race.players.length} <RCoin size={12} />
                    <span className="text-xs text-base-content/50">
                      ({race.wagerTokens} each)
                    </span>
                  </span>
                ) : (
                  "Free"
                )}
              </Stat>
              {race.wagerTokens > 0 &&
                takes !== null &&
                phase !== "finished" &&
                phase !== "cancelled" && (
                  <p className="col-span-2 text-xs text-base-content/50">
                    Winner takes {takes} R
                    {rakePercent
                      ? ` (after the ${rakePercent}% platform fee)`
                      : ""}
                    .
                  </p>
                )}
            </CardContent>
          </Card>

          {phase === "waiting" && (
            <WaitingActions
              race={race}
              isPlayer={isPlayer}
              isCreator={isCreator}
              full={full}
              busy={busy}
              copied={copied}
              onCopy={copyLink}
              onJoin={() => run("join", () => joinRace(race.id), sync)}
              onStart={() => run("start", () => startRace(race.id))}
              onLeave={() =>
                run(
                  "leave",
                  () => (isCreator ? cancelRace(race.id) : leaveRace(race.id)),
                  () => navigate("/puzzles"),
                )
              }
            />
          )}

          {(phase === "finished" || phase === "cancelled") && (
            <Results race={race} me={me} userId={user?.id} />
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Card variant="solid">
            <CardHeader>
              <CardTitle>
                {phase === "waiting" ? "Players" : "Standings"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div>
                {ranked.map((p) => (
                  <ListRow
                    key={p.userId}
                    to={`/profile/${p.username}`}
                    leading={
                      <Avatar
                        username={p.username}
                        size="sm"
                        gradient={p.avatarGradient}
                      />
                    }
                    title={
                      <>
                        <span className="min-w-0 truncate">
                          {p.username}
                          {p.userId === user?.id && (
                            <span className="text-base-content/40"> (you)</span>
                          )}
                        </span>
                        {race.winnerId === p.userId && (
                          <Crown className="h-4 w-4 shrink-0 text-amber-400" />
                        )}
                        {p.userId === race.creatorId && phase === "waiting" && (
                          <Badge variant="primary">Host</Badge>
                        )}
                      </>
                    }
                    subtitle={
                      phase === "waiting" ? undefined : (
                        <ProgressBar
                          value={p.solved}
                          total={race.puzzleCount}
                          highlight={p.userId === user?.id}
                        />
                      )
                    }
                    trailing={
                      phase === "waiting" ? undefined : (
                        <span className="text-xs tabular-nums text-base-content/60">
                          {p.solved}/{race.puzzleCount}
                          {p.mistakes > 0 && (
                            <span className="ml-1.5 text-red-400/80">
                              ✗{p.mistakes}
                            </span>
                          )}
                        </span>
                      )
                    }
                  />
                ))}
                {phase === "waiting" &&
                  Array.from({
                    length: race.maxPlayers - race.players.length,
                  }).map((_, i) => (
                    <div
                      key={`empty-${i}`}
                      className="-mx-2 flex items-center gap-2.5 border-b border-base-300 px-2 py-2.5 text-sm text-base-content/30 last:border-none"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-base-content/20">
                        <Users className="h-3.5 w-3.5" />
                      </span>
                      Open seat
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Page>
  );
}

// -----------------------------------------------------------------------------

function Stat({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1.5 text-xs text-base-content/50">
        {icon}
        {label}
      </div>
      <div className="font-medium text-base-content">{children}</div>
    </div>
  );
}

/** The play area when there is no board to show: lobby, countdown, between
 *  states, spectating, and the end. */
function Stage({
  phase,
  race,
  me,
  isPlayer,
  serverNow,
  timeLeft,
  loadingPuzzle,
}: {
  phase: Phase;
  race: Race;
  me?: RacePlayer;
  isPlayer: boolean;
  serverNow: number;
  timeLeft: number;
  loadingPuzzle: boolean;
}) {
  let body: React.ReactNode;

  if (phase === "waiting") {
    body = (
      <>
        <Puzzle className="h-10 w-10 text-(--primary)" />
        <p className="text-lg font-semibold text-base-content">
          Waiting for the race to start
        </p>
        <p className="max-w-xs text-sm text-base-content/60">
          {race.players.length < 2
            ? "At least one more racer is needed. Share the link to invite someone."
            : "The race starts when the host starts it, or as soon as every seat is filled."}
        </p>
      </>
    );
  } else if (phase === "countdown") {
    const secs = Math.max(
      1,
      Math.ceil(((race.startsAt ?? serverNow) - serverNow) / 1000),
    );
    body = (
      <>
        <p className="text-sm font-medium uppercase tracking-wide text-base-content/50">
          Get ready
        </p>
        <p className="text-8xl font-bold tabular-nums text-(--primary)">
          {secs}
        </p>
        <p className="text-sm text-base-content/60">
          {race.puzzleCount} puzzles, first to solve them all wins
        </p>
      </>
    );
  } else if (phase === "running" || phase === "timeup") {
    if (!isPlayer) {
      body = (
        <>
          <p className="text-lg font-semibold text-base-content">
            You're watching this race
          </p>
          <p className="font-mono text-2xl text-base-content/70">
            {formatClock(timeLeft)}
          </p>
        </>
      );
    } else if (me?.finished) {
      body = (
        <>
          <Check className="h-10 w-10 text-green-400" />
          <p className="text-lg font-semibold text-base-content">
            You solved them all!
          </p>
          <p className="text-sm text-base-content/60">
            Waiting for the result…
          </p>
        </>
      );
    } else if (phase === "timeup") {
      body = (
        <>
          <Timer className="h-10 w-10 text-amber-400" />
          <p className="text-lg font-semibold text-base-content">Time's up!</p>
          <p className="text-sm text-base-content/60">
            Working out the result…
          </p>
        </>
      );
    } else if (loadingPuzzle) {
      body = <CenteredSpinner />;
    } else {
      body = <CenteredSpinner />;
    }
  } else if (phase === "finished") {
    body = (
      <>
        <Crown className="h-10 w-10 text-amber-400" />
        <p className="text-lg font-semibold text-base-content">Race over</p>
        <p className="text-sm text-base-content/60">
          {race.endReason === "completed"
            ? "Someone solved every puzzle first."
            : "Time ran out."}
        </p>
      </>
    );
  } else {
    body = (
      <>
        <p className="text-lg font-semibold text-base-content">
          This race was cancelled
        </p>
        <p className="text-sm text-base-content/60">
          Any stakes were returned.
        </p>
      </>
    );
  }

  return (
    <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border border-base-300 bg-base-100/40 p-6 text-center">
      {body}
    </div>
  );
}

function WaitingActions({
  race,
  isPlayer,
  isCreator,
  full,
  busy,
  copied,
  onCopy,
  onJoin,
  onStart,
  onLeave,
}: {
  race: Race;
  isPlayer: boolean;
  isCreator: boolean;
  full: boolean;
  busy: "join" | "start" | "leave" | null;
  copied: boolean;
  onCopy: () => void;
  onJoin: () => void;
  onStart: () => void;
  onLeave: () => void;
}) {
  return (
    <Card variant="solid">
      <CardContent className="space-y-2 py-4">
        {!isPlayer && (
          <Button
            className="w-full"
            onClick={onJoin}
            loading={busy === "join"}
            disabled={full}
          >
            {full
              ? "Race is full"
              : race.wagerTokens > 0
                ? `Join for ${race.wagerTokens} R`
                : "Join race"}
          </Button>
        )}
        {isCreator && (
          <Button
            className="w-full"
            onClick={onStart}
            loading={busy === "start"}
            disabled={race.players.length < 2}
          >
            {race.players.length < 2
              ? "Waiting for a second player"
              : "Start race now"}
          </Button>
        )}
        <Button variant="glass" className="w-full" onClick={onCopy}>
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {copied ? "Link copied" : "Copy invite link"}
        </Button>
        {isPlayer && (
          <Button
            variant="ghost"
            className="w-full"
            onClick={onLeave}
            loading={busy === "leave"}
          >
            {isCreator ? "Cancel race" : "Leave race"}
          </Button>
        )}
        {isPlayer && race.wagerTokens > 0 && (
          <p className="text-center text-xs text-base-content/50">
            Your {race.wagerTokens} R is held and refunded if you leave or the
            race is cancelled.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Results({
  race,
  me,
  userId,
}: {
  race: Race;
  me?: RacePlayer;
  userId?: string;
}) {
  const iWon = !!userId && race.winnerId === userId;
  const winner = race.players.find((p) => p.userId === race.winnerId);
  const wagered = race.wagerTokens > 0;

  let headline: string;
  let tone: string;
  let detail: string | null = null;

  if (race.status === "cancelled") {
    headline = "Race cancelled";
    tone = "text-base-content";
    detail = wagered ? "Every stake was refunded." : null;
  } else if (!race.winnerId) {
    headline = "Nobody solved a puzzle";
    tone = "text-base-content";
    detail = wagered ? "Every stake was refunded." : null;
  } else if (iWon) {
    headline = "You won!";
    tone = "text-green-400";
    detail = wagered
      ? `+${race.payoutTokens} R paid out from a ${race.potTokens} R pot.`
      : null;
  } else if (me) {
    headline = `${winner?.username ?? "Someone"} won`;
    tone = "text-base-content";
    detail = wagered
      ? `You lost your ${race.wagerTokens} R stake.`
      : "Better luck next time.";
  } else {
    headline = `${winner?.username ?? "Someone"} won`;
    tone = "text-base-content";
    detail = wagered ? `They took ${race.payoutTokens} R.` : null;
  }

  return (
    <Card variant="solid">
      <CardContent className="space-y-3 py-4 text-center">
        <p className={cn("text-xl font-bold", tone)}>{headline}</p>
        {detail && <p className="text-sm text-base-content/60">{detail}</p>}
        <div className="flex gap-2">
          <Link to="/puzzles" className="flex-1">
            <Button className="w-full">Back to races</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
