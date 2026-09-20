import { memo, type ReactNode, type RefObject } from "react";
import { Share2, Users, FileText } from "lucide-react";
import { Card } from "../ui/index.js";
import { Dropdown } from "../ui/Dropdown.js";
import { cn } from "@/lib/cn.js";

interface GameDetailsCardProps {
  badges: ReactNode[];
  code: string;
  onShare: () => void;
  /** Only passed once the game is finished (see Game.tsx) — its presence,
   *  not a separate status prop, is what decides whether Share becomes a
   *  dropdown (Copy PGN + the normal share) or stays the plain button. */
  onCopyPgn?: () => void;
  zenMode: boolean;
  spectatorCount: number;
  moveListEntries: ReactNode;
  moveStripEntries: ReactNode;
  moveListScrollRef: RefObject<HTMLDivElement | null>;
  resultSummary?: {
    text: string;
    tone: "win" | "loss" | "draw" | "neutral";
    onClick: () => void;
  } | null;
}

const RESULT_TONE_CLASS: Record<
  NonNullable<GameDetailsCardProps["resultSummary"]>["tone"],
  string
> = {
  win: "text-green-300",
  loss: "text-red-300",
  draw: "text-base-content/80 ",
  neutral: "text-base-content/60 ",
};

/** Game details, code, share, badges, result, and the move list. Left
 *  column on desktop; a full-width strip above the board/panel row on
 *  tablet and phone.
 *
 *  React.memo'd for the same reason as GameBoardArea, moveListEntries/
 *  moveStripEntries are the actual MoveList/MoveStrip elements built in
 *  Game.tsx, already memoized internally, but this wrapper stops Game's
 *  unrelated re-renders from even reaching this far down the tree. */
export const GameDetailsCard = memo(function GameDetailsCard({
  badges,
  onShare,
  onCopyPgn,
  zenMode,
  spectatorCount,
  moveListEntries,
  moveStripEntries,
  moveListScrollRef,
  resultSummary,
}: GameDetailsCardProps) {
  return (
    <Card variant="solid" className="p-2! sm:p-3!">
      {/* min-h keeps this row's height stable whether 0 or several
       *  badges are showing, on phone this card is a flex-shrink:0
       *  sibling of the board, so any wobble here directly steals from
       *  or gives back space to the board. */}
      {/* min-h keeps this row's height stable whether 0 or several
       *  badges are showing, on phone this card is a flex-shrink:0
       *  sibling of the board, so any wobble here directly steals from
       *  or gives back space to the board.
       *
       *  items-start + no flex-wrap on this outer row (was items-center +
       *  flex-wrap) so the two halves — badges, and spectator-count/Share —
       *  are always side by side on the same first line and never wrap as
       *  whole units; Share getting pushed to its own line once there were
       *  enough badges to fill a phone-width row was exactly that whole-
       *  unit wrapping. The badges group itself still wraps internally
       *  (flex-wrap + min-w-0 so it's actually allowed to shrink below its
       *  content width instead of overflowing), items-start keeps Share
       *  pinned to the top of that group instead of vertically re-centering
       *  against it once it's two lines tall. */}
      <div className="flex min-h-6 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {badges.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">{badges}</div>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-3 text-xs font-medium text-base-content/60">
          {spectatorCount > 0 && (
            <span
              className="flex items-center gap-1"
              title={`${spectatorCount} spectator${spectatorCount === 1 ? "" : "s"} watching`}
            >
              <Users className="h-3.5 w-3.5" /> {spectatorCount}
            </span>
          )}
          {onCopyPgn ? (
            <Dropdown
              trigger={
                <button
                  type="button"
                  aria-label="Share or export game"
                  title="Share or export game"
                  className="rounded-md cursor-pointer flex items-center gap-2 p-1 text-base-content/50 transition-colors hover:bg-base-300/60 hover:text-base-content"
                >
                  <Share2 className="h-3.5 w-3.5" /> Share
                </button>
              }
              items={[
                { label: "Copy PGN", icon: FileText, onClick: onCopyPgn },
                { label: "Share game", icon: Share2, onClick: onShare },
              ]}
            />
          ) : (
            <button
              type="button"
              onClick={onShare}
              aria-label="Copy game link"
              title="Copy game link"
              className="rounded-md cursor-pointer flex items-center gap-2 p-1 text-base-content/50 transition-colors hover:bg-base-300/60 hover:text-base-content"
            >
              <Share2 className="h-3.5 w-3.5" /> Share
            </button>
          )}
        </span>
      </div>

      {resultSummary && (
        <button
          type="button"
          onClick={resultSummary.onClick}
          className={`mt-2 w-full text-center opacity-80 hover:opacity-100  text-sm duration-300 font-bold cursor-pointer ${RESULT_TONE_CLASS[resultSummary.tone]}`}
        >
          {resultSummary.text}
        </button>
      )}

      {!zenMode && (
        <div className="min-h-0 lg:flex lg:flex-col">
          {/* Vertical list, tablet & desktop. */}
          <h2
            className={cn(
              moveListEntries ? "opacity-100" : "opacity-0",
              "hidden lg:flex mt-3 text-base-content/40 text-sm font-semibold",
            )}
          >
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
});
