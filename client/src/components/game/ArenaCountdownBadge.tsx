import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { Badge } from "../ui/index.js";

/** mm:ss under an hour, h:mm:ss at an hour or more — arena tournaments can
 *  run up to 6 hours (see arenaMinutes' max=360 server-side), so this
 *  needs to scale past a plain mm:ss the way chessUtils.ts's formatClock
 *  (built for a per-game chess clock, never more than a few minutes) never
 *  had to. */
function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = minutes.toString().padStart(2, "0");
  const ss = seconds.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Live-ticking "time left in this arena" badge for the in-game page —
 * replaces a one-time-computed static "N min" label (which just showed
 * the tournament's configured duration and never moved) with an actual
 * countdown against the tournament's real `arenaEndsAt` deadline, ticking
 * once a second same as the game's own chess clocks (see PlayerPanels.tsx).
 * `neutral` variant, same muted styling as the time-control badge next to
 * it, rather than the brighter `glass` treatment the tournament/cage-match
 * icon badges use — this one's informational, not a link.
 */
export function ArenaCountdownBadge({ endsAt }: { endsAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const remainingMs = new Date(endsAt).getTime() - now;

  return (
    <Badge variant="neutral">
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Timer className="h-3 w-3" />
        {remainingMs > 0 ? formatCountdown(remainingMs) : "Ending…"}
      </span>
    </Badge>
  );
}
