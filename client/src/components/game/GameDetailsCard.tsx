import { type ReactNode, type RefObject } from "react";
import { Card } from "../ui/index.js";

interface GameDetailsCardProps {
  badges: ReactNode[];
  gameOver: { result: string | null; reason: string } | null;
  describeResult: (result: string | null) => string;
  connStatus: string;
  zenMode: boolean;
  moveListEntries: ReactNode;
  moveStripEntries: ReactNode;
  moveListScrollRef: RefObject<HTMLDivElement | null>;
}

/** Game details — code, share, badges, status, and the move list. Left
 *  column on desktop; a full-width strip above the board/panel row on
 *  tablet and phone. */
export function GameDetailsCard({
  badges,
  gameOver,
  describeResult,
  connStatus,
  zenMode,
  moveListEntries,
  moveStripEntries,
  moveListScrollRef,
}: GameDetailsCardProps) {
  return (
    <Card variant="solid">
      {/* min-h keeps this row's height stable whether 0 or several
       *  badges are showing — on phone this card is a flex-shrink:0
       *  sibling of the board, so any wobble here directly steals from
       *  or gives back space to the board. */}
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {badges.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">{badges}</div>
          )}
        </div>
        <span className="flex items-center gap-1.5 text-xs font-medium text-base-content/60">
          {!gameOver && (
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          )}
          {gameOver
            ? `Game over — ${describeResult(gameOver.result)} (${gameOver.reason.replace(/_/g, " ")})`
            : connStatus}
        </span>
      </div>

      {!zenMode && (
        <div className="min-h-0 lg:flex lg:flex-col">
          {/* Vertical list — tablet & desktop. */}
          <h2 className="hidden lg:flex mt-3 text-base-content/40 text-sm font-semibold">
            Moves
          </h2>
          <div
            ref={moveListScrollRef}
            className="hidden min-h-0 overflow-y-auto max-h-40 mb-1 pr-1 lg:block lg:flex-1"
          >
            {moveListEntries ?? <></>}
          </div>
          <div className="lg:hidden min-h-7">{moveStripEntries}</div>
        </div>
      )}
    </Card>
  );
}
