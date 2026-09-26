import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Swords, Link2, Share2 } from "lucide-react";
import { listFriends, type Friend } from "../api/friends.js";
import {
  type CageLegPlan,
  type CageWinnerMode,
  type CageWagerMode,
} from "../api/cageMatches.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useRakePercent } from "../hooks/useRakePercent.js";
import { MAX_WAGER_TOKENS, MIN_STAKE_TOKENS } from "../lib/limits.js";
import { HelpTip } from "../components/HelpTip.js";
import { TestModeBanner } from "../components/TestModeBanner.js";
import { CageGamePlanEditor } from "../components/cage/CageGamePlanEditor.js";
import { copyToClipboard } from "@/lib/utils.js";
import {
  Page,
  Card,
  CardContent,
  Input,
  Select,
  Button,
  RCoin,
  Tabs,
} from "../components/ui/index.js";

const CLIENT_URL = import.meta.env.VITE_CLIENT_URL ?? "http://localhost:5173";

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

  // "friend" mirrors the original direct-challenge flow below; "link"
  // is the new shareable-invite alternative (David: "cage matches are
  // challenge only, make it possible through links too") for inviting
  // someone who isn't online right now, or isn't added as a friend yet.
  const [mode, setMode] = useState<"friend" | "link">("friend");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriend, setSelectedFriend] = useState("");
  const [createdLinkId, setCreatedLinkId] = useState<string | null>(null);
  const [legs, setLegs] = useState<CageLegPlan[]>([]);
  const [winnerMode, setWinnerMode] = useState<CageWinnerMode>("total_score");
  const [targetWins, setTargetWins] = useState(3);
  const [wagerMode, setWagerMode] = useState<CageWagerMode>("winner_takes_all");
  const [wagerInput, setWagerInput] = useState("20");

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
    function onLinkCreated(payload: { linkId: string }) {
      setSubmitting(false);
      setCreatedLinkId(payload.linkId);
    }
    socket.on("cage:sent", onSent);
    socket.on("cage:error", onError);
    socket.on("cage:link_created", onLinkCreated);
    return () => {
      socket.off("cage:sent", onSent);
      socket.off("cage:error", onError);
      socket.off("cage:link_created", onLinkCreated);
    };
  }, [socket, navigate]);

  function handleCreate() {
    if (!socket) return;
    if (mode === "friend" && !selectedFriend) {
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
    if (wagerTokens < MIN_STAKE_TOKENS) {
      return setStatus({
        message: `Enter a wager of at least ${MIN_STAKE_TOKENS} R.`,
        isError: true,
      });
    }

    setStatus(null);
    setSubmitting(true);
    const payload = {
      legs,
      winnerMode,
      targetWins: winnerMode === "first_to_n" ? targetWins : null,
      wagerMode,
      wagerTokens,
    };
    if (mode === "friend") {
      socket.emit("cage:send", { toUserId: selectedFriend, ...payload });
    } else {
      socket.emit("cage:create_link", payload);
    }
  }

  const inviteLink = createdLinkId
    ? `${CLIENT_URL}/cage/invite/${createdLinkId}`
    : null;

  async function handleShareLink() {
    if (!inviteLink) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Cage match invite on Chessr",
          url: inviteLink,
        });
        return;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    copyToClipboard(inviteLink);
    setStatus({ message: "Invite link copied", isError: false });
  }

  return (
    <Page title="Start a cage match" back="/cage">
      <div className="mx-auto space-y-4">
        <TestModeBanner />
        {inviteLink ? (
          <Card variant="solid">
            <CardContent className="space-y-4 text-center">
              <Link2 className="mx-auto h-8 w-8 text-(--primary)" />
              <div>
                <p className="font-semibold text-base-content">
                  Invite link ready
                </p>
                <p className="text-sm text-base-content/60">
                  Send this to whoever you want to play — they don't need to be
                  a friend or online yet. It expires in 24 hours or once someone
                  accepts it.
                </p>
              </div>
              <div className="rounded-lg bg-base-200 px-3 py-2 text-left text-xs break-all text-base-content/70">
                {inviteLink}
              </div>
              {status && (
                <p
                  className={`text-sm ${status.isError ? "text-red-400" : "text-green-400"}`}
                >
                  {status.message}
                </p>
              )}
              <div className="flex gap-2">
                <Button fullWidth onClick={handleShareLink}>
                  <Share2 className="h-4 w-4" /> Share link
                </Button>
                <Button
                  variant="glass"
                  fullWidth
                  onClick={() => {
                    setCreatedLinkId(null);
                    setStatus(null);
                  }}
                >
                  Create another
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card variant="solid">
            <CardContent className="space-y-5">
              {/* Mode */}
              <Tabs
                items={[
                  { value: "friend", label: "Challenge a friend" },
                  { value: "link", label: "Share a link" },
                ]}
                value={mode}
                onChange={(v) => setMode(v as "friend" | "link")}
              />

              {/* Opponent */}
              {mode === "friend" ? (
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
              ) : (
                <p className="text-sm text-base-content/60"></p>
              )}

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
                        Winner takes all stakes the full amount once for the
                        whole match. Per game stakes and settles the same amount
                        as each game finishes. Split evenly divides the total
                        across every game up front.
                        {rakePercent !== null &&
                          ` A ${rakePercent}% platform fee is deducted from the payout either way.`}
                      </HelpTip>
                    </span>
                  }
                  value={wagerMode}
                  onChange={(e) =>
                    setWagerMode(e.target.value as CageWagerMode)
                  }
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
                  min={MIN_STAKE_TOKENS}
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
                disabled={
                  (mode === "friend" && !selectedFriend) ||
                  legs.length < 2 ||
                  submitting
                }
                onClick={handleCreate}
              >
                {mode === "friend" ? (
                  <Swords className="h-4 w-4" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                {submitting
                  ? mode === "friend"
                    ? "Sending…"
                    : "Creating…"
                  : mode === "friend"
                    ? "Send cage match invite"
                    : "Create invite link"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </Page>
  );
}
