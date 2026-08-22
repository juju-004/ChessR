import { useLayoutEffect, useMemo, useRef, useState, memo, type CSSProperties } from "react";
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
  /** How long a piece slide takes, in ms — see
   *  timeControls.ts's animationDurationForTimeControl, which buckets this
   *  by the game's actual time control (bullet/blitz/rapid/classical) so
   *  faster games feel snappier and slower games feel more deliberate,
   *  rather than one fixed speed for every game. */
  animationDurationMs?: number;
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
  animationDurationMs = 200,
  showCoordinates = true,
  showLegalMoves = true,
}: ChessBoardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const groundRef = useRef<CgApi | null>(null);
  const onUserMoveRef = useRef(onUserMove);
  onUserMoveRef.current = onUserMove;
  // Tracks orientation across renders so the sync effect below can tell
  // "the board flipped" apart from "a piece actually moved" — see that
  // effect for why the distinction matters.
  const orientationRef = useRef(orientation);

  // No separate wrapper div around cg-wrap and Game.tsx's own container —
  // this measures the CALLER's container directly (e.g. Game.tsx's themed
  // board box) via `rootRef.current.parentElement`, i.e. one level above
  // this component's own root. `rootRef` is on the outer wrapper (below)
  // rather than `containerRef` (the inner cg-wrap chessground owns)
  // specifically so that measurement targets the real caller-sized box —
  // measuring via containerRef.current.parentElement would instead measure
  // the wrapper this component renders around itself, which is sized OFF
  // boardSize (see the JSX below), a self-referential 0×0 loop that reads
  // as "the board silently never appears" (boardSize starts at 0, so its
  // own parent is measured at 0×0 forever, so boardSize never leaves 0).
  //
  // That parent is expected to be a true square (fixed via a
  // non-conflicting CSS aspect-ratio — see Game.tsx) and a flex container
  // with items-center/justify-center, so that cg-wrap gets centered inside
  // it if its box is ever not perfectly square during a transient reflow.
  //
  // `boardSize` here is what keeps chessground's internal <cg-container>
  // (sized off cg-wrap via a pure-CSS 12.5%/800% percentage trick) from
  // drifting out of sync with cg-wrap itself: snapping to a multiple of 8
  // means every square — and the coordinate labels drawn alongside them —
  // lands on a whole pixel instead of drifting apart over the board.
  const [boardSize, setBoardSize] = useState(0);
  useLayoutEffect(() => {
    const parent = rootRef.current?.parentElement;
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
      // Always false: chessground's own coordinate labels are the ones
      // that render deformed/scattered on some mobile browsers (see the
      // now-removed .cg-wrap text-size-adjust hack this used to lean on
      // in index.css) — coordinates are drawn ourselves instead, as a
      // plain React overlay below, which sidesteps that rendering path
      // entirely. `showCoordinates` still controls whether that overlay
      // renders at all.
      coordinates: false,
      animation: { enabled: animationEnabled, duration: animationDurationMs },
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
    // Deliberately NOT depending on viewOnly (or any of the other config
    // fields also present in the sync effect below) — those are already
    // pushed through via groundRef.current.set() every time they change,
    // so including them here just meant the entire Chessground instance
    // got torn down and rebuilt from scratch on every toggle (viewOnly
    // flips on literally every move-history navigation and every
    // game-finish transition) instead of a cheap in-place update. That
    // was a real, visible stutter source — this only rebuilds when the
    // board first becomes measurable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardSize > 0]);

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
      // See the construction effect above — always off, drawn ourselves.
      coordinates: false,
      // A flip repositions every piece on the board at once (their pixel
      // target changed because the axes flipped, not because anything
      // moved) — chessground's animation system can't tell that apart
      // from a real move, so left alone it slides all 32 squares' worth
      // of pieces into place over `duration`, which is what showed up as
      // "flip takes a moment" instead of being instant. Disabling
      // animation for just this one set() call fixes that; a real move
      // right after still gets the user's normal animationEnabled
      // setting on the very next update.
      animation: { enabled: isFlip ? false : animationEnabled, duration: animationDurationMs },
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
    animationDurationMs,
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
    <div ref={rootRef} className="relative" style={{ width: boardSize, height: boardSize }}>
      <div
        ref={containerRef}
        className="cg-wrap rounded-lg overflow-hidden"
        style={{ width: boardSize, height: boardSize }}
      />
      {showCoordinates && boardSize > 0 && (
        <BoardCoordinates orientation={orientation} boardSize={boardSize} />
      )}
    </div>
  );
});

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

// True for the traditionally-dark square at (file, rank) — a1 is dark,
// b1 is light, etc: standard alternation is "dark when file+rank is even",
// using file a=1..h=8. Used purely to pick a legible label color, not to
// draw the squares themselves (chessground/CSS already own that).
function isDarkSquare(fileIndex: number, rank: number): boolean {
  const fileNum = fileIndex + 1; // a=1..h=8
  return (fileNum + rank) % 2 === 0;
}

/**
 * Our own rank/file labels, replacing chessground's built-in ones — those
 * render at a small fixed CSS-px font size that mobile Safari/Chrome's
 * automatic text-size-adjust inflates per-element rather than uniformly,
 * which is what made them look randomly scattered/deformed on phone no
 * matter what `text-size-adjust: 100%` override got thrown at `.cg-wrap`
 * (see the old comment this replaced in index.css). This is a plain React
 * overlay instead — a rem-sized, ordinarily-laid-out <span> per label —
 * so it's simply not exposed to that mobile rendering quirk at all.
 *
 * Ranks sit in the top-left corner of the left-edge squares; files sit in
 * the bottom-right corner of the bottom-edge squares — the same corner
 * convention lichess/chess.com use. Label color alternates with the
 * square's own light/dark color for contrast, the same way theirs does,
 * rather than one fixed color that would wash out on a same-toned square.
 */
const BoardCoordinates = memo(function BoardCoordinates({
  orientation,
  boardSize,
}: {
  orientation: "white" | "black";
  boardSize: number;
}) {
  const squareSize = boardSize / 8;
  const fontSize = Math.max(9, Math.round(boardSize * 0.022));
  const inset = Math.max(2, Math.round(boardSize * 0.006));

  const { files, ranks } = useMemo(() => {
    // Left-to-right file order and top-to-bottom rank order, accounting
    // for which side is facing the viewer.
    const files = orientation === "white" ? FILES : [...FILES].reverse();
    const ranks =
      orientation === "white"
        ? [8, 7, 6, 5, 4, 3, 2, 1]
        : [1, 2, 3, 4, 5, 6, 7, 8];
    return { files, ranks };
  }, [orientation]);

  const labelStyle = (dark: boolean): CSSProperties => ({
    fontSize,
    lineHeight: 1,
    fontWeight: 600,
    color: dark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.55)",
    textShadow: dark ? "0 1px 1px rgba(0,0,0,0.35)" : "none",
  });

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {ranks.map((rank, row) => {
        const leftFileIndex = FILES.indexOf(files[0]);
        return (
          <span
            key={`rank-${rank}`}
            className="absolute"
            style={{
              top: row * squareSize + inset,
              left: inset,
              ...labelStyle(isDarkSquare(leftFileIndex, rank)),
            }}
          >
            {rank}
          </span>
        );
      })}
      {files.map((file, col) => {
        const bottomRank = ranks[ranks.length - 1];
        const fileIndex = FILES.indexOf(file);
        return (
          <span
            key={`file-${file}`}
            className="absolute"
            style={{
              top: 7 * squareSize + squareSize - fontSize - inset,
              left: col * squareSize + squareSize - fontSize * 0.65 - inset,
              ...labelStyle(isDarkSquare(fileIndex, bottomRank)),
            }}
          >
            {file}
          </span>
        );
      })}
    </div>
  );
});
