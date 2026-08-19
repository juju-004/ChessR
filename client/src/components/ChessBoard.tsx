import { useLayoutEffect, useRef, useState, memo } from "react";
import { Chessground } from "@lichess-org/chessground";
import { Key } from "@lichess-org/chessground/types";

type CgApi = ReturnType<typeof Chessground>;
type CgConfig = NonNullable<Parameters<typeof Chessground>[1]>;

export interface ChessBoardProps {
  fen: string;
  orientation: "white" | "black";
  viewOnly: boolean;
  turnColor: "white" | "black";
  movableColor?: "white" | "black";
  dests: Map<string, string[]>;
  premoveDests?: Map<string, string[]>;
  inCheck?: boolean;
  lastMove?: [string, string];
  onUserMove: (orig: string, dest: string) => void;
  animationEnabled?: boolean;
  showCoordinates?: boolean;
  showLegalMoves?: boolean;
}

export const ChessBoard = memo(function ChessBoard({
  fen,
  orientation,
  viewOnly,
  turnColor,
  movableColor,
  dests,
  premoveDests,
  inCheck,
  lastMove,
  onUserMove,
  animationEnabled = true,
  showCoordinates = true,
  showLegalMoves = true,
}: ChessBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const groundRef = useRef<CgApi | null>(null);
  const onUserMoveRef = useRef(onUserMove);
  onUserMoveRef.current = onUserMove;
  // Tracks orientation across renders so the sync effect below can tell
  // "the board flipped" apart from "a piece actually moved" — see that
  // effect for why the distinction matters.
  const orientationRef = useRef(orientation);

  // No separate wrapper div — this measures the caller's own parent
  // element directly (e.g. Game.tsx's themed board container) via
  // `containerRef.current.parentElement`. That parent is expected to be a
  // true square (fixed via a non-conflicting CSS aspect-ratio — see
  // Game.tsx) and a flex container with items-center/justify-center, so
  // that cg-wrap gets centered inside it if its box is ever not perfectly
  // square during a transient reflow.
  //
  // `boardSize` here is what keeps chessground's internal <cg-container>
  // (sized off cg-wrap via a pure-CSS 12.5%/800% percentage trick) from
  // drifting out of sync with cg-wrap itself: snapping to a multiple of 8
  // means every square — and the coordinate labels drawn alongside them —
  // lands on a whole pixel instead of drifting apart over the board.
  const [boardSize, setBoardSize] = useState(0);
  useLayoutEffect(() => {
    const parent = containerRef.current?.parentElement;
    if (!parent) return;
    function measure() {
      const box = parent!.getBoundingClientRect();
      const side = Math.floor(Math.min(box.width, box.height) / 8) * 8;
      // Ignore a transient zero/near-zero read (e.g. a reflow triggered
      // elsewhere on the page — a modal opening, a panel animating —
      // that briefly collapses this element's box) rather than tearing
      // the board down to invisible and rebuilding it a frame later.
      if (side > 0) setBoardSize(side);
    }
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(parent);
    return () => resizeObserver.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!containerRef.current || boardSize === 0) return;
    const config: CgConfig = {
      fen,
      orientation,
      viewOnly,
      turnColor,
      check: inCheck,
      coordinates: showCoordinates,
      animation: { enabled: animationEnabled, duration: 200 },
      movable: {
        free: false,
        color: movableColor,
        dests: dests as any,
        showDests: showLegalMoves,
        events: {
          after: (orig: string, dest: string) =>
            onUserMoveRef.current(orig, dest),
        },
      },
      premovable: {
        enabled: !!movableColor,
        showDests: true,
        customDests: premoveDests as any,
      },
      lastMove: lastMove as Key[] | undefined,
    };
    groundRef.current = Chessground(containerRef.current, config);
    return () => {
      groundRef.current?.destroy();
      groundRef.current = null;
    };
  }, [viewOnly, boardSize > 0]);

  useLayoutEffect(() => {
    const isFlip = orientationRef.current !== orientation;
    orientationRef.current = orientation;

    groundRef.current?.set({
      fen,
      orientation,
      viewOnly,
      turnColor,
      lastMove: lastMove as Key[] | undefined,
      check: inCheck,
      coordinates: showCoordinates,
      // A flip repositions every piece on the board at once (their pixel
      // target changed because the axes flipped, not because anything
      // moved) — chessground's animation system can't tell that apart
      // from a real move, so left alone it slides all 32 squares' worth
      // of pieces into place over `duration`, which is what showed up as
      // "flip takes a moment" instead of being instant. Disabling
      // animation for just this one set() call fixes that; a real move
      // right after still gets the user's normal animationEnabled
      // setting on the very next update.
      animation: { enabled: isFlip ? false : animationEnabled, duration: 200 },
      movable: {
        color: movableColor,
        dests: dests as any,
        showDests: showLegalMoves,
      },
      premovable: { enabled: !!movableColor, customDests: premoveDests as any },
    });

    groundRef.current?.playPremove();
  }, [
    fen,
    orientation,
    viewOnly,
    turnColor,
    movableColor,
    dests,
    premoveDests,
    inCheck,
    lastMove,
    animationEnabled,
    showCoordinates,
    showLegalMoves,
  ]);

  // The board resized (window resize, sidebar collapse/expand, orientation
  // change) without changing viewOnly, so the construction effect above
  // won't rebuild — tell the already-live instance to recompute its bounds
  // against the container's new (still multiple-of-8) pixel size instead.
  useLayoutEffect(() => {
    if (boardSize === 0) return;
    (groundRef.current as any)?.redrawAll?.();
  }, [boardSize]);

  return (
    <div
      ref={containerRef}
      className="cg-wrap rounded-lg overflow-hidden"
      style={{ width: boardSize, height: boardSize }}
    />
  );
});
