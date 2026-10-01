import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Wraps the current page number in a small rounded-square badge
   *  instead of bare text. Off by default so every other pager keeps its
   *  plain look; the standings table opts in. */
  badge?: boolean;
}

/** Compact prev/current/next pager for client-side-paginated lists, used
 *  by the Open tournaments / Finished tourneys lists (which fetch their
 *  full set in one request, see Tournaments.tsx) and the cage match
 *  history list (see CageMatches.tsx). Not rendered at all for a single
 *  page. */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  badge = false,
}: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-1">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page === 0}
        aria-label="Previous page"
        className="rounded-lg p-1.5 text-base-content/60 transition-colors hover:bg-base-300/60 disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {/* Full "Page X of Y" on wider screens; just the bare number on
       *  mobile between the two arrows (David: shrink it to "< 1 >"),
       *  where the surrounding chevrons already make "page" and "of N"
       *  redundant and the fuller text was cramping tighter layouts like
       *  the standings table header. */}
      {badge ? (
        <span className="flex items-center gap-1.5 text-xs text-base-content/50">
          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-[10px] bg-base-300/70 px-1.5 text-xs font-bold tabular-nums text-base-content">
            {page + 1}
          </span>
          <span className="hidden sm:inline">of {pageCount}</span>
        </span>
      ) : (
        <>
          <span className="hidden text-xs text-base-content/50 sm:inline">
            Page {page + 1} of {pageCount}
          </span>
          <span className="text-xs text-base-content/50 sm:hidden">
            {page + 1}
          </span>
        </>
      )}
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page === pageCount - 1}
        aria-label="Next page"
        className="rounded-lg p-1.5 text-base-content/60 transition-colors hover:bg-base-300/60 disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
