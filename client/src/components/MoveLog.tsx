import { memo, type RefObject } from "react";

export interface MoveLogEntry {
  moveNumber: number;
  san: string;
  from: string;
  to: string;
}

interface MoveLogProps {
  moves: MoveLogEntry[];
  currentPly: number;
  onSelectMove: (ply: number) => void;
}

/** Vertical two-column move list — tablet & desktop.
 *
 *  Pulled out of Game.tsx/GameReplay.tsx (which were building this JSX
 *  inline on every render) and wrapped in React.memo. Both pages hold a lot
 *  of state that has nothing to do with the move list — chat input, move
 *  errors, rematch offers — and every one of those updates was rebuilding
 *  every move button in a potentially long game from scratch just because
 *  the parent re-rendered, not because `moves` actually changed. That's
 *  wasted main-thread work at exactly the moment (mid-game, on a low-end
 *  phone) it's least affordable. */
export const MoveList = memo(function MoveList({ moves, currentPly, onSelectMove }: MoveLogProps) {
  if (moves.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-sm text-base-content/80">
      {moves.map((m) => {
        const isWhiteMove = m.moveNumber % 2 === 1;
        const active = m.moveNumber === currentPly;
        return (
          <button
            key={m.moveNumber}
            type="button"
            onClick={() => onSelectMove(m.moveNumber)}
            className={`rounded px-1 py-0.5 text-left transition-colors hover:bg-base-300/60 ${
              active ? "bg-(--primary)/15 font-semibold text-(--primary)" : ""
            }`}
          >
            {isWhiteMove && (
              <span className="text-base-content/40">{Math.ceil(m.moveNumber / 2)}. </span>
            )}
            {m.san}
          </button>
        );
      })}
    </div>
  );
});

interface MoveStripProps extends MoveLogProps {
  scrollRef?: RefObject<HTMLDivElement | null>;
}

/** Phone-only: the same move log as a single horizontally-scrolling row of
 *  move "pills". Same rationale for extraction/memoization as MoveList. */
export const MoveStrip = memo(function MoveStrip({
  moves,
  currentPly,
  onSelectMove,
  scrollRef,
}: MoveStripProps) {
  if (moves.length === 0) return null;
  return (
    <div ref={scrollRef} className="flex gap-1.5 overflow-x-auto pb-0.5">
      {moves.map((m) => {
        const isWhiteMove = m.moveNumber % 2 === 1;
        const active = m.moveNumber === currentPly;
        return (
          <button
            key={m.moveNumber}
            type="button"
            onClick={() => onSelectMove(m.moveNumber)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-2 py-1 font-mono text-xs transition-colors ${
              active
                ? "bg-(--primary)/20 font-semibold text-(--primary)"
                : "bg-base-300/60 text-base-content/80"
            }`}
          >
            {isWhiteMove && (
              <span className="text-base-content/40">{Math.ceil(m.moveNumber / 2)}. </span>
            )}
            {m.san}
          </button>
        );
      })}
    </div>
  );
});
