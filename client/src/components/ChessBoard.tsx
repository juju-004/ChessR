import { useLayoutEffect, useRef } from 'react';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const groundRef = useRef<CgApi | null>(null);
  const onUserMoveRef = useRef(onUserMove);
  onUserMoveRef.current = onUserMove;

  useLayoutEffect(() => {
    if (!containerRef.current) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewOnly]);

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

  return <div ref={containerRef} className="cg-wrap" />;
}
