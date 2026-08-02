import { useLayoutEffect, useRef, useState } from 'react';
import { Chessground } from '@lichess-org/chessground';
import { Key } from '@lichess-org/chessground/types';

type CgApi = ReturnType<typeof Chessground>;
type CgConfig = NonNullable<Parameters<typeof Chessground>[1]>;

export interface ChessBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  viewOnly: boolean;
  turnColor: 'white' | 'black';
  movableColor?: 'white' | 'black';
  dests: Map<string, string[]>;
  /** Premove destinations, keyed by origin square — maps to chessground's
   *  `premovable.customDests` (confirmed via source: same Map<Key,Key[]> shape
   *  as movable.dests, despite some docs/forks describing a flat array). */
  premoveDests?: Map<string, string[]>;
  /** Whether the side to move (turnColor) is currently in check. Chessground
   *  resolves this to an actual king square internally using its own piece
   *  data — it does NOT accept a square string here. */
  inCheck?: boolean;
  /** [from, to] of the most recent move, or undefined if none yet. Passing this
   *  through as a controlled prop on every update is what makes the last-move
   *  highlight track the actual game state instead of getting stuck on whichever
   *  square a player last dragged locally. */
  lastMove?: [string, string];
  onUserMove: (orig: string, dest: string) => void;
  /** Settings-page toggles — all optional so existing callers keep working
   *  with chessground's own sensible defaults. */
  animationEnabled?: boolean;
  showCoordinates?: boolean;
  showLegalMoves?: boolean;
}

export function ChessBoard({
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
  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const groundRef = useRef<CgApi | null>(null);
  const onUserMoveRef = useRef(onUserMove);
  onUserMoveRef.current = onUserMove;

  // Chessground lays out its 8x8 grid from this container's raw pixel
  // size. The parent boxes this in with fluid CSS (aspect-square, flex,
  // %-based widths) rather than a fixed pixel size, so the measured width
  // is essentially never an exact multiple of 8 — each square works out
  // to something like 54.625px. The square/piece grid itself gets pixel-
  // snapped internally, but the rank/file coordinate labels are drawn
  // with independent CSS percentages, so the two drift apart by a
  // fraction of a pixel per square — small on square one, visibly off by
  // the far edge of the board. That's the "board numbers always tend to
  // be misaligned" bug. Snapping the mounted box down to the nearest
  // multiple of 8 makes every square (and therefore every coordinate
  // label) land on a whole pixel, so nothing can drift.
  const [boardSize, setBoardSize] = useState(0);
  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    function measure() {
      const box = outer!.getBoundingClientRect();
      const side = Math.floor(Math.min(box.width, box.height) / 8) * 8;
      setBoardSize(side);
    }
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(outer);
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
          after: (orig: string, dest: string) => onUserMoveRef.current(orig, dest),
        },
      },
      // ================= PREMOVE LOGIC =================
      // This `premovable` block is what actually arms a premove on the board:
      // chessground lets the player drag a piece even when it's not their
      // turn, holds that move client-side, then auto-plays it (firing
      // `movable.events.after` itself, same as a normal move) the instant
      // the position updates to make it legal. `customDests` restricts which
      // squares are offered, computed by computePremoveDests in chessUtils.ts.
      premovable: {
        enabled: !!movableColor,
        showDests: true,
        customDests: premoveDests as any,
      },
      // =============== END PREMOVE LOGIC ================
      lastMove: lastMove as Key[] | undefined,
    };
    groundRef.current = Chessground(containerRef.current, config);
    return () => {
      groundRef.current?.destroy();
      groundRef.current = null;
    };
    // `viewOnly` is deliberately the only reactive dependency here: chessground's
    // own docs state .set() accepts "all config options, except for viewOnly" —
    // it's baked in at construction time and silently ignored on every later
    // .set() call. The board's first render always happens before we know
    // whether the user is a player (that arrives via game:sync moments later),
    // so viewOnly starts true and must trigger a full rebuild when it flips.
    // `boardSize === 0` gates the very first (unmeasured) pass so chessground
    // never constructs against a 0x0 box; `boardSize > 0` (not the numeric
    // value itself) is what's actually in the deps array so later resizes
    // — handled by the redrawAll effect below — don't tear down and rebuild
    // the whole instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewOnly, boardSize > 0]);

  useLayoutEffect(() => {
    groundRef.current?.set({
      fen,
      orientation,
      viewOnly,
      turnColor,
      lastMove: lastMove as Key[] | undefined,
      check: inCheck,
      coordinates: showCoordinates,
      animation: { enabled: animationEnabled, duration: 200 },
      movable: { color: movableColor, dests: dests as any, showDests: showLegalMoves },
      // PREMOVE LOGIC: keep the armed-premove config in sync on every re-render.
      premovable: { enabled: !!movableColor, customDests: premoveDests as any },
    });

    // PREMOVE LOGIC: chessground only *stores* a premove when you drag a
    // piece out of turn (that's what arms the ghost piece/highlight) — it
    // does not execute it on its own. `.playPremove()` must be called
    // explicitly after every position update so it can (re)validate the
    // queued premove against the fresh `movable.dests`/turnColor set just
    // above, and fire `movable.events.after` (→ onUserMove) if it's still
    // legal. This runs after every fen/turnColor change, i.e. after both the
    // opponent's move and our own — it's a safe no-op when nothing is queued.
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
    <div ref={outerRef} className="flex h-full w-full items-center justify-center">
      <div
        ref={containerRef}
        className="cg-wrap"
        style={{ width: boardSize || '100%', height: boardSize || '100%' }}
      />
    </div>
  );
}
