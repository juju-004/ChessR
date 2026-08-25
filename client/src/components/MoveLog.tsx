import { memo, type RefObject } from "react";

export interface MoveLogEntry {
  moveNumber: number;
  san: string;
  from: string;
  to: string;
  /** Reconstructed client-side (see reconstructPlyClocks in chessUtils.ts)
   *  from move timestamps + the game's time control, not present until
   *  Game.tsx has enough data to compute it (e.g. an untimed game, or
   *  moves missing a timestamp), so always optional here. Kept on the
   *  type even though MoveList/MoveStrip below no longer render it (the
   *  move list no longer shows per-move think-time at all). PlayerPanels'
   *  clock reconstruction still consumes it. */
  remainingMs?: number | null;
  thinkTimeMs?: number | null;
}

interface MoveLogProps {
  moves: MoveLogEntry[];
  currentPly: number;
  onSelectMove: (ply: number) => void;
}

interface MoveButtonProps {
  moveNumber: number;
  san: string;
  active: boolean;
  onSelectMove: (ply: number) => void;
}

/** A single entry in the vertical move list. Memoized on its own props
 *  (not the whole `moves`/`currentPly` pair) so that stepping through a
 *  game via Prev/Next only re-renders the (at most) two buttons whose
 *  `active` flag actually flipped, instead of every move button in the
 *  game re-diffing on every single step, the thing that made move
 *  navigation feel laggy in a long game on a low-end phone. This only
 *  pays off because `onSelectMove` is a stable reference (see Game.tsx's
 *  goToPly, which is ref-based specifically so this memo isn't defeated
 *  by a new callback identity every render). */
const MoveButton = memo(function MoveButton({
  moveNumber,
  san,
  active,
  onSelectMove,
}: MoveButtonProps) {
  const isWhiteMove = moveNumber % 2 === 1;
  return (
    <button
      type="button"
      onClick={() => onSelectMove(moveNumber)}
      className={`flex items-baseline gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-base-300/60 ${
        active ? "bg-(--primary)/15 font-semibold text-(--primary)" : ""
      }`}
    >
      {isWhiteMove && (
        <span className="text-base-content/40">{Math.ceil(moveNumber / 2)}. </span>
      )}
      {san}
    </button>
  );
});

/** Vertical two-column move list, tablet & desktop.
 *
 *  Pulled out of Game.tsx (which was building this JSX inline on every
 *  render) and wrapped in React.memo. The page holds a lot of state that
 *  has nothing to do with the move list, chat input, move errors,
 *  rematch offers, and every one of those updates was rebuilding every
 *  move button in a potentially long game from scratch just because the
 *  parent re-rendered, not because `moves` actually changed. That's
 *  wasted main-thread work at exactly the moment (mid-game, on a low-end
 *  phone) it's least affordable.
 *
 *  This outer component still re-renders on every `currentPly` change
 *  (it has to, that's the trigger), but the map below just iterates and
 *  hands each row the same or a changed `active` prop; the actual DOM
 *  work is contained to whichever individual MoveButtons see a real
 *  `active` change, thanks to their own memo boundary above. */
export const MoveList = memo(function MoveList({ moves, currentPly, onSelectMove }: MoveLogProps) {
  if (moves.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-sm text-base-content/80">
      {moves.map((m) => (
        <MoveButton
          key={m.moveNumber}
          moveNumber={m.moveNumber}
          san={m.san}
          active={m.moveNumber === currentPly}
          onSelectMove={onSelectMove}
        />
      ))}
    </div>
  );
});

interface MoveChipProps extends MoveButtonProps {}

/** Same memoization rationale as MoveButton above, for the phone-only
 *  horizontal strip variant. */
const MoveChip = memo(function MoveChip({
  moveNumber,
  san,
  active,
  onSelectMove,
}: MoveChipProps) {
  const isWhiteMove = moveNumber % 2 === 1;
  return (
    <button
      type="button"
      onClick={() => onSelectMove(moveNumber)}
      className={`shrink-0 whitespace-nowrap rounded-lg px-2 py-1 font-mono text-xs transition-colors ${
        active
          ? "bg-(--primary)/20 font-semibold text-(--primary)"
          : "bg-base-300/60 text-base-content/80"
      }`}
    >
      {isWhiteMove && (
        <span className="text-base-content/40">{Math.ceil(moveNumber / 2)}. </span>
      )}
      {san}
    </button>
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
      {moves.map((m) => (
        <MoveChip
          key={m.moveNumber}
          moveNumber={m.moveNumber}
          san={m.san}
          active={m.moveNumber === currentPly}
          onSelectMove={onSelectMove}
        />
      ))}
    </div>
  );
});
