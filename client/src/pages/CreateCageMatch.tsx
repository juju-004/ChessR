import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Swords } from "lucide-react";
import { listFriends, type Friend } from "../api/friends.js";
import {
  type CageLegPlan,
  type CageWinnerMode,
  type CageWagerMode,
} from "../api/cageMatches.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useRakePercent } from "../hooks/useRakePercent.js";
import { MAX_WAGER_TOKENS } from "../lib/limits.js";
import { HelpTip } from "../components/HelpTip.js";
import { CageGamePlanEditor } from "../components/cage/CageGamePlanEditor.js";
import {
  Page,
  Card,
  CardContent,
  Input,
  Select,
  Button,
  RCoin,
} from "../components/ui/index.js";

export function CreateCageMatch() {
  const socket = useSocket();
  const navigate = useNavigate();
  const rakePercent = useRakePercent();
  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriend, setSelectedFriend] = useState("");
  const [legs, setLegs] = useState<CageLegPlan[]>([]);
  const [winnerMode, setWinnerMode] = useState<CageWinnerMode>("total_score");
  const [targetWins, setTargetWins] = useState(3);
  const [wagerMode, setWagerMode] = useState<CageWagerMode>("winner_takes_all");
  const [wagerInput, setWagerInput] = useState("10");

  // ?challenge= carries a friend id over from the Players page's "Cage
  // match instead" button, so the opponent is picked automatically instead
  // of making them find the name again in the dropdown. Only resolvable
  // once `friends` has actually loaded (the id has to match someone in
  // that list).
  useEffect(() => {
    listFriends().then((res) => {
      setFriends(res.friends);
      const challengeId = searchParams.get("challenge");
      if (challengeId && res.friends.some((f) => f.id === challengeId)) {
        setSelectedFriend(challengeId);
      }
    });
  }, [searchParams]);

  useEffect(() => {
    if (!socket) return;
    function onSent() {
      navigate("/cage", {
        state: {
          status: {
            message: "Cage match invite sent. Waiting for a response…",
            isError: false,
          },
        },
      });
    }
    function onError(payload: { message: string }) {
      setSubmitting(false);
      setStatus({ message: payload.message, isError: true });
    }
    socket.on("cage:sent", onSent);
    socket.on("cage:error", onError);
    return () => {
      socket.off("cage:sent", onSent);
      socket.off("cage:error", onError);
    };
  }, [socket, navigate]);

  function handleCreate() {
    if (!socket) return;
    if (!selectedFriend) {
      return setStatus({
        message: "Pick a friend to challenge.",
        isError: true,
      });
    }
    if (legs.length < 2) {
      return setStatus({
        message: "Add at least 2 games to the match.",
        isError: true,
      });
    }
    if (winnerMode === "first_to_n" && (!targetWins || targetWins < 1)) {
      return setStatus({
        message: "Choose a target win count.",
        isError: true,
      });
    }
    const wagerTokens = Math.min(
      MAX_WAGER_TOKENS,
      Math.max(0, Math.floor(Number(wagerInput) || 0)),
    );
    if (wagerTokens <= 0) {
      return setStatus({
        message: "Enter a wager amount. Every cage match requires one.",
        isError: true,
      });
    }

    setStatus(null);
    setSubmitting(true);
    socket.emit("cage:send", {
      toUserId: selectedFriend,
      legs,
      winnerMode,
      targetWins: winnerMode === "first_to_n" ? targetWins : null,
      wagerMode,
      wagerTokens,
    });
  }

  return (
    <Page title="Start a cage match" back="/cage">
      <div className="mx-auto space-y-4">
        <Card variant="solid">
          <CardContent className="space-y-5">
            {/* Opponent */}
            <section className="space-y-3">
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
            </section>

            {/* Game plan */}
            <section className="border-t border-base-300 pt-4">
              <CageGamePlanEditor legs={legs} onChange={setLegs} />
            </section>

            {/* Rules */}
            <section className="space-y-3 border-t border-base-300 pt-4">
              <Select
                label={
                  <span className="inline-flex items-center gap-1">
                    How the winner is decided
                    <HelpTip>
                      Total score adds up 1 point per win and 0.5 per draw
                      across every game. Most categories won compares
                      bullet/blitz/rapid/classical as separate mini-matches.
                      First to N ends the match as soon as either side wins
                      enough games, even if some are left unplayed.
                    </HelpTip>
                  </span>
                }
                value={winnerMode}
                onChange={(e) =>
                  setWinnerMode(e.target.value as CageWinnerMode)
                }
              >
                <option value="total_score">Total score</option>
                <option value="most_categories">Most categories won</option>
                <option value="first_to_n">First to N wins</option>
              </Select>
              {winnerMode === "first_to_n" && (
                <Input
                  label="Wins needed"
                  type="number"
                  min={1}
                  max={30}
                  value={targetWins}
                  onChange={(e) => setTargetWins(Number(e.target.value))}
                />
              )}
            </section>

            {/* Wager */}
            <section className="space-y-3 border-t border-base-300 pt-4">
              <Select
                label={
                  <span className="inline-flex items-center gap-1">
                    Wager
                    <HelpTip>
                      Winner takes all stakes the full amount once for the whole
                      match. Per game stakes and settles the same amount as each
                      game finishes. Split evenly divides the total across every
                      game up front.
                      {rakePercent !== null &&
                        ` A ${rakePercent}% platform fee is deducted from the payout either way.`}
                    </HelpTip>
                  </span>
                }
                value={wagerMode}
                onChange={(e) => setWagerMode(e.target.value as CageWagerMode)}
              >
                <option value="winner_takes_all">Winner takes all</option>
                <option value="per_leg">Per game</option>
                <option value="split_even">Split evenly</option>
              </Select>
              <Input
                label={
                  <span className="inline-flex items-center gap-1">
                    {wagerMode === "per_leg" ? (
                      <>
                        <RCoin size={12} /> Coins per game
                      </>
                    ) : (
                      <>
                        Total <RCoin size={12} /> Coins for the whole match
                      </>
                    )}
                  </span>
                }
                type="number"
                min={1}
                max={MAX_WAGER_TOKENS}
                step={1}
                value={wagerInput}
                onChange={(e) => setWagerInput(e.target.value)}
              />
            </section>

            {status && (
              <p
                className={`text-sm ${status.isError ? "text-red-400" : "text-green-400"}`}
              >
                {status.message}
              </p>
            )}

            <Button
              fullWidth
              disabled={!selectedFriend || legs.length < 2 || submitting}
              onClick={handleCreate}
            >
              <Swords className="h-4 w-4" />
              {submitting ? "Sending…" : "Send cage match invite"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
