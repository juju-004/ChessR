import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Swords, Trophy, Coins } from "lucide-react";
import {
  formatLegTimeControl,
  legCategory,
  CATEGORY_LABEL,
  type CageLegPlan,
  type CageWinnerMode,
  type CageWagerMode,
} from "../api/cageMatches.js";
import { useSocket } from "../contexts/SocketContext.js";
import { PageError } from "../components/PageError.js";
import {
  Page,
  Button,
  RCoin,
  Spinner,
  CategoryIcon,
} from "../components/ui/index.js";
import { InviteCard, InviteTerm } from "../components/InviteLanding.js";
import { claimToast } from "../lib/toastClaims.js";

const WINNER_MODE_LABEL: Record<CageWinnerMode, string> = {
  total_score: "Highest total score",
  most_categories: "Most categories won",
  first_to_n: "First to N wins",
};

const WINNER_MODE_DETAIL: Record<CageWinnerMode, string> = {
  total_score: "A win is 1 point, a draw is half",
  most_categories: "Win more of bullet, blitz, rapid and classical",
  first_to_n: "Ends as soon as someone gets there",
};

const WAGER_MODE_DETAIL: Record<CageWagerMode, string> = {
  none: "",
  winner_takes_all: "Winner takes the whole pot",
  per_leg: "Staked on every game",
  split_even: "Total at risk, split evenly across the games",
};

interface LinkInfo {
  linkId: string;
  from: { id: string; username: string; avatarGradient: string | null };
  legs: CageLegPlan[];
  winnerMode: CageWinnerMode;
  targetWins: number | null;
  wagerMode: CageWagerMode;
  wagerTokens: number;
  isOwnLink: boolean;
}

/** Landing page for a shareable cage match invite link (see
 *  CreateCageMatch.tsx's "Use link invite" option and cageMatchSocket.ts's
 *  cage:create_link/cage:link_lookup/cage:link_accept). Unlike the direct
 *  cage:send flow, this is reachable by anyone with the URL, not just a
 *  pre-chosen friend, so it has to look the invite up itself rather than
 *  already knowing what it's showing. */
export function CageMatchInvite() {
  const { linkId = "" } = useParams<{ linkId: string }>();
  const socket = useSocket();
  const navigate = useNavigate();

  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!socket || !linkId) return;
    const s = socket;

    function lookup() {
      s.emit("cage:link_lookup", { linkId });
    }
    function onInfo(payload: LinkInfo) {
      if (payload.linkId !== linkId) return;
      setInfo(payload);
      setError("");
    }
    // The link was already accepted, so it's now a match. Go to the game
    // being played, or the last one played if it's over (the match page if
    // it never got as far as a game), instead of showing an error.
    function onResolved(payload: {
      linkId: string;
      matchCode: string;
      gameCode: string | null;
    }) {
      if (payload.linkId !== linkId) return;
      navigate(
        payload.gameCode
          ? `/game/${payload.gameCode}`
          : `/cage/${payload.matchCode}`,
        { replace: true },
      );
    }
    function onError(payload: { message: string }) {
      setAccepting(false);
      setError(payload.message);
    }
    s.on("connect", lookup);
    s.on("cage:link_info", onInfo);
    s.on("cage:link_resolved", onResolved);
    const release0 = claimToast("cage:error");
    s.on("cage:error", onError);
    if (s.connected) lookup();
    return () => {
      s.off("connect", lookup);
      s.off("cage:link_info", onInfo);
      s.off("cage:link_resolved", onResolved);
      release0();
      s.off("cage:error", onError);
    };
    // cage:accepted navigation is handled app-wide by GlobalListeners, this
    // page just needs to fire the request and let that redirect happen.
  }, [socket, linkId, navigate]);

  function handleAccept() {
    if (!socket) return;
    setError("");
    setAccepting(true);
    socket.emit("cage:link_accept", { linkId });
  }

  // Only a failed LOOKUP (expired / invalid link) is a dead end. A failed
  // ACCEPT (creator momentarily offline, not enough R, game limit...) used to
  // replace the whole page with this error too, even though the server puts
  // the link back for exactly that case, so the link looked broken with no way
  // to try again. Once the invite has loaded, errors show inline instead.
  if (error && !info) {
    return <PageError message={error} className="px-4" />;
  }
  if (!info) {
    return (
      <div className="flex justify-center pt-16">
        <Spinner className="text-base-content/40" />
      </div>
    );
  }

  const wagered = info.wagerMode !== "none" && info.wagerTokens > 0;

  return (
    <Page title="Cage match invite" back="/cage">
      <div className="mx-auto max-w-md">
        <InviteCard
          from={info.from}
          headline="invited you to a cage match"
          subline={`${info.legs.length} ${info.legs.length === 1 ? "game" : "games"} against the same opponent, played back to back`}
          footer={
            info.isOwnLink ? (
              <p className="text-sm text-base-content/60">
                This is your own invite link. Send it to someone else so they
                can accept it.
              </p>
            ) : (
              <>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <Button fullWidth disabled={accepting} onClick={handleAccept}>
                  <Swords className="h-4 w-4" />
                  {accepting ? "Starting…" : "Accept and start"}
                </Button>
              </>
            )
          }
        >
          <ol className="border-b border-base-content/10 px-5 py-3">
            {info.legs.map((leg, i) => (
              <li
                key={i}
                className="flex items-center gap-3 py-1.5 text-sm"
              >
                <span className="w-5 text-right text-xs tabular-nums text-base-content/40">
                  {i + 1}
                </span>
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-base-300 text-base-content/70">
                  <CategoryIcon category={legCategory(leg)} size={14} />
                </span>
                <span className="font-semibold text-base-content">
                  {formatLegTimeControl(leg)}
                </span>
                <span className="text-base-content/50">
                  {CATEGORY_LABEL[legCategory(leg)]}
                </span>
              </li>
            ))}
          </ol>
          <InviteTerm
            icon={<Trophy className="h-4 w-4" />}
            label="How it's decided"
            detail={WINNER_MODE_DETAIL[info.winnerMode]}
          >
            {WINNER_MODE_LABEL[info.winnerMode]}
            {info.winnerMode === "first_to_n" &&
              info.targetWins &&
              ` (${info.targetWins})`}
          </InviteTerm>
          {wagered ? (
            <InviteTerm
              icon={<Coins className="h-4 w-4" />}
              label="Stake"
              detail={WAGER_MODE_DETAIL[info.wagerMode]}
              emphasis
            >
              <span className="inline-flex items-center gap-1">
                {info.wagerTokens} <RCoin size={13} />
              </span>
            </InviteTerm>
          ) : (
            <InviteTerm
              icon={<Coins className="h-4 w-4" />}
              label="Stake"
              detail="Nothing is taken from your balance"
            >
              Free match
            </InviteTerm>
          )}
        </InviteCard>
      </div>
    </Page>
  );
}
