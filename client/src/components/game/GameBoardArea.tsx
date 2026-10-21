import { useRef, useMemo, memo } from "react";
import { motion } from "framer-motion";
import { Ban } from "lucide-react";
import { ChessBoard, BoardCoordinatesOutside } from "../ChessBoard.js";
import { PromotionPicker } from "../PromotionPicker.js";
import { PlayerPanelRow, type PanelData } from "../PlayerPanels.js";
import { Button } from "../ui/index.js";
import { springSnappy } from "../../lib/motion.js";
import { useSquareSize } from "./useSquareSize.js";
import { chessFen } from "../../chessUtils.js";
import { parseZhFen, type ZhRole } from "../../crazyhouse.js";
import {
  PocketBar,
  DropOverlay,
  DragGhost,
  useDropController,
} from "./CrazyhousePockets.js";

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
  animationDurationMs: number;
  showCoordinates: boolean;
  showLegalMoves: boolean;
  isPlayer: boolean;
  status: "waiting" | "active" | "finished" | "aborted";
  onCancelWaitingGame: () => void;
  promoPending: boolean;
  onPromotionPick: (piece: "q" | "r" | "b" | "n") => void;
  /** Crazyhouse only: shows both pockets and lets the player drop pieces. */
  variant?: "standard" | "chess960" | "crazyhouse";
  /** The live (never historical) position, drops are made against this. */
  liveFen?: string;
  /** True only while the viewing player may drop right now. */
  canDrop?: boolean;
  onDrop?: (role: ZhRole, square: string) => void;
}

/** The board itself plus everything that visually anchors to it: the
 *  mobile top/bottom player panels flanking it, the waiting-for-opponent
 *  banner, and the promotion picker overlay. Split out of Game.tsx mainly
 *  for size, this block owns no state of its own.
 *
 *  Wrapped in React.memo: Game.tsx re-renders on a lot of state that has
 *  nothing to do with the board itself (chat input, move errors, toast
 *  banners…), and this component's own inner ChessBoard is already memoized
 *, but without this wrapper every one of those unrelated re-renders was
 *  still reconciling this whole tree (panels, waiting banner, promotion
 *  picker) for no visible change. */
export const GameBoardArea = memo(function GameBoardArea({
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
  animationDurationMs,
  showCoordinates,
  showLegalMoves,
  isPlayer,
  status,
  onCancelWaitingGame,
  promoPending,
  onPromotionPick,
  variant,
  liveFen,
  canDrop = false,
  onDrop,
}: GameBoardAreaProps) {
  const squareWrapperRef = useRef<HTMLDivElement | null>(null);
  const squareSize = useSquareSize(squareWrapperRef);
  const boardBoxRef = useRef<HTMLDivElement | null>(null);
  const isZh = variant === "crazyhouse";
  // Pockets are read off the position on screen (so scrubbing back through
  // the move list shows the pockets as they were), drops use the live one.
  const pockets = useMemo(
    () => (isZh ? parseZhFen(displayFen).pockets : null),
    [isZh, displayFen],
  );

  // Flipping the board moves my pieces to the top, the panels flanking
  // it should move with them, so the panel nearest my rank on screen
  // always reads as "me" regardless of orientation.
  const topPanelData = boardFlipped ? myPanelData : opponentPanelData;
  const bottomPanelData = boardFlipped ? opponentPanelData : myPanelData;

  const orientation: "white" | "black" = boardFlipped
    ? myColor === "black"
      ? "white"
      : "black"
    : (myColor ?? "white");

  const topPocketColor: "white" | "black" =
    orientation === "white" ? "black" : "white";
  const bottomPocketColor = orientation;
  const drop = useDropController({
    boardRef: boardBoxRef,
    orientation,
    liveFen: liveFen ?? displayFen,
    canDrop: isZh && canDrop,
    onDrop: onDrop ?? (() => undefined),
  });
  const pocketRow = (color: "white" | "black") =>
    pockets ? (
      <div
        className="mx-auto w-[95%] md:w-full"
        style={{
          maxWidth: squareSize > 0 ? squareSize : undefined,
        }}
      >
        <PocketBar
          color={color}
          pocket={color === "white" ? pockets.w : pockets.b}
          pieceTheme={pieceTheme}
          interactive={canDrop && color === myColor}
          selectedRole={drop.selectedRole}
          onPiecePointerDown={drop.handlePocketPointerDown}
        />
      </div>
    ) : null;

  return (
    <div className="game-area-board mt-4 md:mt-0 relative flex flex-col flex-1 items-center justify-center">
      <div className=" md:hidden w-[95%]">
        <PlayerPanelRow {...topPanelData} />
      </div>
      {/* This wrapper is the one thing unambiguously sized by flexbox
       *  (flex-1 + min-h-0 gives it exactly the space left after the
       *  mobile top/bottom panels), useSquareSize measures it directly
       *  via ResizeObserver and hands back the largest square that fits,
       *  which the board below is then sized to with plain inline
       *  width/height. No CSS unit trickery, no container-query support
       *  to depend on, just a measured number in, a pixel size out. */}
      {isZh && <div className="mt-1.5">{pocketRow(topPocketColor)}</div>}
      <div
        ref={squareWrapperRef}
        className="relative flex w-full min-h-0 flex-1 items-center justify-center"
      >
        <div
          ref={boardBoxRef}
          className="relative"
          style={{
            width: squareSize || undefined,
            height: squareSize || undefined,
          }}
        >
          <div
            className={`relative rounded-md lg:rounded-2xl flex items-center shadow- overflow-hidden board-theme-${boardTheme} piece-theme-${pieceTheme} justify-center h-full w-full`}
          >
            <ChessBoard
              fen={chessFen(displayFen)}
              orientation={orientation}
              viewOnly={viewOnly}
              turnColor={turnColor}
              movableColor={myColor}
              dests={dests}
              premoveDests={premoveDests}
              inCheck={inCheck}
              lastMove={displayLastMove}
              onUserMove={onUserMove}
              animationEnabled={animationEnabled}
              animationDurationMs={animationDurationMs}
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
            {isZh && (
              <DropOverlay
                orientation={orientation}
                legalSquares={drop.legalSquares}
                captureTaps={drop.selectedRole !== null && drop.drag === null}
                onPointerDown={drop.handleBoardPointerDown}
              />
            )}
          </div>
          {/* Deliberately a sibling of the overflow-hidden themed div above,
           *  not a child of it — labels positioned outside the board's own
           *  box would otherwise get silently clipped by that div's
           *  overflow-hidden (which needs to stay, it's what keeps the
           *  waiting-banner scrim and promotion picker within the rounded
           *  corners). This wrapper has no overflow-hidden of its own, so
           *  the coordinates can render past its edges on lg+. */}
          {showCoordinates && squareSize > 0 && (
            <BoardCoordinatesOutside orientation={orientation} boardSize={squareSize} />
          )}
        </div>
      </div>
      {isZh && <div className="mb-1.5">{pocketRow(bottomPocketColor)}</div>}
      <div className=" md:hidden w-[95%]">
        <PlayerPanelRow {...bottomPanelData} />
      </div>
      {isZh && drop.drag && myColor && (
        <DragGhost
          role={drop.drag.role}
          color={myColor}
          x={drop.drag.x}
          y={drop.drag.y}
          size={Math.max(40, (squareSize / 8) * 1.2)}
          pieceTheme={pieceTheme}
        />
      )}
    </div>
  );
});
