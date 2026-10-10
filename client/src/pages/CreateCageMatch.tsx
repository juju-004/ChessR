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
  Switch,
} from "../components/ui/index.js";
import { claimToast } from "../lib/toastClaims.js";

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

  // Off (the default) is the direct challenge flow: pick a player and
  // they get the invite live. On swaps that for a shareable invite link,
  // for someone who isn't online right now or isn't known to you yet, so
  // the opponent picker is hidden (there's nobody to pick).
  const [useLinkInvite, setUseLinkInvite] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriend, setSelectedFriend] = useState("");
  // A player picked from the Players page who isn't one of your friends
  // (anyone can be challenged now), so they have no entry in `friends` to
  // be found in. Carried over in the URL by the "Cage" button there.
  const [challengedPlayer, setChallengedPlayer] = useState<{
    id: string;
    username: string;
  } | null>(null);
  const [createdLinkId, setCreatedLinkId] = useState<string | null>(null);
  const [legs, setLegs] = useState<CageLegPlan[]>([]);
  const [winnerMode, setWinnerMode] = useState<CageWinnerMode>("total_score");
  const [targetWins, setTargetWins] = useState(3);
  const [wagerMode, setWagerMode] = useState<CageWagerMode>("winner_takes_all");
  const [wagerInput, setWagerInput] = useState("20");

  // ?challenge= (+ &name=) carries a player over from the Players page's
  // "Cage" button, so the opponent is picked automatically instead of making
  // them find the name again in the dropdown. A friend is matched against
  // the loaded friends list; anyone else is added to the dropdown from the
  // name in the URL.
  useEffect(() => {
    listFriends().then((res) => {
      setFriends(res.friends);
      const challengeId = searchParams.get("challenge");
      if (!challengeId) return;
      if (res.friends.some((f) => f.id === challengeId)) {
        setSelectedFriend(challengeId);
        return;
      }
      const name = searchParams.get("name");
      if (name) {
        setChallengedPlayer({ id: challengeId, username: name });
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
    const release0 = claimToast("cage:error");
    socket.on("cage:error", onError);
    socket.on("cage:link_created", onLinkCreated);
    return () => {
      socket.off("cage:sent", onSent);
      release0();
      socket.off("cage:error", onError);
      socket.off("cage:link_created", onLinkCreated);
    };
  }, [socket, navigate]);

  function handleCreate() {
    if (!socket) return;
    if (!useLinkInvite && !selectedFriend) {
      return setStatus({
        message: "Pick a player to challenge.",
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
    // 0 is a free match; anything else must clear the stake floor.
    if (wagerTokens !== 0 && wagerTokens < MIN_STAKE_TOKENS) {
      return setStatus({
        message: `Enter 0 for a free match, or a wager of at least ${MIN_STAKE_TOKENS} R.`,
        isError: true,
      });
    }

    setStatus(null);
    setSubmitting(true);
    const payload = {
      legs,
      winnerMode,
      targetWins: winnerMode === "first_to_n" ? targetWins : null,
      wagerMode: wagerTokens === 0 ? "none" : wagerMode,
      wagerTokens,
    };
    if (useLinkInvite) {
      socket.emit("cage:create_link", payload);
    } else {
      socket.emit("cage:send", { toUserId: selectedFriend, ...payload });
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
              {/* Opponent: a live challenge, or (toggle on) a shareable link */}
              <Switch
                checked={useLinkInvite}
                onChange={setUseLinkInvite}
                label="Use link invite"
                description="Get a link to send to anyone, they don't need to be online or a friend."
              />
              {!useLinkInvite && (
                <section className="space-y-3">
                  <Select
                    label="Opponent"
                    value={selectedFriend}
                    onChange={(e) => setSelectedFriend(e.target.value)}
                  >
                    <option value="">Select a player…</option>
                    {challengedPlayer &&
                      !friends.some((f) => f.id === challengedPlayer.id) && (
                        <option value={challengedPlayer.id}>
                          {challengedPlayer.username}
                        </option>
                      )}
                    {friends.map((f) => (
                      <option key={f.id} value={f.id} disabled={!f.online}>
                        {f.username} {f.online ? "" : "(offline)"}
                      </option>
                    ))}
                  </Select>
                </section>
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
                        across every game up front. Enter 0 for a free
                        match with nothing at stake.
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
                  min={0}
                  max={MAX_WAGER_TOKENS}
                  step={1}
                  value={wagerInput}
                  onChange={(e) => setWagerInput(e.target.value)}
                  hint={
                    Math.floor(Number(wagerInput) || 0) === 0
                      ? "Free match: no R Coins at stake."
                      : `Enter 0 for a free match. Minimum wager is ${MIN_STAKE_TOKENS} R.`
                  }
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
                  (!useLinkInvite && !selectedFriend) ||
                  legs.length < 2 ||
                  submitting
                }
                onClick={handleCreate}
              >
                {useLinkInvite ? (
                  <Link2 className="h-4 w-4" />
                ) : (
                  <Swords className="h-4 w-4" />
                )}
                {submitting
                  ? useLinkInvite
                    ? "Creating…"
                    : "Sending…"
                  : useLinkInvite
                    ? "Create invite link"
                    : "Send cage match invite"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </Page>
  );
}
