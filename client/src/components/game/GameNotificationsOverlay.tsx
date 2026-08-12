import { motion, AnimatePresence } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { DisconnectBanner } from "../DisconnectBanner.js";
import { Card, Button } from "../ui/index.js";
import { springSnappy } from "../../lib/motion.js";

interface GameNotificationsOverlayProps {
  pausedLeg: boolean;
  gameOver: boolean;
  isPlayer: boolean;
  moveError: string;
  isCageMatch: boolean;
  resumeRequestSent: boolean;
  onResumeRequest: () => void;
  disconnectExpiresAt: number | null;
  isIdlePhase: boolean;
  onClaim: (claim: "win" | "draw") => void;
}

/** Notification overlay stack — leg-paused notice, move errors, the
 *  paused-leg resume card, and the opponent-disconnect banner. All
 *  absolute + centered over the page instead of sitting inline above the
 *  board, so any one of them popping in or out mid-game never shifts the
 *  board or panels beneath it. Stacked in one flex column (rather than
 *  each doing its own absolute math) so multiple notifications showing at
 *  once — say a move error right as the opponent disconnects — line up
 *  instead of overlapping. The wrapper is pointer-events-none so empty
 *  space over the board stays clickable/draggable; each banner opts back
 *  into pointer-events-auto for its own buttons. */
export function GameNotificationsOverlay({
  pausedLeg,
  gameOver,
  isPlayer,
  moveError,
  isCageMatch,
  resumeRequestSent,
  onResumeRequest,
  disconnectExpiresAt,
  isIdlePhase,
  onClaim,
}: GameNotificationsOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-30 mx-auto flex w-[min(92vw,26rem)] flex-col items-stretch gap-2">
      <AnimatePresence>
        {pausedLeg && !gameOver && (
          <motion.div
            key="paused-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={springSnappy}
            className="pointer-events-auto flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-base-200 p-2.5 text-center text-sm text-amber-500 shadow-lg"
          >
            <Pause className="h-4 w-4" /> This game is paused
            {isPlayer ? "" : " by the players"}.
          </motion.div>
        )}

        {moveError && (
          <motion.p
            key="move-error"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={springSnappy}
            className="pointer-events-auto rounded-xl bg-base-100 px-3 py-2 text-center text-sm text-red-400 shadow-lg"
          >
            {moveError}
          </motion.p>
        )}

        {isPlayer && isCageMatch && pausedLeg && (
          <motion.div
            key="paused-card"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={springSnappy}
            className="pointer-events-auto"
          >
            <Card
              variant="strong"
              className="border-amber-500/30 text-sm text-amber-500 shadow-xl"
            >
              <p className="mb-2 flex items-center gap-1.5 font-semibold">
                <Pause className="h-4 w-4" /> This game is paused.
              </p>
              <Button
                size="sm"
                disabled={resumeRequestSent}
                onClick={onResumeRequest}
                className="bg-amber-700 text-white shadow-none hover:bg-amber-600 hover:brightness-100"
              >
                <Play className="h-4 w-4" />
                {resumeRequestSent ? "Resume request sent…" : "Request resume"}
              </Button>
            </Card>
          </motion.div>
        )}

        {disconnectExpiresAt !== null && !isIdlePhase && (
          <DisconnectBanner expiresAt={disconnectExpiresAt} onClaim={onClaim} />
        )}
      </AnimatePresence>
    </div>
  );
}
