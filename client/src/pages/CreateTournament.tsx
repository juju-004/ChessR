import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trophy } from "lucide-react";
import {
  FORMAT_LABEL,
  FORMAT_DESCRIPTION,
  FORMAT_MAX_PLAYERS,
  robinRoundsLabel,
  type TournamentFormat,
  type TournamentPrizeTier,
} from "../api/tournaments.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useRakePercent } from "../hooks/useRakePercent.js";
import { HelpTip } from "../components/HelpTip.js";
import { PrizePoolEditor } from "../components/tournaments/PrizePoolEditor.js";
import {
  Page,
  Card,
  CardContent,
  Input,
  Select,
  Button,
  Switch,
  RCoin,
} from "../components/ui/index.js";
// The global time-control list (../timeControls.js) is now the single
// source of truth — this page used to keep its own near-duplicate list,
// which is exactly what let it drift out of sync with every other select
// in the app.
import { TIME_CONTROLS as TIME_PRESETS } from "../timeControls.js";
import { MAX_WAGER_TOKENS, MAX_EVENT_NAME_LENGTH } from "../lib/limits.js";

const FORMAT_DEFAULT_MAX: Record<TournamentFormat, number> = {
  normal: 16,
  swiss: 12,
  round_robin: 6,
  arena: 20,
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

export function CreateTournament() {
  const socket = useSocket();
  const navigate = useNavigate();
  const rakePercent = useRakePercent();

  const [status, setStatus] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // --- Basics ---
  const [name, setName] = useState("");
  const [format, setFormat] = useState<TournamentFormat>("swiss");
  const [variant, setVariant] = useState<"standard" | "chess960">("standard");
  const [presetIdx, setPresetIdx] = useState(3);

  // --- Players & schedule ---
  const [maxPlayers, setMaxPlayers] = useState(FORMAT_DEFAULT_MAX.swiss);
  const [swissRounds, setSwissRounds] = useState(5);
  const [robinRounds, setRobinRounds] = useState(1);
  const [arenaMinutes, setArenaMinutes] = useState(60);
  const [breakSeconds, setBreakSeconds] = useState(10);
  const [startInput, setStartInput] = useState(defaultStartInput);

  // --- Access ---
  const [isPublic, setIsPublic] = useState(false);
  const [password, setPassword] = useState("");
  const [berserkAllowed, setBerserkAllowed] = useState(true);

  // --- Money ---
  const [organizerOnly, setOrganizerOnly] = useState(false);
  const [thirdPlaceMatch, setThirdPlaceMatch] = useState(false);
  const [regFeeInput, setRegFeeInput] = useState("10");
  const [prizeTiers, setPrizeTiers] = useState<TournamentPrizeTier[]>([]);

  useEffect(() => {
    if (!socket) return;
    function onCreated(payload: { code: string }) {
      navigate(`/tournaments/${payload.code}`);
    }
    function onError(payload: { message: string }) {
      setSubmitting(false);
      setStatus({ message: payload.message, isError: true });
    }
    socket.on("tournament:created", onCreated);
    socket.on("tournament:error", onError);
    return () => {
      socket.off("tournament:created", onCreated);
      socket.off("tournament:error", onError);
    };
  }, [socket, navigate]);

  function handleFormatChange(f: TournamentFormat) {
    setFormat(f);
    setMaxPlayers(FORMAT_DEFAULT_MAX[f]);
  }

  function handleCreate() {
    if (!socket) return;
    if (name.trim().length < 3)
      return setStatus({
        message: "Give it a name (3+ characters).",
        isError: true,
      });
    const regFeeTokens = Math.min(
      MAX_WAGER_TOKENS,
      Math.max(0, Math.floor(Number(regFeeInput) || 0)),
    );
    if (regFeeTokens < 1) {
      return setStatus({
        message: "Set a registration fee — every tournament requires one.",
        isError: true,
      });
    }
    const scheduledStartAt = new Date(startInput);
    if (
      Number.isNaN(scheduledStartAt.getTime()) ||
      scheduledStartAt.getTime() < Date.now() + 5000
    ) {
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

    setStatus(null);
    setSubmitting(true);
    socket.emit("tournament:create", {
      name: name.trim(),
      format,
      variant,
      baseMinutes: preset.baseMinutes,
      incrementSeconds: preset.incrementSeconds,
      maxPlayers,
      berserkAllowed,
      isPublic,
      organizerOnly,
      thirdPlaceMatch: format === "normal" ? thirdPlaceMatch : false,
      prizeSchedule: prizeTiers,
      regFeeTokens,
      swissRounds: format === "swiss" ? swissRounds : null,
      robinRounds: format === "round_robin" ? robinRounds : null,
      arenaMinutes: format === "arena" ? arenaMinutes : null,
      breakSeconds,
      scheduledStartAt: scheduledStartAt.toISOString(),
      password: password.trim() || undefined,
    });
  }

  return (
    <Page title="Create a tournament" back="/tournaments">
      <div className="mx-auto space-y-4">
        <Card variant="solid">
          <CardContent className="space-y-5">
            {/* Basics */}
            <section className="space-y-3">
              <Input
                label="Tournament name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Friday Night Blitz"
                maxLength={MAX_EVENT_NAME_LENGTH}
              />

              <div>
                <label className="mb-1.5 block text-sm font-medium text-base-content/80">
                  Format
                </label>
                <div className="grid grid-cols-2 mb-7 gap-2">
                  {(Object.keys(FORMAT_LABEL) as TournamentFormat[]).map(
                    (f) => (
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
                    ),
                  )}
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
                <Input
                  label="Max players"
                  type="number"
                  min={2}
                  max={FORMAT_MAX_PLAYERS[format]}
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(Number(e.target.value))}
                />
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
                <Input
                  label="Break (sec)"
                  type="number"
                  min={0}
                  max={300}
                  value={breakSeconds}
                  onChange={(e) => setBreakSeconds(Number(e.target.value))}
                />
              </div>

              <Input
                label={
                  <span className="inline-flex items-center gap-1">
                    Start date and time
                    <HelpTip>
                      Starts automatically at this time once enough players have
                      joined.
                    </HelpTip>
                  </span>
                }
                type="datetime-local"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
              />
            </section>

            {/* Access */}

            {/* Money */}
            <section className="space-y-3 border-t border-base-300 pt-4">
              <Input
                label={
                  <span className="inline-flex items-center gap-1">
                    Registration fee (<RCoin size={12} /> Coins)
                    <HelpTip>
                      {rakePercent !== null
                        ? `Every entrant pays this to join. Held until the tournament ends, then the ${rakePercent}% platform fee is deducted and the rest is paid out to you as the organizer.`
                        : "Every entrant pays this to join. Held until the tournament ends, then the platform fee is deducted and the rest is paid out to you as the organizer."}
                    </HelpTip>
                  </span>
                }
                type="number"
                min={1}
                max={MAX_WAGER_TOKENS}
                value={regFeeInput}
                onChange={(e) => setRegFeeInput(e.target.value)}
              />

              <PrizePoolEditor
                value={prizeTiers}
                onChange={setPrizeTiers}
                maxPlayers={maxPlayers}
              />
              <Input
                label="Password (optional)"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="*******"
              />
            </section>
            <section className="space-y-3 border-t border-base-300 pt-4">
              <Switch
                checked={isPublic}
                onChange={setIsPublic}
                label="List publicly"
                description="Visible in the Open tournaments list for anyone to find."
              />
              <Switch
                checked={berserkAllowed}
                onChange={setBerserkAllowed}
                label="Allow berserk"
                description="Half clock, no increment, +0.5 point on a win."
              />

              <Switch
                checked={organizerOnly}
                onChange={setOrganizerOnly}
                label="I'm organizing only"
                description="You run the tournament but don't play in it. You won't take a player slot or pay the registration fee."
              />

              {format === "normal" && (
                <Switch
                  checked={thirdPlaceMatch}
                  onChange={setThirdPlaceMatch}
                  label="3rd place playoff"
                  description="The two semifinal losers play each other for 3rd place, alongside the final."
                />
              )}
            </section>

            {status && (
              <p
                className={`text-sm ${status.isError ? "text-red-400" : "text-green-400"}`}
              >
                {status.message}
              </p>
            )}

            <Button
              variant="secondary"
              fullWidth
              onClick={handleCreate}
              disabled={submitting}
            >
              <Trophy className="h-4 w-4" />
              {submitting ? "Creating…" : "Create tournament"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
