import { motion } from "framer-motion";
import { Ban } from "lucide-react";
import { ChessBoard } from "../ChessBoard.js";
import { PromotionPicker } from "../PromotionPicker.js";
import { PlayerPanelRow, type PanelData } from "../PlayerPanels.js";
import { Button } from "../ui/index.js";
import { springSnappy } from "../../lib/motion.js";

interface GameBoardAreaProps {
  opponentPanelData: PanelData;
  myPanelData: PanelData;
  boardTheme: string;
  pieceTheme: string;
  displayFen: string;
  boardFlipped: boolean;
  myColor: "white" | "black" | undefined;
  viewOnly: boolean;
  turnColor: "white" | "black";
  dests: Map<string, string[]>;
  premoveDests: Map<string, string[]>;
  inCheck: boolean;
  displayLastMove: [string, string] | undefined;
  onUserMove: (orig: string, dest: string) => void;
  animationEnabled: boolean;
  showCoordinates: boolean;
  showLegalMoves: boolean;
  isPlayer: boolean;
  status: "waiting" | "active" | "finished" | "aborted";
  onCancelWaitingGame: () => void;
  promoPending: boolean;
  onPromotionPick: (piece: "q" | "r" | "b" | "n") => void;
}

/** The board itself plus everything that visually anchors to it: the
 *  mobile top/bottom player panels flanking it, the waiting-for-opponent
 *  banner, and the promotion picker overlay. Split out of Game.tsx mainly
 *  for size — this block owns no state of its own. */
export function GameBoardArea({
  opponentPanelData,
  myPanelData,
  boardTheme,
  pieceTheme,
  displayFen,
  boardFlipped,
  myColor,
  viewOnly,
  turnColor,
  dests,
  premoveDests,
  inCheck,
  displayLastMove,
  onUserMove,
  animationEnabled,
  showCoordinates,
  showLegalMoves,
  isPlayer,
  status,
  onCancelWaitingGame,
  promoPending,
  onPromotionPick,
}: GameBoardAreaProps) {
  return (
    <div className="game-area-board relative flex flex-col flex-1 items-center justify-center">
      <div className="game-area-toppanel md:hidden w-[95%]">
        <PlayerPanelRow {...opponentPanelData} />
      </div>
      {/* The classic aspect-ratio-in-a-shrinkable-flex-column trap: a
       *  plain `w-full aspect-square` box computes its height FROM its
       *  width, but flex-shrink can still independently shrink that
       *  height to fit the column without ever reconciling the width
       *  back down to match — so at certain viewport-height/zoom
       *  combinations the two stop agreeing and the board renders
       *  smaller than the box around it. A size container sidesteps
       *  the whole problem: this wrapper is the one thing that's
       *  unambiguously sized by flexbox (flex-1 + min-h-0 gives it
       *  exactly the space left after the mobile top/bottom panels),
       *  and the board below is sized from ITS dimensions via cqw/cqh
       *  rather than back through width→aspect-ratio→flex-shrink. The
       *  browser can now only ever produce one answer, not two that
       *  might disagree. */}
      <div className="relative flex w-full min-h-0 flex-1 items-center justify-center @container-size">
        <div
          className={`relative bg-purple-700 w-[min(100cqw,100cqh)] h-[min(100cqw,100cqh)] rounded-2xl flex items-center shadow- overflow-hidden board-theme-${boardTheme} piece-theme-${pieceTheme} justify-center`}
        >
          <ChessBoard
            fen={displayFen}
            orientation={
              boardFlipped
                ? myColor === "black"
                  ? "white"
                  : "black"
                : (myColor ?? "white")
            }
            viewOnly={viewOnly}
            turnColor={turnColor}
            movableColor={myColor}
            dests={dests}
            premoveDests={premoveDests}
            inCheck={inCheck}
            lastMove={displayLastMove}
            onUserMove={onUserMove}
            animationEnabled={animationEnabled}
            showCoordinates={showCoordinates}
            showLegalMoves={showLegalMoves}
          />
          {isPlayer && status === "waiting" && (
            <div className="pointer-events-none absolute bg-base-200/10 inset-0 px-3 justify-center items-center top-2 z-30 mx-auto flex">
              <motion.div
                key="waiting-banner"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={springSnappy}
                className="pointer-events-auto flex items-center gap-3 rounded-xl border border-base-300 bg-base-100 px-3 py-2.5 shadow-lg"
              >
                <p className="flex-1 text-sm text-base-content/60">
                  Waiting for an opponent to join…
                </p>
                <Button variant="glass" size="sm" onClick={onCancelWaitingGame}>
                  <Ban className="h-4 w-4" /> Cancel game
                </Button>
              </motion.div>
            </div>
          )}
          {promoPending && <PromotionPicker onPick={onPromotionPick} />}
        </div>
      </div>
      <div className="game-area-bottompanel md:hidden w-[95%]">
        <PlayerPanelRow {...myPanelData} />
      </div>
    </div>
  );
}
