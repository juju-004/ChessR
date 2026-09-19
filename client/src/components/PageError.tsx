import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, SearchX, WifiOff } from "lucide-react";
import { Card, Button } from "./ui/index.js";
import { cn } from "@/lib/cn.js";

interface PageErrorProps {
  /** The raw error message a page's own load-failure state already has
   *  (e.g. "Tournament not found", or an ApiRequestError's message). Used
   *  to infer which framing to show — see the doc comment below — and
   *  shown verbatim as the body text for anything that doesn't match a
   *  more specific case. */
  message: string;
  /** Extra classes for the outer wrapper, so each page can keep its own
   *  max-width/margin instead of this component hardcoding one that
   *  doesn't fit every context (a full page vs. a card within a page). */
  className?: string;
}

/** True the moment the browser goes offline, reactively (not just a
 *  one-time navigator.onLine read at mount) — the connection can drop or
 *  come back at any point while a page is sitting on an error state. */
function useIsOffline(): boolean {
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && !navigator.onLine,
  );
  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);
  return offline;
}

/**
 * Shared full-page-ish error state — "Tournament not found", "Profile not
 * found", a network failure, or a generic "Something went wrong", each
 * with its own icon/title instead of every page rolling its own plain red
 * card. Which framing shows is inferred from the browser's actual online
 * state (checked live, not just from message text — a "failed to fetch"
 * message never even makes it back from an offline browser in the first
 * place, so the live check is what actually catches most real offline
 * cases) and, failing that, from the message text itself:
 *   - offline right now, or the message itself reads as a network failure
 *     → "No internet connection" / WifiOff
 *   - message reads as a "couldn't find this" case (ends in "not found",
 *     the common shape every not-found error in this app already uses)
 *     → a not-found framing / SearchX, the raw message as the title
 *   - anything else → generic "Something went wrong" / AlertTriangle,
 *     the raw message shown as supporting detail
 * A "Try again" button reloads the page either way, same fallback
 * ErrorBoundary.tsx uses for its own crash screen.
 */
export function PageError({ message, className }: PageErrorProps) {
  const isOffline = useIsOffline();
  const looksNetworkRelated = /network|fetch|offline|connection/i.test(message);
  const showOffline = isOffline || looksNetworkRelated;
  const looksNotFound = !showOffline && /not found$/i.test(message.trim());

  const Icon = showOffline ? WifiOff : looksNotFound ? SearchX : AlertTriangle;
  const title = showOffline
    ? "No internet connection"
    : looksNotFound
      ? message
      : "Something went wrong";
  const detail = showOffline
    ? "Check your connection and try again."
    : looksNotFound
      ? "It may have been moved, deleted, or the link is wrong."
      : message;

  return (
    <Card
      variant="solid"
      className={cn("mx-auto mt-6 max-w-lg text-center", className)}
    >
      <div className="flex flex-col items-center gap-3 py-5">
        <span
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full",
            showOffline
              ? "bg-amber-500/10 text-amber-400"
              : "bg-red-500/10 text-red-400",
          )}
        >
          <Icon className="h-6 w-6" />
        </span>
        <div>
          <p className="font-semibold text-base-content">{title}</p>
          <p className="mt-1 text-sm text-base-content/60">{detail}</p>
        </div>
        <Button
          variant="glass"
          size="sm"
          onClick={() => window.location.reload()}
          className="mt-1"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </Button>
      </div>
    </Card>
  );
}
