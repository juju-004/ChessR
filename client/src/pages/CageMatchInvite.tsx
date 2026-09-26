import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Swords } from "lucide-react";
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
  Card,
  CardContent,
  Avatar,
  Button,
  RCoin,
  Spinner,
} from "../components/ui/index.js";

const WINNER_MODE_LABEL: Record<CageWinnerMode, string> = {
  total_score: "Total score (win = 1, draw = 0.5)",
  most_categories: "Most categories won",
  first_to_n: "First to N wins",
};

const WAGER_MODE_LABEL: Record<CageWagerMode, string> = {
  none: "No wager",
  winner_takes_all: "Winner takes all",
  per_leg: "Per game",
  split_even: "Split evenly across games",
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
 *  CreateCageMatch.tsx's "Share a link" mode and cageMatchSocket.ts's
 *  cage:create_link/cage:link_lookup/cage:link_accept). Unlike the direct
 *  cage:send flow, this is reachable by anyone with the URL, not just a
 *  pre-chosen friend, so it has to look the invite up itself rather than
 *  already knowing what it's showing. */
export function CageMatchInvite() {
  const { linkId = "" } = useParams<{ linkId: string }>();
  const socket = useSocket();

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
    function onError(payload: { message: string }) {
      setAccepting(false);
      setError(payload.message);
    }
    s.on("connect", lookup);
    s.on("cage:link_info", onInfo);
    s.on("cage:error", onError);
    if (s.connected) lookup();
    return () => {
      s.off("connect", lookup);
      s.off("cage:link_info", onInfo);
      s.off("cage:error", onError);
    };
    // cage:accepted navigation is handled app-wide by GlobalListeners, this
    // page just needs to fire the request and let that redirect happen.
  }, [socket, linkId]);

  function handleAccept() {
    if (!socket) return;
    setAccepting(true);
    socket.emit("cage:link_accept", { linkId });
  }

  if (error) {
    return <PageError message={error} className="px-4" />;
  }
  if (!info) {
    return (
      <div className="flex justify-center pt-16">
        <Spinner className="text-base-content/40" />
      </div>
    );
  }

  return (
    <Page title="Cage match invite" back="/cage">
      <div className="mx-auto max-w-md space-y-4">
        <Card variant="solid">
          <CardContent className="space-y-4 text-center">
            <Avatar
              username={info.from.username}
              gradient={info.from.avatarGradient}
              size="lg"
              className="mx-auto"
            />
            <div>
              <p className="font-semibold text-base-content">
                {info.from.username} invited you to a cage match
              </p>
              <p className="text-sm text-base-content/60">
                {info.legs.length} games ·{" "}
                {WINNER_MODE_LABEL[info.winnerMode]}
                {info.winnerMode === "first_to_n" &&
                  info.targetWins &&
                  ` (first to ${info.targetWins})`}
              </p>
            </div>

            <div className="rounded-lg bg-base-200 p-3 text-left text-sm">
              <div className="flex flex-wrap gap-1.5">
                {info.legs.map((leg, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-base-300 px-2 py-0.5 text-xs text-base-content/70"
                  >
                    {CATEGORY_LABEL[legCategory(leg)]}{" "}
                    {formatLegTimeControl(leg)}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-base-content/60">
                {WAGER_MODE_LABEL[info.wagerMode]} ·{" "}
                <span className="font-medium text-base-content">
                  {info.wagerTokens} <RCoin size={11} className="inline align-[-1px]" />
                </span>
              </p>
            </div>

            {info.isOwnLink ? (
              <p className="text-sm text-base-content/50">
                This is your own invite link — share it with someone else to
                get them to accept it.
              </p>
            ) : (
              <Button fullWidth disabled={accepting} onClick={handleAccept}>
                <Swords className="h-4 w-4" />
                {accepting ? "Starting…" : "Accept & start"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
