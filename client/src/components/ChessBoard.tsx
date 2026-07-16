import { useEffect, useRef } from 'react';
import { Chessground } from '@lichess-org/chessground';

type CgApi = ReturnType<typeof Chessground>;
type CgConfig = NonNullable<Parameters<typeof Chessground>[1]>;

export interface ChessBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  viewOnly: boolean;
  turnColor: 'white' | 'black';
  movableColor?: 'white' | 'black';
  dests: Map<string, string[]>;
  /** Premove destinations for the player's own color, computed speculatively
   *  (see chessUtils.computePremoveDests). Pass an empty map to disable premoves
   *  (e.g. for spectators). */
  premoveDests?: Map<string, string[]>;
  /** Square of the king currently in check, or undefined if nobody is. */
  checkSquare?: string;
  /** [from, to] of the most recent move, or undefined if none yet. Passing this
   *  through as a controlled prop on every update is what makes the last-move
   *  highlight track the actual game state instead of getting stuck on whichever
   *  square a player last dragged locally. */
  lastMove?: [string, string];
  onUserMove: (orig: string, dest: string) => void;
}

export function ChessBoard({
  fen,
  orientation,
  viewOnly,
  turnColor,
  movableColor,
  dests,
  premoveDests,
  checkSquare,
  lastMove,
  onUserMove,
}: ChessBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const groundRef = useRef<CgApi | null>(null);
  // Keep the latest callback in a ref so the `after` handler set up once at
  // mount always calls the current version, without needing to recreate the
  // whole chessground instance whenever the parent re-renders.
  const onUserMoveRef = useRef(onUserMove);
  onUserMoveRef.current = onUserMove;

  useEffect(() => {
    if (!containerRef.current) return;
    const config: CgConfig = {
      fen,
      orientation,
      viewOnly,
      turnColor,
      check: checkSquare as any,
      movable: {
        free: false,
        color: movableColor,
        dests: dests as any,
        events: {
          after: (orig: string, dest: string) => onUserMoveRef.current(orig, dest),
        },
      },
      premovable: {
        enabled: !!movableColor,
        showDests: true,
        dests: premoveDests as any,
      },
      lastMove,
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

  useEffect(() => {
    groundRef.current?.set({
      fen,
      orientation,
      viewOnly,
      turnColor,
      lastMove,
      check: checkSquare as any,
      movable: { color: movableColor, dests: dests as any },
      premovable: { enabled: !!movableColor, dests: premoveDests as any },
    });
  }, [fen, orientation, viewOnly, turnColor, movableColor, dests, premoveDests, checkSquare, lastMove]);

  return <div ref={containerRef} className="cg-wrap" />;
}
