import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSocket } from "../contexts/SocketContext.js";
import { useNotify } from "../contexts/NotificationContext.js";

/**
 * Cross-page real-time notifications: incoming friend challenges and rematch
 * offers need to reach the user no matter what page they're currently on, so
 * these listeners are wired up once here rather than inside individual pages.
 */
export function GlobalListeners() {
  const socket = useSocket();
  const navigate = useNavigate();
  const { notify } = useNotify();

  useEffect(() => {
    if (!socket) return;

    function onChallengeReceived(payload: {
      challengeId: string;
      from: { username: string };
      timeControl: { baseMinutes: number | null; incrementSeconds: number };
    }) {
      if (!socket) return;

      const tc =
        payload.timeControl.baseMinutes === null
          ? "Unlimited"
          : `${payload.timeControl.baseMinutes}+${payload.timeControl.incrementSeconds}`;
      notify(
        `${payload.from.username} challenged you to a game (${tc}).`,
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

    function onRematchDeclined() {
      notify("Your rematch offer was declined.", [], 4000);
    }

    socket.on("challenge:received", onChallengeReceived);
    socket.on("challenge:accepted", onChallengeAccepted);
    socket.on("challenge:declined", onChallengeDeclined);
    socket.on("challenge:cancelled", onChallengeCancelled);
    socket.on("game:rematch_offered", onRematchOffered);
    socket.on("game:rematch_accepted", onRematchAccepted);
    socket.on("game:rematch_declined", onRematchDeclined);

    return () => {
      socket.off("challenge:received", onChallengeReceived);
      socket.off("challenge:accepted", onChallengeAccepted);
      socket.off("challenge:declined", onChallengeDeclined);
      socket.off("challenge:cancelled", onChallengeCancelled);
      socket.off("game:rematch_offered", onRematchOffered);
      socket.off("game:rematch_accepted", onRematchAccepted);
      socket.off("game:rematch_declined", onRematchDeclined);
    };
  }, [socket, navigate, notify]);

  return null;
}
