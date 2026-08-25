import { RefreshCw } from "lucide-react";

/** Small icon button used on cards that can go slightly stale between
 *  socket events (Open tournaments, Active cage matches, etc.) so a person
 *  can pull the latest state on demand instead of reloading the whole
 *  page, the relevant socket listeners already refresh automatically on
 *  the events that fire server-side, but there's no event for "someone
 *  else's clock just ran out" or similar passive changes, so a manual
 *  button covers the gap. */
export function RefreshButton({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={refreshing}
      aria-label="Refresh"
      className="rounded-lg p-1.5 text-base-content/50 transition-colors hover:bg-base-300/60 hover:text-base-content disabled:opacity-50"
    >
      <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
    </button>
  );
}
