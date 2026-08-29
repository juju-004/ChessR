import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSocket } from "../contexts/SocketContext.js";
import { Card, Avatar, Tooltip } from "./ui/index.js";
import {
  getCageMatchByCode,
  computeCageStandings,
  type CageMatch,
  type CageLeg,
} from "../api/cageMatches.js";

interface Props {
  cageMatchId: string;
  legIndex: number;
}

// Mirrors the LEG_STATUS_DOT palette on the full cage match page so the two
// scoreboards read as the same UI element.
const PIP_COLOR: Record<CageLeg["status"], string> = {
  finished: "bg-green-600",
  active: "bg-blue-500",
  paused: "bg-amber-500",
  pending: "bg-base-300",
  skipped: "bg-base-300",
};

function pipTitle(leg: CageLeg, p1Name: string, p2Name: string): string {
  if (leg.status === "active") return `Game ${leg.index + 1}: in progress`;
  if (leg.status === "paused") return `Game ${leg.index + 1}: paused`;
  if (leg.status === "skipped") return `Game ${leg.index + 1}: skipped`;
  if (leg.status === "pending") return `Game ${leg.index + 1}: not yet played`;
  if (leg.result === "draw") return `Game ${leg.index + 1}: draw`;
  if (leg.result === "p1") return `Game ${leg.index + 1}: ${p1Name} won`;
  if (leg.result === "p2") return `Game ${leg.index + 1}: ${p2Name} won`;
  return `Game ${leg.index + 1}`;
}

/** A compact "where are we in this series" scoreboard shown on a leg's game
 *  page, for players AND spectators who land on a leg midway through a cage
 *  match and need the score and remaining-games context at a glance, without
 *  clicking through to the full match page. */
export function CageMatchScoreboard({ cageMatchId, legIndex }: Props) {
  const socket = useSocket();
  const [match, setMatch] = useState<CageMatch | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCageMatchByCode(cageMatchId)
      .then(({ match }) => {
        if (!cancelled) setMatch(match);
      })
      .catch(() => {
        /* Scoreboard is a nice-to-have, a fetch failure just means we
           don't show it, no need to surface an error on the game page. */
      });
    return () => {
      cancelled = true;
    };
  }, [cageMatchId]);

  useEffect(() => {
    if (!socket) return;
    function refresh(payload: { matchId: string }) {
      if (payload.matchId !== cageMatchId) return;
      getCageMatchByCode(cageMatchId)
        .then(({ match }) => setMatch(match))
        .catch(() => {});
    }
    socket.on("cage:next_leg", refresh);
    socket.on("cage:match_over", refresh);
    socket.on("cage:paused", refresh);
    socket.on("cage:resumed", refresh);
    return () => {
      socket.off("cage:next_leg", refresh);
      socket.off("cage:match_over", refresh);
      socket.off("cage:paused", refresh);
      socket.off("cage:resumed", refresh);
    };
  }, [socket, cageMatchId]);

  if (!match) return null;

  const standings = computeCageStandings(match);
  const totalLegs = match.legs.length;
  const legsLeft = match.legs.filter(
    (l) =>
      l.status === "pending" || l.status === "active" || l.status === "paused",
  ).length;
  const p1Name = match.player1.username;
  const p2Name = match.player2.username;

  return (
    <Card variant="solid" className="shrink-0 mx-3 md:mx-0">
      <div className="flex items-center justify-between gap-2 rounded-lg bg-base-100/60 px-3 py-2">
        <Tooltip content={p1Name}>
          <div className="flex items-center gap-1.5">
            <Avatar
              username={p1Name}
              gradient={match.player1.avatarGradient}
              size="sm"
              className={standings.p1Score < standings.p2Score ? "opacity-50" : ""}
            />
            <span
              className={`text-sm font-semibold ${
                standings.p1Score >= standings.p2Score
                  ? "text-base-content"
                  : "text-base-content/50"
              }`}
            >
              {standings.p1Score}
            </span>
          </div>
        </Tooltip>
        <Link
          to={`/cage/${match.matchCode}`}
          className="text-xs font-medium text-(--primary) hover:brightness-110"
        >
          Full match →
        </Link>
        <Tooltip content={p2Name}>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-sm font-semibold ${
                standings.p2Score >= standings.p1Score
                  ? "text-base-content"
                  : "text-base-content/50"
              }`}
            >
              {standings.p2Score}
            </span>
            <Avatar
              username={p2Name}
              gradient={match.player2.avatarGradient}
              size="sm"
              className={standings.p2Score < standings.p1Score ? "opacity-50" : ""}
            />
          </div>
        </Tooltip>
      </div>

      <div className="mt-2 flex items-center w-4/5 mx-auto gap-1">
        {match.legs.map((leg) => {
          const pip = (
            <span
              title={pipTitle(leg, p1Name, p2Name)}
              className={`block h-1.5 w-full rounded-full ${PIP_COLOR[leg.status]} ${
                leg.index === legIndex
                  ? "ring-2 ring-(--primary) ring-offset-1 ring-offset-base-200"
                  : ""
              } ${leg.joinCode ? "cursor-pointer hover:brightness-125" : ""}`}
            />
          );
          // Only legs that have actually started have a game to jump to
          // (pending/skipped legs have no gameId/joinCode yet), those pips
          // stay inert, just a status dot.
          return (
            <span key={leg.index} className="flex-1">
              {leg.joinCode ? (
                <Link
                  to={`/game/${leg.joinCode}`}
                  aria-label={pipTitle(leg, p1Name, p2Name)}
                  className="block w-full"
                >
                  {pip}
                </Link>
              ) : (
                pip
              )}
            </span>
          );
        })}
      </div>

      <div className="mt-1.5 flex items-center justify-between text-xs text-base-content/50">
        <span>
          Game {legIndex + 1} of {totalLegs}
        </span>
        <span>{legsLeft} to play</span>
      </div>
    </Card>
  );
}
