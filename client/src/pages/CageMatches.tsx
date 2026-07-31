import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUp, ArrowDown, X, Swords } from "lucide-react";
import { listFriends, type Friend } from "../api/friends.js";
import {
  listMyCageMatches,
  computeCageStandings,
  formatLegTimeControl,
  type CageMatch,
  type CageLegPlan,
  type CageWinnerMode,
  type CageWagerMode,
  type CageVariant,
} from "../api/cageMatches.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useAuth } from "../contexts/AuthContext.js";
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
} from "../components/ui/index.js";
import { formatRelativeTime } from "@/lib/utils.js";
import { cn } from "@/lib/cn.js";

const QUICK_ADD_PRESETS: {
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

function opponentOf(match: CageMatch, myId: string | undefined) {
  return match.player1._id === myId ? match.player2 : match.player1;
}

function matchOutcomeLabel(match: CageMatch, myId: string | undefined): string {
  if (match.status !== "finished") return "In progress";
  if (match.matchWinner === "draw") return "Drawn";
  const iAmP1 = match.player1._id === myId;
  const iWon =
    (match.matchWinner === "p1" && iAmP1) ||
    (match.matchWinner === "p2" && !iAmP1);
  return iWon ? "You won" : "You lost";
}

export function CageMatches() {
  const socket = useSocket();
  const { user } = useAuth();
  const myId = user?.id;
  const [friends, setFriends] = useState<Friend[]>([]);
  const [matches, setMatches] = useState<CageMatch[]>([]);

  const [selectedFriend, setSelectedFriend] = useState("");
  const [legs, setLegs] = useState<CageLegPlan[]>([]);
  const [quickPreset, setQuickPreset] = useState(0);
  const [quickVariant, setQuickVariant] = useState<CageVariant>("standard");
  const [quickCount, setQuickCount] = useState(5);
  const [winnerMode, setWinnerMode] = useState<CageWinnerMode>("total_score");
  const [targetWins, setTargetWins] = useState(3);
  const [wagerMode, setWagerMode] = useState<CageWagerMode>("none");
  const [wagerInput, setWagerInput] = useState("0");
  const [status, setStatus] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);

  const activeMatches = matches.filter((m) => m.status === "active");
  const finishedMatches = matches.filter((m) => m.status !== "active");

  const [page, setPage] = useState(1);
  const totalPages = Math.round(finishedMatches.length / 5);

  const refreshMatches = useCallback(() => {
    listMyCageMatches().then((res) => setMatches(res.matches));
  }, []);

  useEffect(() => {
    listFriends().then((res) => setFriends(res.friends));
    refreshMatches();
  }, [refreshMatches]);

  useEffect(() => {
    if (!socket) return;
    function onSent() {
      setStatus({
        message: "Cage match invite sent — waiting for a response…",
        isError: false,
      });
    }
    function onDeclined() {
      setStatus({
        message: "Your cage match invite was declined.",
        isError: true,
      });
    }
    function onAccepted() {
      setStatus({
        message: "Cage match started! Check your active matches below.",
        isError: false,
      });
      refreshMatches();
    }
    function onError(payload: { message: string }) {
      setStatus({ message: payload.message, isError: true });
    }
    socket.on("cage:sent", onSent);
    socket.on("cage:declined", onDeclined);
    socket.on("cage:accepted", onAccepted);
    socket.on("cage:error", onError);
    socket.on("cage:next_leg", refreshMatches);
    socket.on("cage:match_over", refreshMatches);
    return () => {
      socket.off("cage:sent", onSent);
      socket.off("cage:declined", onDeclined);
      socket.off("cage:accepted", onAccepted);
      socket.off("cage:error", onError);
      socket.off("cage:next_leg", refreshMatches);
      socket.off("cage:match_over", refreshMatches);
    };
  }, [socket, refreshMatches]);

  function addQuickLegs() {
    const preset = QUICK_ADD_PRESETS[quickPreset];
    const additions: CageLegPlan[] = Array.from(
      { length: Math.max(1, quickCount) },
      () => ({
        variant: quickVariant,
        baseMinutes: preset.baseMinutes,
        incrementSeconds: preset.incrementSeconds,
      }),
    );
    setLegs((prev) => [...prev, ...additions]);
  }

  function removeLeg(index: number) {
    setLegs((prev) => prev.filter((_, i) => i !== index));
  }

  function moveLeg(index: number, dir: -1 | 1) {
    setLegs((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function handleSend() {
    if (!socket) return;
    if (!selectedFriend)
      return setStatus({
        message: "Pick a friend to challenge.",
        isError: true,
      });
    if (legs.length < 2)
      return setStatus({
        message: "Add at least 2 legs to the match.",
        isError: true,
      });
    if (winnerMode === "first_to_n" && (!targetWins || targetWins < 1)) {
      return setStatus({
        message: "Choose a target win count.",
        isError: true,
      });
    }
    const wagerTokens = Math.max(0, Math.floor(Number(wagerInput) || 0));
    if (wagerMode !== "none" && wagerTokens <= 0) {
      return setStatus({
        message: 'Enter a wager amount, or set wager to "No wager".',
        isError: true,
      });
    }

    socket.emit("cage:send", {
      toUserId: selectedFriend,
      legs,
      winnerMode,
      targetWins: winnerMode === "first_to_n" ? targetWins : null,
      wagerMode,
      wagerTokens,
    });
  }

  console.log(finishedMatches);

  return (
    <Page
      title="Cage matches"
      description="Challenge a friend to an ordered series of games."
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
            <CardTitle>Start a cage match</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-base-content/60">
              Mix bullet, blitz, rapid, and Chess960 legs however you like, then
              optionally back it with a wager.
            </p>

            <Select
              label="Opponent"
              value={selectedFriend}
              onChange={(e) => setSelectedFriend(e.target.value)}
            >
              <option value="">Select a friend…</option>
              {friends.map((f) => (
                <option key={f.id} value={f.id} disabled={!f.online}>
                  {f.username} {f.online ? "" : "(offline)"}
                </option>
              ))}
            </Select>

            <div className="rounded-xl border border-base-300 bg-base-100/60 p-3">
              <h3 className="mb-2 text-sm font-semibold text-base-content">
                Leg plan ({legs.length} legs)
              </h3>

              {legs.length === 0 && (
                <p className="mb-2 text-sm text-base-content/50">
                  No legs yet — add some below.
                </p>
              )}
              {legs.length > 0 && (
                <ol className="mb-3 max-h-56 space-y-1 overflow-y-auto pr-1">
                  {legs.map((leg, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between rounded-lg bg-base-200 px-2.5 py-1.5 text-sm text-base-content"
                    >
                      <span>
                        <span className="mr-2 text-base-content/40">
                          #{i + 1}
                        </span>
                        {formatLegTimeControl(leg)}
                      </span>
                      <span className="flex items-center gap-1">
                        <button
                          onClick={() => moveLeg(i, -1)}
                          disabled={i === 0}
                          aria-label="Move up"
                          className="rounded-md p-1 text-base-content/60 hover:bg-base-300 disabled:opacity-30"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => moveLeg(i, 1)}
                          disabled={i === legs.length - 1}
                          aria-label="Move down"
                          className="rounded-md p-1 text-base-content/60 hover:bg-base-300 disabled:opacity-30"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => removeLeg(i)}
                          aria-label="Remove leg"
                          className="rounded-md p-1 text-red-400 hover:bg-red-900/30"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-base-300 pt-3">
                <div className="w-40">
                  <Select
                    value={quickPreset}
                    onChange={(e) => setQuickPreset(Number(e.target.value))}
                  >
                    {QUICK_ADD_PRESETS.map((p, i) => (
                      <option key={p.label} value={i}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-32">
                  <Select
                    value={quickVariant}
                    onChange={(e) =>
                      setQuickVariant(e.target.value as CageVariant)
                    }
                  >
                    <option value="standard">Standard</option>
                    <option value="chess960">Chess960</option>
                  </Select>
                </div>
                <div className="w-16">
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={quickCount}
                    onChange={(e) => setQuickCount(Number(e.target.value))}
                  />
                </div>
                <Button size="md" onClick={addQuickLegs}>
                  Add legs
                </Button>
              </div>
            </div>

            <Select
              label="How the winner is decided"
              value={winnerMode}
              onChange={(e) => setWinnerMode(e.target.value as CageWinnerMode)}
            >
              <option value="total_score">
                Total score (win = 1, draw = 0.5)
              </option>
              <option value="most_categories">
                Most categories won (bullet/blitz/rapid/classical)
              </option>
              <option value="first_to_n">First to N wins</option>
            </Select>
            {winnerMode === "first_to_n" && (
              <Input
                type="number"
                min={1}
                max={30}
                value={targetWins}
                onChange={(e) => setTargetWins(Number(e.target.value))}
                placeholder="Wins needed"
              />
            )}

            <Select
              label="Wager"
              value={wagerMode}
              onChange={(e) => setWagerMode(e.target.value as CageWagerMode)}
            >
              <option value="none">No wager</option>
              <option value="winner_takes_all">
                Winner takes all — one stake for the whole match
              </option>
              <option value="per_leg">
                Per leg — staked and settled as each leg finishes
              </option>
              <option value="split_even">
                Split evenly — total stake divided across all legs
              </option>
            </Select>
            {wagerMode !== "none" && (
              <Input
                type="number"
                min={1}
                step={1}
                value={wagerInput}
                onChange={(e) => setWagerInput(e.target.value)}
                placeholder={
                  wagerMode === "per_leg"
                    ? "R tokens per leg"
                    : "Total R tokens for the whole match"
                }
              />
            )}

            <Button
              fullWidth
              disabled={!selectedFriend || legs.length < 2}
              onClick={handleSend}
            >
              <Swords className="h-4 w-4" /> Send cage match invite
            </Button>
          </CardContent>
        </Card>

        <Card variant="solid">
          <CardHeader>
            <CardTitle>Active cage matches</CardTitle>
          </CardHeader>
          <CardContent>
            {activeMatches.length === 0 && (
              <p className="text-sm text-base-content/50">None right now.</p>
            )}
            <div className="space-y-2">
              {activeMatches.map((m) => {
                const opp = opponentOf(m, myId);
                const standings = computeCageStandings(m);
                const iAmP1 = m.player1._id === myId;
                const myScore = iAmP1 ? standings.p1Score : standings.p2Score;
                const oppScore = iAmP1 ? standings.p2Score : standings.p1Score;
                return (
                  <Link
                    key={m._id}
                    to={`/cage/${m.matchCode}`}
                    className="flex items-center justify-between rounded-xl border border-base-300 bg-base-100/60 px-3 py-2.5 transition-colors hover:border-(--primary)/40"
                  >
                    <span className="text-sm text-base-content">
                      vs {opp.username} · leg {m.currentLegIndex + 1}/
                      {m.legs.length}
                    </span>
                    <span className="flex items-center gap-2 text-sm text-base-content/60">
                      {myScore}–{oppScore}
                      {m.wagerMode !== "none" && (
                        <Badge variant="warning">{m.wagerTokens} R</Badge>
                      )}
                    </span>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card variant="solid">
          <CardHeader>
            <CardTitle>Match history</CardTitle>
          </CardHeader>
          <CardContent>
            {finishedMatches.length === 0 && (
              <p className="text-sm text-base-content/50">
                No finished cage matches yet.
              </p>
            )}
            <div className="space-y-2">
              {finishedMatches.slice((page - 1) * 5, page * 5).map((m) => {
                const opp = opponentOf(m, myId);
                const outcome = matchOutcomeLabel(m, myId);

                return (
                  <Link
                    key={m._id}
                    to={`/cage/${m.matchCode}`}
                    className="flex items-center justify-between rounded-xl border border-base-300 bg-base-100/60 px-3 py-2.5 transition-colors hover:border-(--primary)/40"
                  >
                    <span className="text-sm text-base-content">
                      You <span className="text-base-content/60">vs</span>{" "}
                      {opp.username} .
                      <span className="text-base-content/60 text-xs">
                        {formatRelativeTime(m.createdAt)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "text-sm text-base-content/60",
                        outcome === "You won" && "text-green-600",
                        outcome === "You lost" && "text-red-500",
                      )}
                    >
                      {outcome}
                    </span>
                  </Link>
                );
              })}
              {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-center gap-3 text-sm">
                  <Button
                    variant="glass"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Prev
                  </Button>
                  <span className="text-base-content/60">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="glass"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
