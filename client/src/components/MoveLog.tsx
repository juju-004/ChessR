import { memo, type RefObject } from "react";

export interface MoveLogEntry {
  moveNumber: number;
  san: string;
  from: string;
  to: string;
  /** Reconstructed client-side (see reconstructPlyClocks in chessUtils.ts)
   *  from move timestamps + the game's time control — not present until
   *  Game.tsx has enough data to compute it (e.g. an untimed game, or
   *  moves missing a timestamp), so always optional here. */
  remainingMs?: number | null;
  thinkTimeMs?: number | null;
}

interface MoveLogProps {
  moves: MoveLogEntry[];
  currentPly: number;
  onSelectMove: (ply: number) => void;
}

/** Compact "Xs" think-time label — 1 decimal under 10s (so a 2.4s vs a
 *  7.8s move are still distinguishable at a glance), whole seconds above
 *  that (nobody needs decimal precision on a 45s think). */
function formatThink(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

/** How "slow" a move needs to be, relative to the slowest move actually
 *  played this game, before it's worth calling out visually — below this
 *  ratio it's just normal variance, not something worth an eye drawn to
 *  it. Also gated on the slowest move being at least 4s in the first
 *  place, so a fast bullet game where every move is 1-2s doesn't get
 *  every single move highlighted just because SOME move was relatively
 *  the slowest of a uniformly-fast bunch. */
const SLOW_MOVE_RATIO = 0.6;
const SLOW_MOVE_FLOOR_MS = 4000;

function computeSlowMoveThreshold(moves: MoveLogEntry[]): number | null {
  const maxThinkMs = moves.reduce(
    (max, m) => Math.max(max, m.thinkTimeMs ?? 0),
    0,
  );
  if (maxThinkMs < SLOW_MOVE_FLOOR_MS) return null;
  return maxThinkMs * SLOW_MOVE_RATIO;
}

/** Vertical two-column move list — tablet & desktop.
 *
 *  Pulled out of Game.tsx (which was building this JSX inline on every
 *  render) and wrapped in React.memo. The page holds a lot of state that
 *  has nothing to do with the move list — chat input, move errors,
 *  rematch offers — and every one of those updates was rebuilding every
 *  move button in a potentially long game from scratch just because the
 *  parent re-rendered, not because `moves` actually changed. That's
 *  wasted main-thread work at exactly the moment (mid-game, on a low-end
 *  phone) it's least affordable. */
export const MoveList = memo(function MoveList({ moves, currentPly, onSelectMove }: MoveLogProps) {
  if (moves.length === 0) return null;
  const slowThresholdMs = computeSlowMoveThreshold(moves);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-sm text-base-content/80">
      {moves.map((m) => {
        const isWhiteMove = m.moveNumber % 2 === 1;
        const active = m.moveNumber === currentPly;
        const isSlow =
          slowThresholdMs !== null &&
          (m.thinkTimeMs ?? 0) >= slowThresholdMs;
        return (
          <button
            key={m.moveNumber}
            type="button"
            onClick={() => onSelectMove(m.moveNumber)}
            title={
              m.thinkTimeMs != null ? `Thought for ${formatThink(m.thinkTimeMs)}` : undefined
            }
            className={`flex items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-base-300/60 ${
              active ? "bg-(--primary)/15 font-semibold text-(--primary)" : ""
            }`}
          >
            <span>
              {isWhiteMove && (
                <span className="text-base-content/40">{Math.ceil(m.moveNumber / 2)}. </span>
              )}
              {m.san}
            </span>
            {m.thinkTimeMs != null && (
              <span
                className={`text-[10px] tabular-nums ${
                  isSlow && !active
                    ? "text-amber-500"
                    : active
                      ? "text-(--primary)/70"
                      : "text-base-content/35"
                }`}
              >
                {formatThink(m.thinkTimeMs)}
              </span>
            )}
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
  const slowThresholdMs = computeSlowMoveThreshold(moves);
  return (
    <div ref={scrollRef} className="flex gap-1.5 overflow-x-auto pb-0.5">
      {moves.map((m) => {
        const isWhiteMove = m.moveNumber % 2 === 1;
        const active = m.moveNumber === currentPly;
        const isSlow =
          slowThresholdMs !== null &&
          (m.thinkTimeMs ?? 0) >= slowThresholdMs;
        return (
          <button
            key={m.moveNumber}
            type="button"
            onClick={() => onSelectMove(m.moveNumber)}
            title={
              m.thinkTimeMs != null ? `Thought for ${formatThink(m.thinkTimeMs)}` : undefined
            }
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
            {m.thinkTimeMs != null && (
              <span
                className={`ml-1 ${
                  isSlow && !active ? "text-amber-500" : "text-base-content/35"
                }`}
              >
                {formatThink(m.thinkTimeMs)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});
