import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, Plus, X } from "lucide-react";
import {
  listOpenTournaments,
  listMyTournaments,
  FORMAT_LABEL,
  FORMAT_DESCRIPTION,
  formatTimeControl,
  totalPrizePool,
  type Tournament,
  type TournamentFormat,
  type TournamentPrizeTier,
} from "../api/tournaments.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import {
  Page,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  Select,
  Button,
  Badge,
  Switch,
} from "../components/ui/index.js";

const TIME_PRESETS: {
  label: string;
  baseMinutes: number | null;
  incrementSeconds: number;
}[] = [
  { label: "Bullet · 1+0", baseMinutes: 1, incrementSeconds: 0 },
  { label: "Bullet · 2+1", baseMinutes: 2, incrementSeconds: 1 },
  { label: "Blitz · 3+2", baseMinutes: 3, incrementSeconds: 2 },
  { label: "Blitz · 5+0", baseMinutes: 5, incrementSeconds: 0 },
  { label: "Rapid · 10+0", baseMinutes: 10, incrementSeconds: 0 },
  { label: "Rapid · 15+10", baseMinutes: 15, incrementSeconds: 10 },
  { label: "Classical · 30+0", baseMinutes: 30, incrementSeconds: 0 },
];

const FORMAT_DEFAULT_MAX: Record<TournamentFormat, number> = {
  normal: 16,
  swiss: 12,
  robin: 8,
  round_robin: 6,
};

const STATUS_VARIANT: Record<
  Tournament["status"],
  "neutral" | "success" | "error"
> = {
  pending: "neutral",
  active: "success",
  finished: "neutral",
  cancelled: "error",
};

// Default datetime-local value: 5 minutes from now, formatted the way the
// input wants it (local time, no seconds/timezone) — gives the creator a
// sane starting point they can push later rather than a blank/past field.
function defaultStartInput(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TournamentRow({ t }: { t: Tournament }) {
  return (
    <Link
      to={`/tournaments/${t.code}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100/60 px-3 py-2.5 transition-colors hover:border-(--primary)/40"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-base-content">{t.name}</span>
          <Badge variant={STATUS_VARIANT[t.status]}>{t.status}</Badge>
        </div>
        <div className="mt-0.5 text-xs text-base-content/50">
          {FORMAT_LABEL[t.format]} · {formatTimeControl(t)} · {t.players.length}
          /{t.maxPlayers} players
          {t.regFeeTokens > 0 && <> · {t.regFeeTokens} R to join</>}
          {t.prizePoolTokens > 0 && <> · {t.prizePoolTokens} R prize pool</>}
          {t.berserkAllowed && <> · Berserk on</>}
        </div>
      </div>
      <span className="shrink-0 text-xs text-base-content/40">#{t.code}</span>
    </Link>
  );
}

export function Tournaments() {
  const socket = useSocket();
  const { user } = useAuth();
  const [open, setOpen] = useState<Tournament[]>([]);
  const [mine, setMine] = useState<Tournament[]>([]);
  const [status, setStatus] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);

  const [name, setName] = useState("");
  const [format, setFormat] = useState<TournamentFormat>("swiss");
  const [presetIdx, setPresetIdx] = useState(3);
  const [variant, setVariant] = useState<"standard" | "chess960">("standard");
  const [maxPlayers, setMaxPlayers] = useState(FORMAT_DEFAULT_MAX.swiss);
  const [swissRounds, setSwissRounds] = useState(5);
  const [breakSeconds, setBreakSeconds] = useState(10);
  const [berserkAllowed, setBerserkAllowed] = useState(true);
  const [isPublic, setIsPublic] = useState(false);
  const [regFeeInput, setRegFeeInput] = useState("0");
  const [prizeTiers, setPrizeTiers] = useState<TournamentPrizeTier[]>([]);
  const [password, setPassword] = useState("");
  const [startInput, setStartInput] = useState(defaultStartInput);

  const refresh = useCallback(() => {
    listOpenTournaments().then((res) => setOpen(res.tournaments));
    if (user) listMyTournaments().then((res) => setMine(res.tournaments));
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socket) return;
    function onCreated(payload: { code: string }) {
      setStatus({ message: "Tournament created!", isError: false });
      refresh();
      window.location.assign(`/tournaments/${payload.code}`);
    }
    function onError(payload: { message: string }) {
      setStatus({ message: payload.message, isError: true });
    }
    socket.on("tournament:created", onCreated);
    socket.on("tournament:update", refresh);
    socket.on("tournament:started", refresh);
    socket.on("tournament:cancelled", refresh);
    socket.on("tournament:deleted", refresh);
    socket.on("tournament:error", onError);
    return () => {
      socket.off("tournament:created", onCreated);
      socket.off("tournament:update", refresh);
      socket.off("tournament:started", refresh);
      socket.off("tournament:cancelled", refresh);
      socket.off("tournament:deleted", refresh);
      socket.off("tournament:error", onError);
    };
  }, [socket, refresh]);

  function handleFormatChange(f: TournamentFormat) {
    setFormat(f);
    setMaxPlayers(FORMAT_DEFAULT_MAX[f]);
  }

  function addPrizeTier() {
    const nextRank = (prizeTiers[prizeTiers.length - 1]?.toRank ?? 0) + 1;
    setPrizeTiers([...prizeTiers, { fromRank: nextRank, toRank: nextRank, tokens: 0 }]);
  }

  function updatePrizeTier(i: number, patch: Partial<TournamentPrizeTier>) {
    setPrizeTiers(prizeTiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  function removePrizeTier(i: number) {
    setPrizeTiers(prizeTiers.filter((_, idx) => idx !== i));
  }

  function handleCreate() {
    if (!socket) return;
    if (name.trim().length < 3)
      return setStatus({
        message: "Give it a name (3+ characters).",
        isError: true,
      });
    const regFeeTokens = Math.max(0, Math.floor(Number(regFeeInput) || 0));
    const scheduledStartAt = new Date(startInput);
    if (Number.isNaN(scheduledStartAt.getTime()) || scheduledStartAt.getTime() < Date.now() + 5000) {
      return setStatus({
        message: "Pick a start time a bit further in the future.",
        isError: true,
      });
    }
    for (const tier of prizeTiers) {
      if (tier.toRank > maxPlayers) {
        return setStatus({
          message: `Prize schedule can't cover a rank beyond your ${maxPlayers}-player cap.`,
          isError: true,
        });
      }
    }
    const preset = TIME_PRESETS[presetIdx];

    socket.emit("tournament:create", {
      name: name.trim(),
      format,
      variant,
      baseMinutes: preset.baseMinutes,
      incrementSeconds: preset.incrementSeconds,
      maxPlayers,
      berserkAllowed,
      isPublic,
      prizeSchedule: prizeTiers,
      regFeeTokens,
      swissRounds: format === "swiss" ? swissRounds : null,
      breakSeconds,
      scheduledStartAt: scheduledStartAt.toISOString(),
      password: password.trim() || undefined,
    });
  }

  const prizePoolTotal = totalPrizePool(prizeTiers);
  const openPending = open.filter((t) => t.status === "pending");
  const openActive = open.filter((t) => t.status === "active");

  return (
    <Page
      title="Tournaments"
      description="Run a knockout bracket, a swiss event, or a full round-robin."
    >
      <div className="mx-auto space-y-4">
        {status && (
          <p
            className={`text-sm ${status.isError ? "text-red-400" : "text-green-400"}`}
          >
            {status.message}
          </p>
        )}

        <Card variant="solid">
          <CardHeader>
            <CardTitle>Open tournaments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {openPending.length === 0 && (
              <p className="text-sm text-base-content/50">
                No public tournaments waiting for players right now.
              </p>
            )}
            {openPending.map((t) => (
              <TournamentRow key={t._id} t={t} />
            ))}
          </CardContent>
        </Card>

        <Card variant="solid">
          <CardHeader>
            <CardTitle>Create a tournament</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-base-content/50">
              Tournaments are link/code-only by default — turn on "List publicly" below to also show it in Open tournaments for anyone to find.
            </p>
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Friday Night Blitz"
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

            <div className="flex flex-wrap gap-3">
              <div className="w-44">
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
              </div>
              <div className="w-32">
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
              <div className="w-28">
                <Input
                  label="Max players"
                  type="number"
                  min={2}
                  max={64}
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(Number(e.target.value))}
                />
              </div>
              {format === "swiss" && (
                <div className="w-24">
                  <Input
                    label="Rounds"
                    type="number"
                    min={3}
                    max={15}
                    value={swissRounds}
                    onChange={(e) => setSwissRounds(Number(e.target.value))}
                  />
                </div>
              )}
              <div className="w-28">
                <Input
                  label="Break (secs)"
                  type="number"
                  min={0}
                  max={300}
                  value={breakSeconds}
                  onChange={(e) => setBreakSeconds(Number(e.target.value))}
                />
              </div>
            </div>

            <Switch
              checked={berserkAllowed}
              onChange={setBerserkAllowed}
              label="Allow berserking"
              description="Halve your own clock (and forfeit your increment) for a shot at a bonus 0.5 point on a win."
            />

            <Switch
              checked={isPublic}
              onChange={setIsPublic}
              label="List publicly"
              description="Show up in the Open tournaments browse list for anyone to find and join. Off by default — otherwise only reachable via the link or code."
            />

            <div className="space-y-2 border-t border-base-300 pt-4">
              <Input
                label="Start time"
                type="datetime-local"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
              />
              <p className="text-xs text-base-content/50">
                The event starts itself at this time (if enough players have joined) — or you can start it early once the lobby's ready.
              </p>
            </div>

            <div className="space-y-2 border-t border-base-300 pt-4">
              <Input
                label="Password (optional)"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank for anyone with the link to join"
              />
            </div>

            <div className="space-y-2 border-t border-base-300 pt-4">
              <Input
                label="Registration fee — R Coins (optional)"
                type="number"
                min={0}
                value={regFeeInput}
                onChange={(e) => setRegFeeInput(e.target.value)}
              />
              <p className="text-xs text-base-content/50">
                Each player (including you) pays this to join. Held until the event finishes, then the whole pool comes to you as the organizer.
              </p>
            </div>

            <div className="space-y-2 border-t border-base-300 pt-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-base-content/80">
                  Prize pool (optional)
                </label>
                {prizePoolTotal > 0 && (
                  <span className="text-xs text-base-content/50">
                    {prizePoolTotal} R total — deducted from you now
                  </span>
                )}
              </div>
              <p className="text-xs text-base-content/50">
                Set what each rank range wins. Deducted from your own balance now, paid out by final standing when the event ends.
              </p>
              {prizeTiers.length === 0 && (
                <p className="text-sm text-base-content/40">No prize tiers yet — add one below.</p>
              )}
              {prizeTiers.map((tier, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-base-content/50">Rank</span>
                  <div className="w-16">
                    <Input
                      type="number"
                      min={1}
                      value={tier.fromRank}
                      onChange={(e) => updatePrizeTier(i, { fromRank: Number(e.target.value) })}
                    />
                  </div>
                  <span className="text-xs text-base-content/50">to</span>
                  <div className="w-16">
                    <Input
                      type="number"
                      min={1}
                      value={tier.toRank}
                      onChange={(e) => updatePrizeTier(i, { toRank: Number(e.target.value) })}
                    />
                  </div>
                  <span className="text-xs text-base-content/50">gets</span>
                  <div className="w-24">
                    <Input
                      type="number"
                      min={0}
                      value={tier.tokens}
                      onChange={(e) => updatePrizeTier(i, { tokens: Number(e.target.value) })}
                    />
                  </div>
                  <span className="text-xs text-base-content/50">R each</span>
                  <button
                    onClick={() => removePrizeTier(i)}
                    aria-label="Remove prize tier"
                    className="ml-auto rounded-md p-1 text-red-400 hover:bg-red-900/30"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={addPrizeTier}>
                <Plus className="h-4 w-4" /> Add prize tier
              </Button>
            </div>

            <Button variant="secondary" fullWidth onClick={handleCreate}>
              <Trophy className="h-4 w-4" /> Create tournament
            </Button>
          </CardContent>
        </Card>

        {openActive.length > 0 && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>In progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {openActive.map((t) => (
                <TournamentRow key={t._id} t={t} />
              ))}
            </CardContent>
          </Card>
        )}

        {mine.length > 0 && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>Your tournaments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {mine.map((t) => (
                <TournamentRow key={t._id} t={t} />
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </Page>
  );
}
