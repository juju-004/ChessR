import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { ChessBoard } from "../ChessBoard.js";
import { PromotionPicker } from "../PromotionPicker.js";
import { computeDests, needsPromotion } from "../../chessUtils.js";
import { useSettings } from "../../contexts/SettingsContext.js";
import type { MoveResult, PuzzleView } from "../../api/puzzleRaces.js";

type Promo = "q" | "r" | "b" | "n";

// Kept short on purpose: in a race every moment counts, so these are just
// long enough for the eye to register a move, never a pause to sit through.
/** The opponent's opening move on a fresh puzzle. */
const FIRST_MOVE_DELAY_MS = 120;
/** The opponent's reply to a correct move. */
const REPLY_DELAY_MS = 140;
/** How long a wrong move stays on the board before it snaps back. */
const WRONG_FLASH_MS = 220;

export interface PuzzleBoardProps {
  puzzle: PuzzleView;
  /** True while moves must not be accepted (countdown, penalty lock, race over). */
  disabled: boolean;
  /** Sends the move to the server, which alone decides if it is right. */
  onMove: (move: {
    from: string;
    to: string;
    promotion?: Promo;
    /** Where we think we are; the server checks it, see submitMove. */
    index: number;
    moveIdx: number;
  }) => Promise<MoveResult>;
  /** The server rejected the move as wrong; lock the player out. */
  onWrong: (lockMs: number) => void;
  /** A puzzle was solved: `next` is the following one (null = last puzzle). */
  onSolved: (next: PuzzleView | null) => void;
  /** Local state drifted from the server's (stale/illegal): reload it. */
  onResync: () => void;
}

/**
 * One interactive puzzle. Positions are tracked locally with chess.js purely
 * for rendering and legality; whether a move is CORRECT is only ever decided
 * by the server (the answer isn't in the page). Parents should give this a
 * `key` that changes with the puzzle so each one starts clean.
 */
export function PuzzleBoard({
  puzzle,
  disabled,
  onMove,
  onWrong,
  onSolved,
  onResync,
}: PuzzleBoardProps) {
  const { settings } = useSettings();
  const [fen, setFen] = useState(puzzle.fen);
  const [lastMove, setLastMove] = useState<[string, string] | undefined>(
    puzzle.lastMove ?? undefined,
  );
  // Blocks input while an animation or a server round-trip is in flight.
  const [busy, setBusy] = useState(puzzle.firstMove !== null);
  const [wrongFlash, setWrongFlash] = useState(false);
  const [promoPending, setPromoPending] = useState<{ from: string; to: string } | null>(null);
  // The step of the puzzle's line we are on; advances with each correct move.
  const stepRef = useRef(puzzle.moveIdx);
  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  // A fresh puzzle opens with the opponent's move being played.
  useEffect(() => {
    const first = puzzle.firstMove;
    if (!first) return;
    later(() => {
      const chess = new Chess(puzzle.fen);
      chess.move(first);
      setFen(chess.fen());
      setLastMove([first.from, first.to]);
      setBusy(false);
    }, FIRST_MOVE_DELAY_MS);
  }, [puzzle, later]);

  const chess = useMemo(() => new Chess(fen), [fen]);
  const dests = useMemo(() => computeDests(chess), [chess]);
  const interactive = !disabled && !busy && !promoPending;

  const submit = useCallback(
    async (from: string, to: string, promotion?: Promo) => {
      const before = fen;
      const local = new Chess(before);
      try {
        local.move({ from, to, promotion });
      } catch {
        return;
      }
      setFen(local.fen());
      setLastMove([from, to]);
      setBusy(true);

      const res = await onMove({
        from,
        to,
        promotion,
        index: puzzle.index,
        moveIdx: stepRef.current,
      });

      if (res.ok && res.status === "correct") {
        stepRef.current = res.nextMoveIdx;
        later(() => {
          const c = new Chess(local.fen());
          c.move(res.reply);
          setFen(c.fen());
          setLastMove([res.reply.from, res.reply.to]);
          setBusy(false);
        }, REPLY_DELAY_MS);
      } else if (res.ok && res.status === "solved") {
        onSolved(res.next); // straight to the next puzzle
      } else if (res.ok && res.status === "finished") {
        onSolved(null);
      } else if (!res.ok && (res.status === "wrong" || res.status === "locked")) {
        setWrongFlash(true);
        onWrong(res.lockMs);
        later(() => {
          setFen(before);
          setLastMove(undefined);
          setWrongFlash(false);
          setBusy(false);
        }, WRONG_FLASH_MS);
      } else {
        // illegal / stale / not_active: our picture is out of date.
        setFen(before);
        setBusy(false);
        onResync();
      }
    },
    [fen, puzzle.index, onMove, onSolved, onWrong, onResync, later],
  );

  const handleUserMove = useCallback(
    (from: string, to: string) => {
      if (!interactive) return;
      if (needsPromotion(chess, from, to)) {
        if (settings.autoQueen) void submit(from, to, "q");
        else setPromoPending({ from, to });
        return;
      }
      void submit(from, to);
    },
    [interactive, chess, settings.autoQueen, submit],
  );

  const turn = chess.turn() === "w" ? "white" : "black";

  return (
    <div
      className={`relative aspect-square w-full overflow-hidden rounded-xl board-theme-${settings.boardTheme} piece-theme-${settings.pieceTheme} ${
        wrongFlash ? "ring-4 ring-red-500/70" : ""
      }`}
    >
      <ChessBoard
        fen={fen}
        orientation={puzzle.orientation}
        viewOnly={!interactive}
        turnColor={turn}
        movableColor={puzzle.orientation}
        dests={interactive ? dests : new Map()}
        inCheck={chess.inCheck()}
        lastMove={lastMove}
        onUserMove={handleUserMove}
        animationEnabled={settings.pieceAnimation}
        showCoordinates={settings.showCoordinates}
        showLegalMoves={settings.showLegalMoves}
        forceInsideCoordinates
      />
      {promoPending && (
        <PromotionPicker
          onPick={(piece) => {
            const { from, to } = promoPending;
            setPromoPending(null);
            void submit(from, to, piece);
          }}
        />
      )}
    </div>
  );
}
