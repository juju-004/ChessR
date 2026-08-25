import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}

/** Compact prev/current/next pager for client-side-paginated lists, used
 *  by the Open tournaments / Finished tourneys lists (which fetch their
 *  full set in one request, see Tournaments.tsx) and the cage match
 *  history list (see CageMatches.tsx). Not rendered at all for a single
 *  page. */
export function Pagination({ page, pageCount, onPageChange }: PaginationProps) {
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
      <span className="text-xs text-base-content/50">
        Page {page + 1} of {pageCount}
      </span>
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
