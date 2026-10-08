import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Trophy, Users, X } from "lucide-react";
import {
  FORMAT_LABEL,
  FORMAT_DESCRIPTION,
  MAX_TOURNAMENT_PLAYERS,
  robinRoundsLabel,
  type TournamentFormat,
  type TournamentPrizeTier,
} from "../api/tournaments.js";
import { useSocket } from "../contexts/SocketContext.js";
import { getTeam, searchTeams, type TeamSummary } from "../api/teams.js";
import { getMyOrganization, type MyOrganization } from "../api/organizations.js";
import {
  listMyLeagues,
  LEAGUE_FORMATS,
  type LeagueSummary,
} from "../api/leagues.js";
import { useRakePercent } from "../hooks/useRakePercent.js";
import { HelpTip } from "../components/HelpTip.js";
import { PrizePoolEditor } from "../components/tournaments/PrizePoolEditor.js";
import {
  Page,
  Card,
  CardContent,
  Input,
  EmojiInput,
  Textarea,
  Select,
  Button,
  Switch,
  RCoin,
  Tabs,
} from "../components/ui/index.js";
// The global time-control list (../timeControls.js) is now the single
// source of truth, this page used to keep its own near-duplicate list,
// which is exactly what let it drift out of sync with every other select
// in the app.
import { TIME_CONTROLS as TIME_PRESETS } from "../timeControls.js";
import {
  MAX_WAGER_TOKENS,
  MIN_STAKE_TOKENS,
  MAX_EVENT_NAME_LENGTH,
} from "../lib/limits.js";

// Default datetime-local value: 5 minutes from now, formatted the way the
// input wants it (local time, no seconds/timezone), gives the creator a
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
  // /tournaments/new?team=<id> creates an in-house tournament for a team
  // the caller owns: only its members can join, and it's never listed
  // publicly. The server re-checks ownership, this is just the UI side.
  const teamId = useSearchParams()[0].get("team");
  const [teamName, setTeamName] = useState<string | null>(null);
  useEffect(() => {
    if (!teamId) return;
    getTeam(teamId)
      .then((r) => setTeamName(r.team.name))
      .catch(() => setTeamName(null));
  }, [teamId]);

  // /tournaments/new?battle=1 creates a TEAM BATTLE: only an approved
  // organisation may (the server enforces it, this is the UI side), and only
  // swiss/arena are offered.
  const initialBattle = useSearchParams()[0].get("battle") === "1";
  // Normal tournament vs team battle, switched with the tabs below (the tabs
  // only show for approved organisations).
  const [mode, setMode] = useState<"normal" | "battle">(
    initialBattle ? "battle" : "normal",
  );
  const battleMode = mode === "battle";
  const [org, setOrg] = useState<MyOrganization | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [battleTeams, setBattleTeams] = useState<TeamSummary[]>([]);
  const [leadersPerTeam, setLeadersPerTeam] = useState(5);
  const [teamQuery, setTeamQuery] = useState("");
  const [teamResults, setTeamResults] = useState<TeamSummary[]>([]);
  useEffect(() => {
    getMyOrganization()
      .then((r) => setOrg(r.organization))
      .catch(() => setOrg(null))
      .finally(() => setOrgLoading(false));
  }, []);
  // --- League ---
  // /tournaments/new?league=<id> (from a league page's "Add tournament")
  // preselects that league. Only approved organisations have any leagues, so
  // for everyone else this section never renders.
  const preselectedLeague = useSearchParams()[0].get("league") ?? "";
  const [myLeagues, setMyLeagues] = useState<LeagueSummary[]>([]);
  const [leagueId, setLeagueId] = useState(preselectedLeague);
  useEffect(() => {
    listMyLeagues()
      .then((r) => setMyLeagues(r.leagues))
      .catch(() => setMyLeagues([]));
  }, []);
  const selectedLeague =
    myLeagues.find((c) => c.id === leagueId) ?? null;

  function handleModeChange(next: "normal" | "battle") {
    setMode(next);
    // Team battles are swiss/arena only.
    if (next === "battle" && format !== "swiss" && format !== "arena") {
      setFormat("swiss");
    }
  }
  useEffect(() => {
    if (!battleMode) return;
    const t = setTimeout(() => {
      searchTeams(teamQuery.trim())
        .then((r) => setTeamResults(r.teams))
        .catch(() => setTeamResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [battleMode, teamQuery]);
  function addBattleTeam(t: TeamSummary) {
    setBattleTeams((prev) =>
      prev.some((x) => x.id === t.id) || prev.length >= 20 ? prev : [...prev, t],
    );
  }

  const [status, setStatus] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // --- Basics ---
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState<TournamentFormat>("swiss");
  const [variant, setVariant] = useState<"standard" | "chess960">("standard");
  const [presetIdx, setPresetIdx] = useState(3);

  // --- Players & schedule ---
  const [swissRounds, setSwissRounds] = useState(5);
  const [robinRounds, setRobinRounds] = useState(1);
  const [arenaMinutes, setArenaMinutes] = useState(60);
  const [breakSeconds, setBreakSeconds] = useState(10);
  const [startInput, setStartInput] = useState(defaultStartInput);

  // --- Access ---
  const [isPublic, setIsPublic] = useState(false);
  const [password, setPassword] = useState("");
  const [berserkAllowed, setBerserkAllowed] = useState(true);
  const [chatEnabled, setChatEnabled] = useState(false);

  // --- Money ---
  const [organizerOnly, setOrganizerOnly] = useState(false);
  const [thirdPlaceMatch, setThirdPlaceMatch] = useState(false);
  const [regFeeInput, setRegFeeInput] = useState("0");
  const [prizePoolCurrency, setPrizePoolCurrency] = useState<
    "tokens" | "naira"
  >("tokens");
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
  }

  function handlePrizeCurrencyChange(currency: "tokens" | "naira") {
    if (currency === prizePoolCurrency) return;
    setPrizePoolCurrency(currency);
    // The same numbers mean something completely different across
    // currencies (R Coins vs naira), so carrying the old schedule over
    // would silently misrepresent it. Clear it and let the organizer
    // re-enter the schedule in the new currency.
    setPrizeTiers([]);
  }

  function handleCreate() {
    if (!socket) return;
    if (selectedLeague) {
      if (!(LEAGUE_FORMATS as readonly string[]).includes(format))
        return setStatus({
          message:
            "Tournaments in a league can only be Swiss or Arena. Pick one of those formats, or remove the league.",
          isError: true,
        });
      if (selectedLeague.tournamentCount >= selectedLeague.maxTournaments)
        return setStatus({
          message: `This league already has its ${selectedLeague.maxTournaments} tournaments, which is its limit.`,
          isError: true,
        });
      if (battleMode || teamId)
        return setStatus({
          message: "A team battle or in-house tournament can't be part of a league.",
          isError: true,
        });
    }
    if (battleMode && battleTeams.length < 2)
      return setStatus({
        message: "Pick at least 2 teams for the battle.",
        isError: true,
      });
    if (name.trim().length < 3)
      return setStatus({
        message: "Give it a name (3+ characters).",
        isError: true,
      });
    const regFeeTokens = Math.min(
      MAX_WAGER_TOKENS,
      Math.max(0, Math.floor(Number(regFeeInput) || 0)),
    );
    // Registration fee is optional now — 0 means a free tournament. Still
    // floored at MIN_STAKE_TOKENS if the organizer sets one at all.
    if (regFeeTokens > 0 && regFeeTokens < MIN_STAKE_TOKENS) {
      return setStatus({
        message: `Set a registration fee of at least ${MIN_STAKE_TOKENS} R, or 0 for a free tournament.`,
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
      if (tier.toRank > MAX_TOURNAMENT_PLAYERS) {
        return setStatus({
          message: `Prize schedule can't cover a rank beyond ${MAX_TOURNAMENT_PLAYERS}th place.`,
          isError: true,
        });
      }
    }
    const preset = TIME_PRESETS[presetIdx];

    setStatus(null);
    setSubmitting(true);
    socket.emit("tournament:create", {
      name: name.trim(),
      description: description.trim() || null,
      format,
      variant,
      baseMinutes: preset.baseMinutes,
      incrementSeconds: preset.incrementSeconds,
      berserkAllowed: format === "arena" && berserkAllowed,
      chatEnabled,
      isPublic: teamId ? false : isPublic,
      ...(teamId ? { teamId } : {}),
      organizerOnly: battleMode ? true : organizerOnly,
      ...(battleMode
        ? {
            teamBattle: {
              teamIds: battleTeams.map((t) => t.id),
              leadersPerTeam,
            },
          }
        : {}),
      ...(selectedLeague ? { cumulativeId: selectedLeague.id } : {}),
      thirdPlaceMatch: format === "normal" ? thirdPlaceMatch : false,
      prizeSchedule: prizeTiers,
      prizePoolCurrency,
      regFeeTokens,
      swissRounds: format === "swiss" ? swissRounds : null,
      robinRounds: format === "round_robin" ? robinRounds : null,
      arenaMinutes: format === "arena" ? arenaMinutes : null,
      breakSeconds: format === "arena" ? 0 : breakSeconds,
      scheduledStartAt: scheduledStartAt.toISOString(),
      password: password.trim() || undefined,
    });
  }

  if (battleMode && !orgLoading && org?.status !== "approved") {
    return (
      <Page title="Create a team battle" back="/tournaments">
        <Card variant="solid" className="mx-auto max-w-xl space-y-3">
          <p className="text-sm text-base-content/70">
            Team battles can only be created by approved organisations.
            {org?.status === "pending"
              ? " Your organisation request is still under review."
              : " Send a request with your organisation's name and WhatsApp number and we'll get back to you."}
          </p>
          <Link to="/organization/request">
            <Button variant="secondary" size="sm">
              {org?.status === "pending" ? "View request" : "Request organisation status"}
            </Button>
          </Link>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title={teamId ? "Create an in-house tournament" : "Create a tournament"}
      back={teamId ? `/teams/${teamId}` : "/tournaments"}
    >
      <div className="mx-auto space-y-4">
        {!teamId && org?.status === "approved" && (
          <Tabs
            value={mode}
            onChange={(v) => handleModeChange(v as "normal" | "battle")}
            items={[
              { value: "normal", label: "Tournament" },
              { value: "battle", label: "Team battle" },
            ]}
          />
        )}
        {battleMode && (
          <Card variant="solid" className="space-y-3">
            <div className="flex items-center gap-2 font-semibold text-base-content">
              <Users className="h-4 w-4" /> Teams in this battle
            </div>
            <p className="text-xs text-base-content/60">
              Players join on behalf of one of these teams. Each team's score is
              the sum of its best players' points, and the team standings are
              shown above the player standings.
            </p>
            {battleTeams.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {battleTeams.map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-(--primary)/10 px-3 py-1 text-xs font-medium text-base-content"
                  >
                    {t.name}
                    <button
                      type="button"
                      aria-label={`Remove ${t.name}`}
                      onClick={() =>
                        setBattleTeams((prev) => prev.filter((x) => x.id !== t.id))
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Input
              label="Search teams"
              value={teamQuery}
              onChange={(e) => setTeamQuery(e.target.value)}
              placeholder="Team name…"
            />
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {teamResults
                .filter((t) => !battleTeams.some((x) => x.id === t.id))
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => addBattleTeam(t)}
                    className="flex w-full items-center justify-between rounded-lg border border-base-300 bg-base-100/60 px-3 py-2 text-left text-sm hover:border-(--primary)/40"
                  >
                    <span className="truncate">{t.name}</span>
                    <span className="shrink-0 text-xs text-base-content/50">
                      {t.memberCount} members
                    </span>
                  </button>
                ))}
            </div>
            <Input
              label="Scoring players per team"
              type="number"
              min={1}
              max={10}
              value={leadersPerTeam}
              onChange={(e) =>
                setLeadersPerTeam(
                  Math.min(10, Math.max(1, Number(e.target.value) || 1)),
                )
              }
              hint="Only each team's best this-many players count towards its score."
            />
          </Card>
        )}
        {teamId && (
          <p className="rounded-xl bg-(--primary)/10 px-3 py-2 text-sm text-base-content/80">
            In-house tournament for <strong>{teamName ?? "your team"}</strong>.
            Only team members can join, and it won't appear in the public list.
          </p>
        )}
        <Card variant="solid">
          <CardContent className="space-y-5">
            {/* Basics */}
            <section className="space-y-3">
              <EmojiInput
                label="Tournament name"
                value={name}
                onChange={setName}
                placeholder="Friday Night Blitz"
                maxLength={MAX_EVENT_NAME_LENGTH}
              />

              <Textarea
                label="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Rules, context, anything players should know before joining…"
                maxLength={1000}
                rows={3}
              />

              <div>
                <label className="mb-1.5 block text-sm font-medium text-base-content/80">
                  Format
                </label>
                <div className="grid grid-cols-2 mb-7 gap-2">
                  {(Object.keys(FORMAT_LABEL) as TournamentFormat[])
                    .filter((f) => !battleMode || f === "swiss" || f === "arena")
                    .map((f) => (
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

            {/* League */}
            {!battleMode && !teamId && myLeagues.length > 0 && (
              <section className="space-y-3 border-t border-base-300 pt-4">
                <Select
                  label={
                    <span className="inline-flex items-center gap-1">
                      Add to a league
                      <HelpTip>
                        Makes this the next stage of one of your leagues. Players join each
                        tournament separately and their points carry forward into the league
                        table. Swiss or Arena only.
                      </HelpTip>
                    </span>
                  }
                  value={leagueId}
                  onChange={(e) => {
                    setLeagueId(e.target.value);
                    setStatus(null);
                  }}
                >
                  <option value="">Not part of a league</option>
                  {myLeagues.map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                      disabled={c.tournamentCount >= c.maxTournaments}
                    >
                      {c.name} ({c.tournamentCount}/{c.maxTournaments})
                    </option>
                  ))}
                </Select>
                {selectedLeague &&
                  !(LEAGUE_FORMATS as readonly string[]).includes(format) && (
                    <p className="text-xs text-red-400">
                      Knockout and round-robin can't be part of a league. Choose Swiss or
                      Arena as the format.
                    </p>
                  )}
              </section>
            )}

            {/* Players & schedule */}
            <section className="space-y-3 border-t border-base-300 pt-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
                        ? `Every entrant pays this to join. Held until the tournament ends, then the ${rakePercent}% platform fee is deducted and the rest is paid out to you as the organizer. Leave at 0 for a free tournament.`
                        : "Every entrant pays this to join. Held until the tournament ends, then the platform fee is deducted and the rest is paid out to you as the organizer. Leave at 0 for a free tournament."}
                    </HelpTip>
                  </span>
                }
                type="number"
                min={0}
                max={MAX_WAGER_TOKENS}
                value={regFeeInput}
                onChange={(e) => setRegFeeInput(e.target.value)}
              />

              <PrizePoolEditor
                key={prizePoolCurrency}
                value={prizeTiers}
                onChange={setPrizeTiers}
                currency={prizePoolCurrency}
              />
              <Switch
                checked={prizePoolCurrency === "naira"}
                onChange={(checked) =>
                  handlePrizeCurrencyChange(checked ? "naira" : "tokens")
                }
                label="Prize pool in naira (₦)"
                description="Real cash, disbursed manually by us over WhatsApp. "
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
              {!teamId && (
                <Switch
                  checked={isPublic}
                  onChange={setIsPublic}
                  label="List publicly"
                  description="Visible in the Open tournaments list for anyone to find."
                />
              )}
              {format === "arena" && (
                <Switch
                  checked={berserkAllowed}
                  onChange={setBerserkAllowed}
                  label="Allow berserk"
                  description="Half clock, no increment. A berserked win earns +1 point (3 instead of 2, or 5 on a streak) if the game lasts at least 5 moves in total. No bonus for a draw."
                />
              )}
              <Switch
                checked={chatEnabled}
                onChange={setChatEnabled}
                label="Enable tournament chat"
                description="A chat visible to players and spectators on the tournament page."
              />

              {!battleMode && (
              <Switch
                checked={organizerOnly}
                onChange={setOrganizerOnly}
                label="I'm organizing only"
                description="You run the tournament but don't play in it. You won't take a player slot or pay the registration fee."
              />
              )}

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
              {submitting
                ? "Creating…"
                : battleMode
                  ? "Create team battle"
                  : "Create tournament"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
