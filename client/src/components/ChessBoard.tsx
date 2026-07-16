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
      movable: {
        free: false,
        color: movableColor,
        dests: dests as any,
        events: {
          after: (orig: string, dest: string) => onUserMoveRef.current(orig, dest),
        },
      },
      lastMove,
    };
    groundRef.current = Chessground(containerRef.current, config);
    return () => {
      groundRef.current?.destroy();
      groundRef.current = null;
    };
    // Intentionally empty deps — chessground is created once; all subsequent
    // updates flow through the .set() call in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    groundRef.current?.set({
      fen,
      orientation,
      viewOnly,
      turnColor,
      lastMove,
      movable: { color: movableColor, dests: dests as any },
    });
  }, [fen, orientation, viewOnly, turnColor, movableColor, dests, lastMove]);

  return <div ref={containerRef} className="cg-wrap" />;
}
