import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Clock,
  Share2,
  MessageSquare,
  Lock,
  Pencil,
  ChevronDown,
  Pause,
  Play,
  Medal,
  LocateFixed,
} from "lucide-react";
import {
  getTournamentByCode,
  rankTournamentPlayers,
  usernameOf,
  gradientOf,
  timeControlSpeed,
  ordinalSuffix,
  tokensLabel,
  FORMAT_LABEL,
  FORMAT_MAX_PLAYERS,
  type Tournament,
  type TournamentPairing,
  type TournamentPlayer,
  type TournamentFormat,
  type TournamentPrizeTier,
} from "../api/tournaments.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useNotify } from "../contexts/NotificationContext.js";
import { useConfirm } from "../contexts/ConfirmContext.js";
import { copyToClipboard } from "@/lib/utils.js";
import { cn } from "@/lib/cn.js";
import { ChatDrawer } from "../components/chat/ChatDrawer.js";
import type { ChatMessage } from "../lib/chatTypes.js";
import { PrizePoolEditor } from "../components/tournaments/PrizePoolEditor.js";
import {
  KnockoutBracket,
  roundLabel,
} from "../components/tournaments/KnockoutBracket.js";
import { Pagination } from "../components/Pagination.js";
import { HelpTip } from "../components/HelpTip.js";
import { TIME_CONTROLS as TIME_PRESETS } from "../timeControls.js";
import {
  MAX_WAGER_TOKENS,
  MIN_STAKE_TOKENS,
  MAX_EVENT_NAME_LENGTH,
} from "../lib/limits.js";
import { FORMAT_DESCRIPTION, robinRoundsLabel } from "../api/tournaments.js";

const SPEED_EMOJI: Record<string, string> = {
  "Hyper Bullet": "💥",
  Bullet: "⚡",
  Blitz: "🔥",
  Rapid: "⏳",
  Classical: "♟️",
};
import {
  Page,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  Spinner,
  Input,
  Select,
  Switch,
  Avatar,
  Tabs,
  ResponsiveOverlay,
  RCoin,
} from "../components/ui/index.js";

const CLIENT_URL = import.meta.env.VITE_CLIENT_URL ?? "http://localhost:5173";

// datetime-local wants local time with no seconds/timezone.
function toDatetimeLocal(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 5 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EditTournamentForm({
  tournament,
  onSaved,
  onCancel,
}: {
  tournament: Tournament;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const socket = useSocket();
  const [name, setName] = useState(tournament.name);
  const [format, setFormat] = useState<TournamentFormat>(tournament.format);
  const [variant, setVariant] = useState<"standard" | "chess960">(
    tournament.variant,
  );
  const [presetIdx, setPresetIdx] = useState(() => {
    const exact = TIME_PRESETS.findIndex(
      (p) =>
        p.baseMinutes === tournament.baseMinutes &&
        p.incrementSeconds === tournament.incrementSeconds,
    );
    if (exact !== -1) return exact;
    if (tournament.baseMinutes === null) return TIME_PRESETS.length - 1;
    // No exact preset match (a value from before presets existed, or one
    // that's since been edited off the list), fall back to the preset
    // with the closest base time so the select still lands somewhere
    // sane instead of defaulting to index 0.
    let closest = 0;
    let closestDiff = Infinity;
    TIME_PRESETS.forEach((p, i) => {
      if (p.baseMinutes === null) return;
      const diff = Math.abs(p.baseMinutes - (tournament.baseMinutes ?? 0));
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = i;
      }
    });
    return closest;
  });
  const [maxPlayers, setMaxPlayers] = useState(tournament.maxPlayers);
  const [swissRounds, setSwissRounds] = useState(tournament.swissRounds ?? 5);
  const [robinRounds, setRobinRounds] = useState(tournament.robinRounds ?? 1);
  const [arenaMinutes, setArenaMinutes] = useState(
    tournament.arenaMinutes ?? 60,
  );
  const [breakSeconds, setBreakSeconds] = useState(tournament.breakSeconds);
  const [berserkAllowed, setBerserkAllowed] = useState(
    tournament.berserkAllowed,
  );
  const [chatEnabled, setChatEnabled] = useState(tournament.chatEnabled);
  const [isPublic, setIsPublic] = useState(tournament.isPublic);
  const [regFeeInput, setRegFeeInput] = useState(
    String(tournament.regFeeTokens),
  );
  const [prizeTiers, setPrizeTiers] = useState<TournamentPrizeTier[]>(
    tournament.prizeSchedule,
  );
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const [startInput, setStartInput] = useState(() =>
    toDatetimeLocal(tournament.scheduledStartAt),
  );
  const [error, setError] = useState("");

  function handleFormatChange(f: TournamentFormat) {
    setFormat(f);
    if (f === "swiss" || f === "arena") setMaxPlayers(FORMAT_MAX_PLAYERS[f]);
  }

  function save() {
    if (!socket) return;
    if (name.trim().length < 3)
      return setError("Give it a name (3+ characters).");
    const regFeeTokens = Math.max(0, Math.floor(Number(regFeeInput) || 0));
    if (regFeeTokens < MIN_STAKE_TOKENS) {
      return setError(
        `Set a registration fee of at least ${MIN_STAKE_TOKENS} R.`,
      );
    }
    const scheduledStartAt = new Date(startInput);
    if (
      Number.isNaN(scheduledStartAt.getTime()) ||
      scheduledStartAt.getTime() < Date.now() + 5000
    ) {
      return setError("Pick a start time a bit further in the future.");
    }
    for (const tier of prizeTiers) {
      if (tier.toRank > maxPlayers) {
        return setError(
          `Prize schedule can't cover a rank beyond your ${maxPlayers}-player cap.`,
        );
      }
    }
    const preset = TIME_PRESETS[presetIdx];
    socket.emit("tournament:edit", {
      tournamentId: tournament._id,
      name: name.trim(),
      format,
      variant,
      baseMinutes: preset.baseMinutes,
      incrementSeconds: preset.incrementSeconds,
      maxPlayers,
      berserkAllowed: format === "normal" ? false : berserkAllowed,
      chatEnabled,
      isPublic,
      prizeSchedule: prizeTiers,
      regFeeTokens,
      swissRounds: format === "swiss" ? swissRounds : null,
      robinRounds: format === "round_robin" ? robinRounds : null,
      arenaMinutes: format === "arena" ? arenaMinutes : null,
      breakSeconds: format === "arena" ? 0 : breakSeconds,
      scheduledStartAt: scheduledStartAt.toISOString(),
      password: removePassword ? null : password.trim() || undefined,
    });
    onSaved();
  }

  return (
    <Card variant="solid" className="border-(--secondary)/30">
      <CardContent className="space-y-5">
        {/* Basics */}
        <section className="space-y-3">
          <CardHeader className="p-0">
            <CardTitle>Edit tournament</CardTitle>
          </CardHeader>

          <Input
            label="Tournament name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_EVENT_NAME_LENGTH}
          />

          <div>
            <label className="mb-1.5 block text-sm font-medium text-base-content/80">
              Format
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(FORMAT_LABEL) as TournamentFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => handleFormatChange(f)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                    format === f
                      ? "border-(--secondary)/50 bg-(--secondary)/10 text-base-content"
                      : "border-base-300 bg-base-100/60 text-base-content/70 hover:border-(--secondary)/30"
                  }`}
                >
                  <div className="font-medium">{FORMAT_LABEL[f]}</div>
                  <div className="text-xs text-base-content/50">
                    {FORMAT_DESCRIPTION[f]}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Time control"
              value={presetIdx}
              onChange={(e) => setPresetIdx(Number(e.target.value))}
            >
              {TIME_PRESETS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
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
              <option value="chess960">Chess960</option>
            </Select>
          </div>
        </section>

        {/* Players & schedule */}
        <section className="space-y-3 border-t border-base-300 pt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {format !== "swiss" && format !== "arena" && (
              <Input
                label="Max players"
                type="number"
                min={2}
                max={FORMAT_MAX_PLAYERS[format]}
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
              />
            )}
            {format === "swiss" && (
              <Input
                label="Rounds"
                type="number"
                min={3}
                max={15}
                value={swissRounds}
                onChange={(e) => setSwissRounds(Number(e.target.value))}
              />
            )}
            {format === "round_robin" && (
              <Input
                label={
                  <span className="inline-flex items-center gap-1">
                    Laps <HelpTip>{robinRoundsLabel(robinRounds)}</HelpTip>
                  </span>
                }
                type="number"
                min={1}
                max={4}
                value={robinRounds}
                onChange={(e) => setRobinRounds(Number(e.target.value))}
              />
            )}
            {format === "arena" && (
              <Input
                label="Duration (min)"
                type="number"
                min={5}
                max={360}
                value={arenaMinutes}
                onChange={(e) => setArenaMinutes(Number(e.target.value))}
              />
            )}
            {format !== "arena" && (
              <Input
                label="Break (sec)"
                type="number"
                min={0}
                max={300}
                value={breakSeconds}
                onChange={(e) => setBreakSeconds(Number(e.target.value))}
              />
            )}
          </div>

          <Input
            label="Start date and time"
            type="datetime-local"
            value={startInput}
            onChange={(e) => setStartInput(e.target.value)}
          />
        </section>

        {/* Money */}
        <section className="space-y-3 border-t border-base-300 pt-4">
          <Input
            label={
              <span className="inline-flex items-center gap-1">
                Registration fee (<RCoin size={12} /> Coins)
              </span>
            }
            type="number"
            min={MIN_STAKE_TOKENS}
            max={MAX_WAGER_TOKENS}
            value={regFeeInput}
            onChange={(e) => setRegFeeInput(e.target.value)}
          />
          <p className="text-xs text-base-content/50">
            Since you're still the only player, changing this just adjusts what
            you've already paid in.
          </p>

          <div className="space-y-2">
            <p className="text-xs text-base-content/50">
              Increasing the total debits the difference from you now.
              Decreasing it refunds the difference.
            </p>
            <PrizePoolEditor
              value={prizeTiers}
              onChange={setPrizeTiers}
              maxPlayers={maxPlayers}
            />
          </div>

          {tournament.hasPassword && !removePassword ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-base-content/50">
                A password is currently set.
              </p>
              <Button
                size="sm"
                variant="glass"
                onClick={() => setRemovePassword(true)}
              >
                Remove password
              </Button>
            </div>
          ) : (
            <Input
              label={
                tournament.hasPassword ? "New password" : "Password (optional)"
              }
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setRemovePassword(false);
              }}
              placeholder="Leave blank for no password"
            />
          )}
        </section>

        <section className="space-y-3 border-t border-base-300 pt-4">
          <Switch
            checked={isPublic}
            onChange={setIsPublic}
            label="List publicly"
            description="Visible in the Open tournaments list for anyone to find."
          />
          {format !== "normal" && (
            <Switch
              checked={berserkAllowed}
              onChange={setBerserkAllowed}
              label="Allow berserk"
              description="Half clock, no increment, +0.5 point on a win."
            />
          )}
          <Switch
            checked={chatEnabled}
            onChange={setChatEnabled}
            label="Enable tournament chat"
            description="A chat visible to players and spectators on the tournament page."
          />
        </section>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2 pt-2">
          <Button variant="secondary" fullWidth onClick={save}>
            Save changes
          </Button>
          <Button variant="glass" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Live "next round starts in Ns" countdown, shown while the tournament is
 *  sitting in its inter-round break (see scheduleRoundStart in
 *  tournament.service.ts, nextRoundStartsAt is only ever set during that
 *  window). Ticks locally rather than waiting on the server; the round
 *  activating for real sends its own tournament:update/tournament:pairing_ready
 *  events, so this never needs to do anything beyond just counting down. */
function BreakCountdown({ nextRoundStartsAt }: { nextRoundStartsAt: string }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => forceTick((n) => n + 1), 500);
    return () => window.clearInterval(interval);
  }, []);

  const remainingMs = new Date(nextRoundStartsAt).getTime() - Date.now();

  return (
    <Card
      variant="solid"
      className="border-(--secondary)/30 bg-(--secondary)/10"
    >
      <p className="flex items-center justify-center gap-1.5 text-center text-sm font-medium text-base-content">
        <Clock className="h-4 w-4 text-(--secondary)" />
        {remainingMs > 0
          ? `Next round starts in ${Math.ceil(remainingMs / 1000)}s`
          : "Starting the next round…"}
      </p>
    </Card>
  );
}

/** Formats a millisecond duration as HH:MM:SS (always all three segments,
 *  even for a countdown under an hour, easier to scan at a glance than a
 *  segment count that changes shape as it ticks down). Clamps negative
 *  input to zero rather than showing a negative countdown. */
function formatHms(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Live HH:MM:SS countdown to a tournament's scheduled auto-start, shown
 *  while it's still pending. Purely a display timer, the actual starting
 *  happens server-side (see scheduleAutoStart in tournament.service.ts);
 *  this just counts down to the same timestamp the server is watching. */
function StartCountdown({ scheduledStartAt }: { scheduledStartAt: string }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const remainingMs = new Date(scheduledStartAt).getTime() - Date.now();

  return (
    <p className="flex items-center gap-1.5 text-xs text-base-content/50">
      <Clock className="h-3.5 w-3.5" />
      {remainingMs > 0 ? (
        <>
          Starts in{" "}
          <span className="font-mono text-base-content">
            {formatHms(remainingMs)}
          </span>{" "}
          ({new Date(scheduledStartAt).toLocaleString()})
        </>
      ) : (
        "Starting…"
      )}
    </p>
  );
}

/** Live "arena ends in HH:MM:SS" countdown, shown while an arena
 *  tournament is active, purely a display timer counting down to the same
 *  arenaEndsAt timestamp the server checks in advanceAfterRound before
 *  deciding whether to generate another round or finish the event. */
function ArenaCountdown({ arenaEndsAt }: { arenaEndsAt: string }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const remainingMs = new Date(arenaEndsAt).getTime() - Date.now();

  return (
    <Card
      variant="solid"
      className="border-(--secondary)/30 bg-(--secondary)/10"
    >
      <p className="flex items-center justify-center gap-1.5 text-center text-sm font-medium text-base-content">
        <Clock className="h-4 w-4 text-(--secondary)" />
        {remainingMs > 0 ? (
          <>
            Arena ends in{" "}
            <span className="font-mono text-base-content">
              {formatHms(remainingMs)}
            </span>
          </>
        ) : (
          "Finishing up…"
        )}
      </p>
    </Card>
  );
}

/** Arena and swiss both keep accepting new players after they've started
 *  (see acceptingJoins in tournament.service.ts), arena because its
 *  pairing queue is continuous, swiss because a fresh round is built from
 *  the current player list each time a round transition happens. Knockout
 *  and round-robin don't: their whole schedule is fixed the moment the
 *  event starts, so there's nothing to slot a newcomer into.
 *
 *  This mirrors that same window purely for what to show, the server is
 *  the actual authority and will reject a join that's arrived too late
 *  regardless of what this renders. */
function LateJoinRow({
  tournament,
  joinPassword,
  setJoinPassword,
  join,
}: {
  tournament: Tournament;
  joinPassword: string;
  setJoinPassword: (v: string) => void;
  join: () => void;
}) {
  if (tournament.format !== "arena" && tournament.format !== "swiss")
    return null;

  const stillOpen =
    tournament.format === "arena"
      ? !!tournament.arenaEndsAt &&
        Date.now() < new Date(tournament.arenaEndsAt).getTime()
      : tournament.currentRoundIndex < (tournament.swissRounds ?? 1) - 1;

  if (!stillOpen) return null;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <p className="w-full text-xs text-base-content/50">
        This tournament is already under way, but you can still jump in.
      </p>
      {tournament.hasPassword && (
        <div className="w-40">
          <Input
            type="password"
            placeholder="Password"
            value={joinPassword}
            onChange={(e) => setJoinPassword(e.target.value)}
          />
        </div>
      )}
      <Button variant="secondary" size="sm" onClick={join}>
        Join
      </Button>
    </div>
  );
}

/** Every pairing a given player was part of, across every round, in the
 *  order the rounds were played, the raw material for their round-by-round
 *  line in PlayerTournamentDetails. */
function pairingsForPlayer(
  tournament: Tournament,
  userId: string,
): { roundIndex: number; pairing: TournamentPairing; isP1: boolean }[] {
  const records: {
    roundIndex: number;
    pairing: TournamentPairing;
    isP1: boolean;
  }[] = [];
  for (const round of tournament.rounds) {
    for (const pairing of round.pairings) {
      if (pairing.player1 === userId)
        records.push({ roundIndex: round.index, pairing, isP1: true });
      else if (pairing.player2 === userId)
        records.push({ roundIndex: round.index, pairing, isP1: false });
    }
  }
  return records;
}

/** Client-side mirror of the server's arenaAvailablePlayers pairing pool
 *  (see tournament.service.ts), minus the "actually watching the page"
 *  presence check, that part's a server-only concept, everyone looking at
 *  this page already satisfies it just by being here. Used for the
 *  "Pairing pool" section below instead of a per-round tab list, which
 *  didn't make much sense for arena: each "round" there is really just one
 *  ad hoc 1-on-1 match rather than a shared round everyone plays at once,
 *  so a giant scrolling tab list of them was mostly noise. Showing who's
 *  actually free to be paired right now is the more useful view of "what's
 *  happening" for this format. */
function arenaPairingPool(tournament: Tournament): TournamentPlayer[] {
  const busy = new Set<string>();
  for (const round of tournament.rounds) {
    for (const pairing of round.pairings) {
      if (pairing.status !== "active") continue;
      busy.add(pairing.player1);
      if (pairing.player2) busy.add(pairing.player2);
    }
  }
  return tournament.players
    .filter((p) => !p.paused && !busy.has(p.user))
    .sort((a, b) => b.points - a.points || b.tiebreak - a.tiebreak);
}

const RANK_MEDAL_CLASSES: Record<number, string> = {
  1: "bg-amber-400/15 text-amber-500",
  2: "bg-slate-300/25 text-slate-400",
  3: "bg-orange-400/15 text-orange-500",
};

/** Standings row-number cell, a plain rank for 4th and below, a small
 *  colored medal icon for the top 3 so the podium reads at a glance
 *  without needing to actually count down the column. */
function RankBadge({ rank }: { rank: number }) {
  const medalClass = RANK_MEDAL_CLASSES[rank];
  if (!medalClass) {
    return (
      <span className="flex h-6 w-6 items-center justify-center text-sm font-medium text-base-content/50">
        {rank}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full",
        medalClass,
      )}
      title={`${rank}${ordinalSuffix(rank)} place`}
    >
      <Medal className="h-3.5 w-3.5" />
    </span>
  );
}

/** The full "player tournament details" content, shared verbatim between
 *  the desktop popover and the mobile bottom sheet (see the standings
 *  table below, via ResponsiveOverlay) so the two surfaces can never drift
 *  out of sync with each other. */
function PlayerTournamentDetails({
  tournament,
  player,
}: {
  tournament: Tournament;
  player: TournamentPlayer;
}) {
  const isPointsFormat = tournament.format !== "normal";
  const records = pairingsForPlayer(tournament, player.user);
  const stats = [
    { label: "Games", value: player.gamesPlayed },
    { label: "Berserk wins", value: player.berserkWins },
    isPointsFormat && { label: "Points", value: player.points },
  ].filter(Boolean) as { label: string; value: number }[];

  return (
    <div className="w-full flex flex-col items-center max-w-full space-y-2">
      <div className="w-full rounded-xl bg-base-200/70 px-2 py-2.5">
        <div className="flex items-center gap-3 pb-3 pt-1">
          <Avatar
            username={player.username}
            gradient={player.avatarGradient}
            size="md"
          />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-base-content">
              {player.username}
            </p>
            {player.user === tournament.createdBy && (
              <p className="text-xs font-medium text-amber-400">★ Organizer</p>
            )}
          </div>
        </div>

        <div
          className={`grid md:border-none border-t-2 border-base-300/35 gap-2 ${stats.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}
        >
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl  md:bg-base-200/70 px-2 py-2.5 text-center"
            >
              <p
                className={cn(
                  " text-base md:text-lg font-bold",
                  s.label === "Points" ? "text-secondary" : "text-base-content",
                )}
              >
                {s.value}
              </p>
              <p className="text-[11px] text-base-content/50">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {records.length > 0 && (
        <div className="space-y-1 w-full">
          <div className="md:max-h-64 max-h-80 space-y-0.5 overflow-y-auto">
            {records.map(({ roundIndex, pairing, isP1 }, recordIndex) => {
              const opponentId = isP1 ? pairing.player2 : pairing.player1;
              const oppName = usernameOf(tournament, opponentId);
              const berserked = isP1 ? pairing.berserk.p1 : pairing.berserk.p2;
              // Not set until the game is actually created (activateRound),
              // a pairing that's been built but is still waiting out its
              // inter-round break has neither yet, so there's nothing to
              // show; the color icon just doesn't render for that row.
              const myColor: "white" | "black" | null =
                pairing.whiteId === player.user
                  ? "white"
                  : pairing.blackId === player.user
                    ? "black"
                    : null;

              let resultText = "·";
              let resultColor = "text-base-content/40";
              let inProgress = false;
              if (pairing.status === "finished") {
                if (opponentId === null) {
                  resultText = "-";
                } else if (pairing.result === "draw") {
                  resultText = "Draw";
                  resultColor = "text-base-content/70";
                } else {
                  const won =
                    (isP1 && pairing.result === "p1") ||
                    (!isP1 && pairing.result === "p2");
                  resultText = won ? "Won" : "Lost";
                  resultColor = won ? "text-green-400" : "text-red-400";
                }
              } else if (pairing.status === "active") {
                resultText = "Playing";
                resultColor = "text-amber-400";
                inProgress = true;
              }

              const rowContent = (
                <>
                  <span className="flex min-w-0 items-center gap-1.5 text-base-content/70">
                    <span className="shrink-0 text-xs text-base-content/40">
                      {tournament.format === "arena"
                        ? `#${recordIndex + 1}`
                        : `R${roundIndex + 1}`}
                    </span>
                    {myColor && (
                      <span
                        title={`You played ${myColor}`}
                        aria-label={`Playing as ${myColor}`}
                        className={`shrink-0 rounded-full w-2 h-2 text-xs border leading-none ${
                          myColor === "white"
                            ? "bg-white border-black"
                            : "bg-black"
                        }`}
                      >
                        {/* {myColor === "white" ? "♔" : "♚"} */}
                      </span>
                    )}
                    {opponentId !== null && (
                      <Avatar
                        username={oppName}
                        gradient={gradientOf(tournament, opponentId)}
                        size="sm"
                      />
                    )}
                    <span className="truncate">
                      {opponentId === null ? "-" : oppName}
                      {berserked && " ⚔"}
                    </span>
                  </span>
                  <span
                    className={`flex shrink-0 items-center gap-1.5 font-medium ${resultColor}`}
                  >
                    {inProgress && (
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400"
                      />
                    )}
                    {resultText}
                  </span>
                </>
              );

              return pairing.joinCode ? (
                <Link
                  key={roundIndex}
                  to={`/game/${pairing.joinCode}`}
                  className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 text-sm transition-colors hover:bg-base-300/40"
                >
                  {rowContent}
                </Link>
              ) : (
                <div
                  key={roundIndex}
                  className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 text-sm"
                >
                  {rowContent}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PairingRow({
  tournament,
  pairing,
  myId,
}: {
  tournament: Tournament;
  pairing: TournamentPairing;
  myId?: string;
}) {
  const p1Name = usernameOf(tournament, pairing.player1);
  const p2Name = usernameOf(tournament, pairing.player2);
  const involvesMe = pairing.player1 === myId || pairing.player2 === myId;

  let outcome = "·";
  if (pairing.status === "finished") {
    if (pairing.player2 === null) outcome = "Bye";
    else if (pairing.result === "draw") outcome = "Draw";
    else if (pairing.result === "p1") outcome = `${p1Name} won`;
    else outcome = `${p2Name} won`;
  } else if (pairing.status === "active") {
    outcome = "In progress";
  }

  // Any real (non-bye) pairing that's had a game created for it is
  // clickable through to that game, live to actually play/watch it,
  // finished to review the replay, same joinCode-based /game/:code route
  // Game.tsx already uses for both cases.
  const rowClassName = `flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition-colors ${
    involvesMe
      ? "border-(--secondary)/40 bg-(--secondary)/10"
      : "border-base-300 bg-base-100/60"
  } ${pairing.joinCode ? "hover:border-(--primary)/40" : ""}`;

  const content = (
    <>
      <span className="flex min-w-0 items-center gap-1.5 text-base-content">
        <Avatar
          username={p1Name}
          gradient={gradientOf(tournament, pairing.player1)}
          size="xs"
        />
        <span className="truncate">
          {p1Name}
          {pairing.berserk.p1 && " ⚔"}
        </span>
        {pairing.player2 && (
          <>
            <span className="text-base-content/40">vs</span>
            <Avatar
              username={p2Name}
              gradient={gradientOf(tournament, pairing.player2)}
              size="xs"
            />
            <span className="truncate">
              {p2Name}
              {pairing.berserk.p2 && " ⚔"}
            </span>
          </>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {pairing.status === "active" && pairing.joinCode ? (
          <Badge variant="warning" className="hover:brightness-110">
            {involvesMe ? "Play" : "Watch"}
          </Badge>
        ) : (
          <span className="text-base-content/50">{outcome}</span>
        )}
      </span>
    </>
  );

  if (pairing.joinCode) {
    return (
      <Link to={`/game/${pairing.joinCode}`} className={rowClassName}>
        {content}
      </Link>
    );
  }
  return <div className={rowClassName}>{content}</div>;
}

export function TournamentDetail() {
  const { code = "" } = useParams<{ code: string }>();
  const socket = useSocket();
  const { user } = useAuth();
  const { notify, dismiss } = useNotify();
  const confirmDialog = useConfirm();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);
  const [joinPassword, setJoinPassword] = useState("");
  const [editing, setEditing] = useState(false);
  const [manualRoundIndex, setManualRoundIndex] = useState<number | null>(null);
  // Collapsed by default, the tier breakdown is useful detail but not
  // something you need to see every time you land on the page, especially
  // once the header/card title already shows the total.
  const [prizePoolOpen, setPrizePoolOpen] = useState(false);
  const [standingsPage, setStandingsPage] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSheetOpen, setChatSheetOpen] = useState(false);
  const [chatHasUnread, setChatHasUnread] = useState(false);
  const chatSheetOpenRef = useRef(chatSheetOpen);
  useEffect(() => {
    chatSheetOpenRef.current = chatSheetOpen;
  }, [chatSheetOpen]);

  const refresh = useCallback(() => {
    getTournamentByCode(code)
      .then((res) => setTournament(res.tournament))
      .catch(() => setError("Tournament not found"));
  }, [code]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socket || !tournament) return;
    const tournamentId = tournament._id;
    socket.emit("tournament:watch", { tournamentId });
    function onUpdate(payload: { code: string }) {
      if (payload.code === code) refresh();
    }
    function onError(payload: { message: string }) {
      setStatus({ message: payload.message, isError: true });
    }
    function onChatHistory(payload: {
      tournamentId: string;
      history: ChatMessage[];
    }) {
      if (payload.tournamentId !== tournamentId) return;
      setChatMessages(payload.history);
    }
    function onChatMessage(payload: ChatMessage & { tournamentId: string }) {
      if (payload.tournamentId !== tournamentId) return;
      setChatMessages((prev) => [...prev.slice(-199), payload]);
      if (!chatSheetOpenRef.current && payload.username !== user?.username) {
        setChatHasUnread(true);
      }
    }
    socket.on("tournament:update", onUpdate);
    socket.on("tournament:started", onUpdate);
    socket.on("tournament:cancelled", onUpdate);
    socket.on("tournament:finished", onUpdate);
    socket.on("tournament:error", onError);
    socket.on("tournament:chat_history", onChatHistory);
    socket.on("tournament:chat_message", onChatMessage);
    return () => {
      socket.off("tournament:update", onUpdate);
      socket.off("tournament:started", onUpdate);
      socket.off("tournament:cancelled", onUpdate);
      socket.off("tournament:finished", onUpdate);
      socket.off("tournament:error", onError);
      socket.off("tournament:chat_history", onChatHistory);
      socket.off("tournament:chat_message", onChatMessage);
      // The other half of tournament:watch, without this, leaving the
      // page (without disconnecting entirely) left the server thinking
      // this player was still watching, which is exactly the "counted as
      // present even on a totally different page" bug arena/swiss
      // pairing eligibility now depends on not having.
      socket.emit("tournament:unwatch", { tournamentId });
    };
    // Re-subscribe once the tournament's Mongo _id is known.
  }, [socket, tournament?._id, code, refresh]);

  // Tab-visibility tracking on top of the mount/unmount watch above, a
  // background tab still has this page mounted, but nobody's actually
  // looking at it, so it shouldn't count as "watching" for arena/swiss
  // pairing purposes either. Only reacts to actual visibility *changes*
  // (not a duplicate watch on mount, since the effect above already
  // covers that and the page starts visible anyway).
  useEffect(() => {
    if (!socket || !tournament) return;
    const sock = socket;
    const tournamentId = tournament._id;
    function handleVisibilityChange() {
      sock.emit(document.hidden ? "tournament:unwatch" : "tournament:watch", {
        tournamentId,
      });
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [socket, tournament?._id]);

  if (error) {
    return (
      <div className="mx-auto mt-6 max-w-lg px-4">
        <Card
          variant="solid"
          className="border-red-900/50 bg-red-950/20 text-center text-red-300"
        >
          {error}
        </Card>
      </div>
    );
  }
  if (!tournament) {
    return (
      <div className="flex justify-center pt-16">
        <Spinner className="text-base-content/40" />
      </div>
    );
  }

  const myId = user?.id;
  const isPlayer = !!myId && tournament.players.some((p) => p.user === myId);
  const myPlayer = tournament.players.find((p) => p.user === myId);
  const isCreator = tournament.createdBy === myId;
  const isPointsFormat = tournament.format !== "normal";
  const standings = isPointsFormat ? rankTournamentPlayers(tournament) : [];
  const pairingPool =
    tournament.format === "arena" ? arenaPairingPool(tournament) : [];
  // 10 rows per page rather than the full field, arena/swiss standings can
  // run into the dozens of players, and rendering all of them as one table
  // was the thing making the page unwieldy to scan on a real field.
  const STANDINGS_PAGE_SIZE = 10;
  const standingsPageCount = Math.max(
    1,
    Math.ceil(standings.length / STANDINGS_PAGE_SIZE),
  );
  const safeStandingsPage = Math.min(standingsPage, standingsPageCount - 1);
  const myStandingsIndex = standings.findIndex((p) => p.user === myId);
  const pagedStandings = standings.slice(
    safeStandingsPage * STANDINGS_PAGE_SIZE,
    safeStandingsPage * STANDINGS_PAGE_SIZE + STANDINGS_PAGE_SIZE,
  );
  const currentRound = tournament.rounds[tournament.currentRoundIndex];
  // Defaults to whichever round is actually current, but once someone picks
  // a different tab it stays there across refreshes rather than yanking
  // them back to "current" every time the tournament state re-polls.
  const selectedRoundIndex = manualRoundIndex ?? tournament.currentRoundIndex;
  const selectedRound =
    tournament.rounds[selectedRoundIndex] ??
    tournament.rounds[tournament.rounds.length - 1];

  function join() {
    // Once you're a player, the server already knows it, the password is
    // only ever asked for here, at join time, never again on return visits.
    socket?.emit("tournament:join", {
      tournamentId: tournament!._id,
      password: joinPassword || undefined,
    });
  }
  function leave() {
    socket?.emit("tournament:leave", { tournamentId: tournament!._id });
  }
  async function cancel() {
    if (
      await confirmDialog({
        title: "Cancel this tournament?",
        description: "Everyone who's registered will be refunded in full.",
        variant: "danger",
        confirmLabel: "Cancel tournament",
      })
    ) {
      socket?.emit("tournament:cancel", { tournamentId: tournament!._id });
    }
  }
  function togglePause(paused: boolean) {
    socket?.emit("tournament:pause", { tournamentId: tournament!._id, paused });
  }
  function handleSendChat(message: string, replyToId?: string) {
    if (!socket || !tournament) return;
    socket.emit("tournament:chat_send", {
      tournamentId: tournament._id,
      message,
      ...(replyToId ? { replyToId } : {}),
    });
  }
  async function handleShare() {
    const url = `${CLIENT_URL}/tournaments/${tournament!.code}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join "${tournament!.name}" on Chessr`,
          url,
        });
        return;
      } catch (err) {
        // AbortError just means the person closed the share sheet without
        // picking anything, not a failure worth surfacing. Any other
        // failure (e.g. share unexpectedly rejected) falls back to a plain
        // clipboard copy so the action still does *something*.
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    copyToClipboard(url);
    const n = notify("Copied tournament link");
    setTimeout(() => dismiss(n), 2000);
  }

  // e.g. "3+0 Bullet Round-robin", "Unlimited Knockout", "10+5 Rapid
  // Chess960 Swiss", one flowing phrase instead of separate dot-joined
  // facts, for the catchy headline badge below.
  const speed = timeControlSpeed(tournament);
  const headline = [
    tournament.baseMinutes === null
      ? "Unlimited"
      : `${tournament.baseMinutes}+${tournament.incrementSeconds}`,
    speed,
    tournament.variant === "chess960" ? "Chess960" : null,
    FORMAT_LABEL[tournament.format],
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Page
      title={tournament.name}
      back="/tournaments"
      actions={
        <div className="flex items-center gap-2">
          {tournament.chatEnabled && (
            <Button
              variant="glass"
              size="sm"
              className="relative"
              onClick={() => {
                setChatSheetOpen(true);
                setChatHasUnread(false);
              }}
            >
              <MessageSquare className="h-3.5 w-3.5" />{" "}
              <span className="sm:flex hidden">Chat</span>
              {chatHasUnread && (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-base-200" />
              )}
            </Button>
          )}
          <Button variant="glass" size="sm" onClick={handleShare}>
            <Share2 className="h-3.5 w-3.5" />{" "}
            <span className="sm:flex hidden">Share</span>
          </Button>
        </div>
      }
    >
      <div className="mx-auto space-y-4">
        {status && (
          <p
            className={`text-sm ${status.isError ? "text-red-400" : "text-green-400"}`}
          >
            {status.message}
          </p>
        )}

        {editing ? (
          <EditTournamentForm
            tournament={tournament}
            onSaved={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Card variant="solid">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full gradient-brand px-3 py-1 text-sm font-bold text-white shadow-sm shadow-(--primary)/25">
                {speed && <span>{SPEED_EMOJI[speed]}</span>}
                {headline}
              </span>
            </div>
            <div className="mb-4 flex flex-wrap gap-1.5">
              <Badge variant="neutral">
                Max {tournament.maxPlayers} players
              </Badge>
              {tournament.format === "swiss" && (
                <Badge variant="neutral">{tournament.swissRounds} rounds</Badge>
              )}
              {tournament.format === "round_robin" &&
                tournament.robinRounds &&
                tournament.robinRounds > 1 && (
                  <Badge variant="neutral">{tournament.robinRounds}x</Badge>
                )}
              {tournament.format === "arena" && tournament.arenaMinutes && (
                <Badge variant="neutral">
                  {tournament.arenaMinutes} min arena
                </Badge>
              )}
              {tournament.regFeeTokens > 0 && (
                <Badge variant="neutral">
                  {tournament.regFeeTokens}{" "}
                  <RCoin size={11} className="inline align-[-1px]" /> to join
                </Badge>
              )}
              {tournament.berserkAllowed && tournament.format !== "normal" && (
                <Badge variant="neutral">Berserk allowed ⚔</Badge>
              )}
              {tournament.hasPassword && (
                <Badge variant="neutral">
                  <Lock className="inline h-3 w-3 align-[-1px]" /> Password
                  protected
                </Badge>
              )}
            </div>

            {tournament.status === "pending" && (
              <div className="space-y-3">
                {tournament.scheduledStartAt && (
                  <StartCountdown
                    scheduledStartAt={tournament.scheduledStartAt}
                  />
                )}
                <div className="flex flex-wrap items-end gap-2">
                  {!isPlayer && (
                    <>
                      {tournament.hasPassword && (
                        <div className="w-40">
                          <Input
                            type="password"
                            placeholder="Password"
                            value={joinPassword}
                            onChange={(e) => setJoinPassword(e.target.value)}
                          />
                        </div>
                      )}
                      <Button variant="secondary" size="sm" onClick={join}>
                        Join
                      </Button>
                    </>
                  )}
                  {isPlayer && !isCreator && (
                    <Button variant="glass" size="sm" onClick={leave}>
                      Leave
                    </Button>
                  )}
                  {isCreator && (
                    <>
                      {/* Mirrors the server's own "still safe to edit"
                       *  threshold in updateTournament, organizerOnly
                       *  tournaments never count the creator as a player,
                       *  so their threshold is 0 joined players, not 1. */}
                      {tournament.players.length <=
                        (tournament.organizerOnly ? 0 : 1) && (
                        <Button
                          variant="glass"
                          size="sm"
                          onClick={() => setEditing(true)}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                      )}
                      <Button variant="danger" size="sm" onClick={cancel}>
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

            {tournament.status === "active" && !isPlayer && (
              <LateJoinRow
                tournament={tournament}
                joinPassword={joinPassword}
                setJoinPassword={setJoinPassword}
                join={join}
              />
            )}

            {tournament.status === "active" &&
              isPlayer &&
              tournament.format === "arena" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="glass"
                    size="sm"
                    onClick={() => togglePause(!myPlayer?.paused)}
                  >
                    {myPlayer?.paused ? (
                      <>
                        <Play className="h-3.5 w-3.5" /> Resume
                      </>
                    ) : (
                      <>
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </>
                    )}
                  </Button>
                </div>
              )}

            {tournament.status === "cancelled" && (
              <p className="text-sm text-red-400">
                This tournament was cancelled
                {tournament.cancelReason
                  ? `, ${tournament.cancelReason}.`
                  : "."}
              </p>
            )}
          </Card>
        )}

        {tournament.status === "pending" && tournament.format === "normal" && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>
                Players joined{" "}
                <span className="text-base-content/40">
                  ({tournament.players.length})
                </span>
              </CardTitle>
            </CardHeader>
            {tournament.players.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-2">
                {[...tournament.players]
                  .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
                  .map((p) => {
                    const isMe = p.user === myId;
                    const isOrganizer = p.user === tournament.createdBy;
                    return (
                      <Badge
                        key={p.user}
                        variant={isMe ? "secondary" : "neutral"}
                        className="gap-1.5 py-1 pl-1.5 pr-2.5"
                      >
                        <Avatar
                          username={p.username}
                          gradient={p.avatarGradient}
                          size="xs"
                        />
                        {isOrganizer && (
                          <span className="text-amber-400">★</span>
                        )}
                        <span className="max-w-32 truncate">{p.username}</span>
                      </Badge>
                    );
                  })}
              </div>
            ) : (
              <p className="text-sm text-base-content/50">
                Nobody's joined yet, be the first.
              </p>
            )}
          </Card>
        )}

        {tournament.prizeSchedule.length > 0 && (
          <Card variant="solid">
            <button
              type="button"
              onClick={() => setPrizePoolOpen((v) => !v)}
              className="flex w-full  items-center justify-between text-left"
              aria-expanded={prizePoolOpen}
            >
              <CardTitle className="inline-flex items-center gap-1">
                Prize pool <span className="text-secondary">{"->"}</span>{" "}
                {tournament.prizePoolTokens} <RCoin size={14} />
              </CardTitle>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-base-content/40 transition-transform ${
                  prizePoolOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {/* grid-template-rows 0fr->1fr instead of Framer Motion's
             *  height:"auto": animating to "auto" isn't a GPU-accelerated
             *  property, Framer Motion approximates it by remeasuring the
             *  content's real height on every frame, which is what made
             *  this feel laggy. This CSS-only version transitions a single
             *  layout property natively instead. */}
            <div
              className="grid overflow-hidden transition-[grid-template-rows] duration-200 ease-in-out"
              style={{ gridTemplateRows: prizePoolOpen ? "1fr" : "0fr" }}
            >
              <div className="min-h-0 space-y-1 pt-2 text-sm text-base-content/70">
                {tournament.prizeSchedule.map((tier, i) => (
                  <div key={i} className="flex justify-between">
                    <span>
                      {tier.fromRank === tier.toRank
                        ? `${tier.fromRank}${ordinalSuffix(tier.fromRank)} place`
                        : `${tier.fromRank}${ordinalSuffix(tier.fromRank)}–${tier.toRank}${ordinalSuffix(tier.toRank)} place`}
                    </span>
                    <span className="font-medium text-base-content flex items-center">
                      {tier.tokens} <RCoin size={12} className="ml-1" />
                      <span className="ml-1 opacity-85 text-xs">
                        {tokensLabel(tier).slice(1)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {tournament.status === "active" && tournament.nextRoundStartsAt && (
          <BreakCountdown nextRoundStartsAt={tournament.nextRoundStartsAt} />
        )}

        {tournament.status === "active" &&
          tournament.format === "arena" &&
          tournament.arenaEndsAt && (
            <ArenaCountdown arenaEndsAt={tournament.arenaEndsAt} />
          )}

        {tournament.format === "normal" && (
          <KnockoutBracket tournament={tournament} myId={myId} />
        )}

        {isPointsFormat && standings.length > 0 && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>Standings</CardTitle>
              <div className="flex items-center gap-2">
                {myStandingsIndex !== -1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setStandingsPage(
                        Math.floor(myStandingsIndex / STANDINGS_PAGE_SIZE),
                      )
                    }
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-(--secondary) transition-colors hover:bg-(--secondary)/10"
                  >
                    <LocateFixed className="h-3.5 w-3.5" /> Me
                  </button>
                )}
                <Pagination
                  page={safeStandingsPage}
                  pageCount={standingsPageCount}
                  onPageChange={setStandingsPage}
                />
              </div>
            </CardHeader>
            <div className="overflow-hidden rounded-xl border border-base-300">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-base-300/50 text-left text-[11px] font-semibold uppercase tracking-wide text-base-content/50">
                    <th className="w-10 px-3 py-2">#</th>
                    <th className="px-3 py-2">Player</th>
                    <th className="px-3 py-2 text-right">Games</th>
                    <th className="px-3 py-2 text-right">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedStandings.map((p, i) => {
                    const rank =
                      safeStandingsPage * STANDINGS_PAGE_SIZE + i + 1;
                    const isMe = p.user === myId;
                    return (
                      <tr
                        key={p.user}
                        className={cn(
                          "border-t border-base-300/60 transition-colors",
                          isMe
                            ? "bg-(--secondary)/10"
                            : i % 2 === 0
                              ? "bg-base-100/50"
                              : "bg-base-200/50",
                        )}
                      >
                        <td className="pl-3 py-2">
                          <RankBadge rank={rank} />
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2",
                            isMe && "font-semibold text-(--secondary)",
                          )}
                        >
                          <ResponsiveOverlay
                            align="start"
                            trigger={
                              <button className="flex items-center gap-1.5 text-left hover:scale-95 duration-150">
                                <Avatar
                                  username={p.username}
                                  gradient={p.avatarGradient}
                                  size="xs"
                                />
                                {p.username}
                                {p.paused && (
                                  <Badge variant="neutral" className="py-0!">
                                    paused
                                  </Badge>
                                )}
                              </button>
                            }
                          >
                            <PlayerTournamentDetails
                              tournament={tournament}
                              player={p}
                            />
                          </ResponsiveOverlay>
                        </td>
                        <td className="px-3 py-2 text-right text-base-content/60">
                          {p.gamesPlayed}
                        </td>
                        <td
                          className={cn(
                            isMe ? "text-secondary" : "text-base-content",
                            "px-3 py-2 text-right font-semibold",
                          )}
                        >
                          {p.points}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {tournament.format === "arena" && tournament.status === "active" && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>Pairing pool</CardTitle>
            </CardHeader>
            {pairingPool.length > 0 ? (
              <div className="space-y-1.5">
                {pairingPool.map((p) => (
                  <div
                    key={p.user}
                    className="flex items-center gap-2 rounded-lg bg-base-200/50 px-3 py-2"
                  >
                    <Avatar
                      username={p.username}
                      gradient={p.avatarGradient}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {p.username}
                      {p.user === myId && (
                        <span className="ml-1.5 text-xs font-normal text-base-content/50">
                          (you)
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-base-content/50">
                      {p.points} pt{p.points === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-base-content/50">
                Nobody's free to be paired right now, everyone's either mid-game
                or paused.
              </p>
            )}
          </Card>
        )}

        {tournament.format !== "arena" &&
          tournament.rounds.length > 0 &&
          selectedRound && (
            <Card variant="solid">
              <div className="mb-3 overflow-x-auto">
                <Tabs
                  items={tournament.rounds.map((r) => ({
                    value: String(r.index),
                    label:
                      tournament.format === "normal"
                        ? roundLabel(r.index, tournament.rounds.length)
                        : `Round ${r.index + 1}`,
                  }))}
                  value={String(selectedRoundIndex)}
                  onChange={(v) => setManualRoundIndex(Number(v))}
                />
              </div>
              <CardHeader>
                <CardTitle>
                  {tournament.format === "normal"
                    ? roundLabel(selectedRound.index, tournament.rounds.length)
                    : `Round ${selectedRound.index + 1}`}
                  {selectedRound.index === currentRound?.index &&
                    selectedRound.status === "active" && (
                      <Badge variant="success" className="ml-2">
                        current
                      </Badge>
                    )}
                </CardTitle>
              </CardHeader>
              <div className="space-y-1.5">
                {selectedRound.pairings.map((pairing) => (
                  <PairingRow
                    key={pairing.index}
                    tournament={tournament}
                    pairing={pairing}
                    myId={myId}
                  />
                ))}
              </div>
            </Card>
          )}
      </div>

      {tournament.chatEnabled && (
        <ChatDrawer
          show
          open={chatSheetOpen}
          onClose={() => setChatSheetOpen(false)}
          title="Tournament chat"
          messages={chatMessages}
          myUsername={user?.username}
          onSend={handleSendChat}
        />
      )}
    </Page>
  );
}
