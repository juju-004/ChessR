import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useSocket } from "../contexts/SocketContext.js";
import { useNotify } from "../contexts/NotificationContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { getCageMatchByCode, type CageMatch } from "../api/cageMatches.js";
import { CageMatchOverModal } from "./CageMatchOverModal.js";

/**
 * Cross-page real-time notifications: incoming friend challenges and rematch
 * offers need to reach the user no matter what page they're currently on, so
 * these listeners are wired up once here rather than inside individual pages.
 */
export function GlobalListeners() {
  const socket = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const { notify } = useNotify();
  const { user } = useAuth();
  const [cageMatchOver, setCageMatchOver] = useState<CageMatch | null>(null);

  // Read inside the socket handler below instead of putting location.pathname
  // in that effect's dependency array, this way a page navigation doesn't
  // tear down and re-subscribe the whole pile of socket listeners, it just
  // keeps this ref current for whenever a tournament:pairing_ready event
  // actually arrives.
  const pathRef = useRef(location.pathname);
  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!socket) return;

    function onChallengeReceived(payload: {
      challengeId: string;
      from: { id: string; username: string };
      timeControl: { baseMinutes: number | null; incrementSeconds: number };
      wagerTokens?: number;
    }) {
      if (!socket) return;

      const tc =
        payload.timeControl.baseMinutes === null
          ? "Unlimited"
          : `${payload.timeControl.baseMinutes}+${payload.timeControl.incrementSeconds}`;
      const wagerNote = payload.wagerTokens ? `, ${payload.wagerTokens} R wager` : "";
      notify(
        `${payload.from.username} challenged you to a game (${tc}${wagerNote}).`,
        [
          {
            label: "Accept",
            onClick: () =>
              socket.emit("challenge:respond", {
                challengeId: payload.challengeId,
                accept: true,
              }),
          },
          {
            label: "Decline",
            variant: "secondary",
            onClick: () =>
              socket.emit("challenge:respond", {
                challengeId: payload.challengeId,
                accept: false,
              }),
          },
        ],
        60_000,
        // Same sender challenging again (e.g. re-sending after the first one
        // scrolled past) updates this one toast instead of stacking another.
        `challenge:${payload.from.id}`,
      );
    }

    function onChallengeAccepted(payload: { joinCode: string }) {
      navigate(`/game/${payload.joinCode}`);
    }

    function onChallengeDeclined() {
      notify("Your challenge was declined.", [], 4000);
    }

    function onChallengeCancelled() {
      notify("That challenge was cancelled.", [], 4000);
    }

    function onChallengeError(payload: { message: string }) {
      notify(payload.message, [], 6000);
    }

    function onRematchOffered(payload: { gameId: string }) {
      if (!socket) return;
      notify(
        "Your opponent wants a rematch.",
        [
          {
            label: "Accept",
            onClick: () =>
              socket.emit("game:rematch_respond", {
                gameId: payload.gameId,
                accept: true,
              }),
          },
          {
            label: "Decline",
            variant: "secondary",
            onClick: () =>
              socket.emit("game:rematch_respond", {
                gameId: payload.gameId,
                accept: false,
              }),
          },
        ],
        30_000,
      );
    }

    function onRematchAccepted(payload: { joinCode: string }) {
      navigate(`/game/${payload.joinCode}`);
    }

    function onRematchStarted(payload: { joinCode: string }) {
      // Only players get game:rematch_accepted above (it's targeted at
      // their user room), this one's broadcast to the finished game's
      // spectatorRoom, so it only ever reaches sockets still actually
      // sitting on that game's page, see game:leave in gameSocket.ts for
      // the room-membership half of that guarantee.
      navigate(`/game/${payload.joinCode}`);
    }

    function onRematchDeclined() {
      notify("Your rematch offer was declined.", [], 4000);
    }

    function onCageReceived(payload: {
      inviteId: string;
      from: { id: string; username: string };
      legs: { baseMinutes: number | null; incrementSeconds: number; variant: string }[];
      wagerMode: string;
      wagerTokens?: number;
    }) {
      if (!socket) return;
      const wagerNote =
        payload.wagerMode !== "none" && payload.wagerTokens
          ? `, ${payload.wagerTokens} R wager`
          : "";
      notify(
        `${payload.from.username} challenged you to a ${payload.legs.length}-game cage match${wagerNote}.`,
        [
          {
            label: "Accept",
            onClick: () =>
              socket.emit("cage:respond", { inviteId: payload.inviteId, accept: true }),
          },
          {
            label: "Decline",
            variant: "secondary",
            onClick: () =>
              socket.emit("cage:respond", { inviteId: payload.inviteId, accept: false }),
          },
        ],
        60_000,
        `cage:${payload.from.id}`,
      );
    }

    function onCageAccepted(payload: { firstLeg: { joinCode: string } }) {
      navigate(`/game/${payload.firstLeg.joinCode}`);
    }

    function onCageDeclined() {
      notify("Your cage match invite was declined.", [], 4000);
    }

    function onCageCancelled() {
      notify("That cage match invite was cancelled.", [], 4000);
    }

    function onCageError(payload: { message: string }) {
      notify(payload.message, [], 6000);
    }

    function onCageNextLeg(payload: { nextLeg?: { joinCode: string } }) {
      if (!payload.nextLeg) return;
      const joinCode = payload.nextLeg.joinCode;
      notify(
        "Your cage match's next game is starting.",
        [{ label: "Play it now", onClick: () => navigate(`/game/${joinCode}`) }],
        20_000,
      );
    }

    function onCageNextLegSpectator(payload: { joinCode: string }) {
      // Broadcast to the finished leg's spectatorRoom only, so, like
      // game:rematch_started, this only ever reaches sockets still
      // actually watching that leg (see game:leave in gameSocket.ts).
      navigate(`/game/${payload.joinCode}`);
    }

    function onCageMatchOver(payload: { matchCode: string }) {
      getCageMatchByCode(payload.matchCode)
        .then(({ match }) => setCageMatchOver(match))
        .catch(() => {
          /* If the fetch fails, the match page itself is still reachable
             directly, no popup is better than a broken one. */
        });
    }

    function onPauseRequested(payload: { matchId: string; matchCode: string }) {
      if (!socket) return;
      notify(
        "Your opponent wants to pause the current game before either of you has moved.",
        [
          {
            label: "Allow pause",
            onClick: () => socket.emit("cage:pause_respond", { matchId: payload.matchId, accept: true }),
          },
          {
            label: "Decline",
            variant: "secondary",
            onClick: () => socket.emit("cage:pause_respond", { matchId: payload.matchId, accept: false }),
          },
        ],
        60_000,
      );
    }

    function onPauseDeclined() {
      notify("Your pause request was declined.", [], 4000);
    }

    function onResumeRequested(payload: { matchId: string; matchCode: string }) {
      if (!socket) return;
      notify(
        "Your opponent wants to resume the paused game.",
        [
          {
            label: "Resume",
            onClick: () => socket.emit("cage:resume_respond", { matchId: payload.matchId, accept: true }),
          },
          {
            label: "Not yet",
            variant: "secondary",
            onClick: () => socket.emit("cage:resume_respond", { matchId: payload.matchId, accept: false }),
          },
        ],
        60_000,
      );
    }

    function onResumeDeclined() {
      notify("Your resume request was declined.", [], 4000);
    }

    // Fires for BOTH players the instant their tournament pairing's game is
    // created, whether that's the opening round or one that had to wait out
    // an inter-round break (see scheduleRoundStart in tournament.service.ts).
    // Someone actively sitting on that tournament's page gets swept straight
    // into the game, since they're clearly there waiting for it; anyone else
    // gets a notification with a button instead of being yanked out of
    // whatever else they're doing.
    function onTournamentPairingReady(payload: {
      tournamentId: string;
      code: string;
      joinCode: string;
    }) {
      const onThisTournamentPage = pathRef.current === `/tournaments/${payload.code}`;
      if (onThisTournamentPage) {
        navigate(`/game/${payload.joinCode}`);
        return;
      }
      notify(
        "Your tournament game has started.",
        [{ label: "Play it now", onClick: () => navigate(`/game/${payload.joinCode}`) }],
        20_000,
      );
    }

    socket.on("challenge:received", onChallengeReceived);
    socket.on("challenge:accepted", onChallengeAccepted);
    socket.on("challenge:declined", onChallengeDeclined);
    socket.on("challenge:cancelled", onChallengeCancelled);
    socket.on("challenge:error", onChallengeError);
    socket.on("game:rematch_offered", onRematchOffered);
    socket.on("game:rematch_accepted", onRematchAccepted);
    socket.on("game:rematch_started", onRematchStarted);
    socket.on("game:rematch_declined", onRematchDeclined);
    socket.on("cage:received", onCageReceived);
    socket.on("cage:accepted", onCageAccepted);
    socket.on("cage:declined", onCageDeclined);
    socket.on("cage:cancelled", onCageCancelled);
    socket.on("cage:error", onCageError);
    socket.on("cage:next_leg", onCageNextLeg);
    socket.on("cage:next_leg_spectator", onCageNextLegSpectator);
    socket.on("cage:match_over", onCageMatchOver);
    socket.on("cage:pause_requested", onPauseRequested);
    socket.on("cage:pause_declined", onPauseDeclined);
    socket.on("cage:resume_requested", onResumeRequested);
    socket.on("cage:resume_declined", onResumeDeclined);
    socket.on("tournament:pairing_ready", onTournamentPairingReady);

    return () => {
      socket.off("challenge:received", onChallengeReceived);
      socket.off("challenge:accepted", onChallengeAccepted);
      socket.off("challenge:declined", onChallengeDeclined);
      socket.off("challenge:cancelled", onChallengeCancelled);
      socket.off("challenge:error", onChallengeError);
      socket.off("game:rematch_offered", onRematchOffered);
      socket.off("game:rematch_accepted", onRematchAccepted);
      socket.off("game:rematch_started", onRematchStarted);
      socket.off("game:rematch_declined", onRematchDeclined);
      socket.off("cage:received", onCageReceived);
      socket.off("cage:accepted", onCageAccepted);
      socket.off("cage:declined", onCageDeclined);
      socket.off("cage:cancelled", onCageCancelled);
      socket.off("cage:error", onCageError);
      socket.off("cage:next_leg", onCageNextLeg);
      socket.off("cage:next_leg_spectator", onCageNextLegSpectator);
      socket.off("cage:match_over", onCageMatchOver);
      socket.off("cage:pause_requested", onPauseRequested);
      socket.off("cage:pause_declined", onPauseDeclined);
      socket.off("cage:resume_requested", onResumeRequested);
      socket.off("cage:resume_declined", onResumeDeclined);
      socket.off("tournament:pairing_ready", onTournamentPairingReady);
    };
  }, [socket, navigate, notify]);

  if (cageMatchOver) {
    return (
      <CageMatchOverModal
        match={cageMatchOver}
        myUserId={user?.id}
        onViewResult={() => {
          const code = cageMatchOver.matchCode;
          setCageMatchOver(null);
          navigate(`/cage/${code}`);
        }}
        onClose={() => setCageMatchOver(null)}
      />
    );
  }

  return null;
}
