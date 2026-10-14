import { useLayoutEffect, useRef, useState, memo } from "react";
import { motion } from "framer-motion";
import { Chessground } from "@lichess-org/chessground";
import type { Key } from "@lichess-org/chessground/types";
import { BoardCoordinates, BoardCoordinatesOutside } from "../ChessBoard.js";
import { MoveBadge } from "./MoveBadge.js";
import { MOVE_CLASS_META } from "./moveClassMeta.js";
import type { MoveClass } from "../../lib/analysis/classify.js";
import { springSnappy } from "../../lib/motion.js";
import "./analysis-board.css";

type CgApi = ReturnType<typeof Chessground>;

export interface AnalysisBoardProps {
  fen: string;
  orientation: "white" | "black";
  /** [from, to] of the move that produced `fen`, undefined at the start. */
  lastMove?: [string, string];
  /** Verdict on that move. Drives the square tint and the corner badge. */
  verdict?: MoveClass | null;
  boardTheme: string;
  pieceTheme: string;
  showCoordinates?: boolean;
  animationEnabled?: boolean;
  /** Last move gave check / mate, for the red king glow. */
  inCheck?: boolean;
  turnColor: "white" | "black";
}

/**
 * Read-only board for the analysis view. Deliberately separate from the live
 * game's ChessBoard: nothing here is interactive, there are no dests,
 * premoves or clocks, and it owns an overlay layer for the verdict badge.
 *
 * The badge sits on the destination square's top-right corner, like
 * chess.com's, and the from/to squares are tinted in the verdict's color.
 */
export const AnalysisBoard = memo(function AnalysisBoard({
  fen,
  orientation,
  lastMove,
  verdict,
  boardTheme,
  pieceTheme,
  showCoordinates = true,
  animationEnabled = true,
  inCheck,
  turnColor,
}: AnalysisBoardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cgRef = useRef<HTMLDivElement>(null);
  const groundRef = useRef<CgApi | null>(null);
  const orientationRef = useRef(orientation);
  const [size, setSize] = useState(0);

  // Same trick as ChessBoard: snap to a multiple of 8 so every square (and
  // the badge pinned to it) lands on whole pixels.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    function measure() {
      const w = Math.floor(el!.getBoundingClientRect().width / 8) * 8;
      if (w > 0) setSize(w);
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!cgRef.current || size === 0) return;
    groundRef.current = Chessground(cgRef.current, {
      fen,
      orientation,
      viewOnly: true,
      coordinates: false,
      turnColor,
      check: inCheck,
      lastMove: lastMove as Key[] | undefined,
      animation: { enabled: animationEnabled, duration: 150 },
      highlight: { lastMove: true, check: true },
      draggable: { enabled: false },
      selectable: { enabled: false },
      movable: { free: false, color: undefined },
    });
    return () => {
      groundRef.current?.destroy();
      groundRef.current = null;
    };
    // Built once the board is measurable; everything else flows through set().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size > 0]);

  useLayoutEffect(() => {
    const flipped = orientationRef.current !== orientation;
    orientationRef.current = orientation;
    groundRef.current?.set({
      fen,
      orientation,
      turnColor,
      check: inCheck,
      lastMove: lastMove as Key[] | undefined,
      // A flip moves every piece at once, so skip the slide for that one update.
      animation: { enabled: flipped ? false : animationEnabled, duration: 150 },
    });
  }, [fen, orientation, turnColor, inCheck, lastMove, animationEnabled]);

  useLayoutEffect(() => {
    if (size === 0) return;
    (groundRef.current as any)?.redrawAll?.();
  }, [size]);

  const tint = verdict ? `${MOVE_CLASS_META[verdict].color}8c` : undefined;
  const badge = verdict && lastMove && size > 0 ? placeBadge(lastMove[1], orientation, size) : null;

  return (
    <div
      ref={rootRef}
      className="mx-auto aspect-square w-full"
      // Never taller than the screen can show, leaves room for the header
      // and the player strips above/below on short viewports.
      style={{ maxWidth: "min(100%, calc(100svh - 14rem))" }}
    >
      <div
        className={`analysis-board relative board-theme-${boardTheme} piece-theme-${pieceTheme}`}
        style={
          {
            width: size,
            height: size,
            "--analysis-tint": tint,
          } as React.CSSProperties
        }
      >
        <div
          ref={cgRef}
          className="cg-wrap overflow-hidden rounded-sm md:rounded-lg"
          style={{ width: size, height: size }}
        />
        {showCoordinates && size > 0 && (
          <>
            <BoardCoordinates orientation={orientation} boardSize={size} className="lg:hidden" />
            <BoardCoordinatesOutside orientation={orientation} boardSize={size} />
          </>
        )}
        {badge && verdict && (
          <motion.div
            // New key per position so the badge pops in on every move.
            key={`${fen}:${lastMove![1]}`}
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={springSnappy}
            className="pointer-events-none absolute z-10"
            style={{
              left: badge.left,
              top: badge.top,
              width: badge.size,
              height: badge.size,
              filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.45))",
            }}
          >
            <MoveBadge cls={verdict} size={badge.size} />
          </motion.div>
        )}
      </div>
    </div>
  );
});

/** Pixel box for the verdict badge: top-right corner of `square`, nudged
 *  out like chess.com's but clamped so it never leaves the board. */
function placeBadge(square: string, orientation: "white" | "black", boardSize: number) {
  const file = square.charCodeAt(0) - 97; // a..h -> 0..7
  const rank = Number(square[1]); // 1..8
  const col = orientation === "white" ? file : 7 - file;
  const row = orientation === "white" ? 8 - rank : rank - 1;
  const sq = boardSize / 8;
  const size = Math.round(sq * 0.46);
  const left = Math.min((col + 1) * sq - size * 0.72, boardSize - size);
  const top = Math.max(row * sq - size * 0.28, 0);
  return { left, top, size };
}
