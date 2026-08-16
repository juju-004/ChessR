import { type ReactNode, type RefObject } from "react";
import { Share2 } from "lucide-react";
import { Card } from "../ui/index.js";

interface GameDetailsCardProps {
  badges: ReactNode[];
  code: string;
  onShare: () => void;
  zenMode: boolean;
  moveListEntries: ReactNode;
  moveStripEntries: ReactNode;
  moveListScrollRef: RefObject<HTMLDivElement | null>;
  // Set once the game's over — a persistent, always-visible "White Wins —
  // Timeout" / "Draw — Stalemate" / "You Won! — Checkmate" line, styled by
  // outcome (win/loss/draw/aborted). Exists specifically so that landing on
  // an already-finished game (replay, spectating, coming back later) still
  // tells you who won and how without having to dig through the move list
  // or reopen the modal — the modal itself only auto-pops the moment a game
  // actually ends, not on every subsequent visit. Clicking it reopens that
  // modal for the full breakdown (rating change, wager payout, rematch).
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
  win: "border-green-900/40 bg-green-950/20 text-green-300 hover:bg-green-950/30",
  loss: "border-red-900/40 bg-red-950/20 text-red-300 hover:bg-red-950/30",
  draw: "border-base-300 bg-base-200/60 text-base-content/80 hover:bg-base-200",
  neutral: "border-base-300 bg-base-200/60 text-base-content/60 hover:bg-base-200",
};

/** Game details — code, share, badges, result, and the move list. Left
 *  column on desktop; a full-width strip above the board/panel row on
 *  tablet and phone. */
export function GameDetailsCard({
  badges,
  code,
  onShare,
  zenMode,
  moveListEntries,
  moveStripEntries,
  moveListScrollRef,
  resultSummary,
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
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-base-content/60">
          <span className="font-mono tracking-wide">{code}</span>
          <button
            type="button"
            onClick={onShare}
            aria-label="Copy game link"
            title="Copy game link"
            className="rounded-md p-1 text-base-content/50 transition-colors hover:bg-base-300/60 hover:text-base-content"
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      {resultSummary && (
        <button
          type="button"
          onClick={resultSummary.onClick}
          className={`mt-2 w-full rounded-lg border px-3 py-1.5 text-left text-sm font-medium transition-colors ${RESULT_TONE_CLASS[resultSummary.tone]}`}
        >
          {resultSummary.text}
        </button>
      )}

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
