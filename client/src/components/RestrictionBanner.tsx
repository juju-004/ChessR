import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.js";
import { Card } from "./ui/index.js";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "less than a minute";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Reads suspendedUntil straight off the signed-in user's own object (see
 *  userFields() in auth.controller.ts / suspension.service.ts on the
 *  server), no separate fetch. Ticks once a minute — this is a multi-day
 *  window, not a chess clock, second-level precision would just be
 *  wasted renders. Renders nothing once it's not set or has passed;
 *  the next token refresh / /auth/me call naturally clears it server-side
 *  once the restriction actually lifts. */
export function RestrictionBanner() {
  const { user } = useAuth();
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!user?.suspendedUntil) return;
    const interval = window.setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => window.clearInterval(interval);
  }, [user?.suspendedUntil]);

  if (!user?.suspendedUntil) return null;
  const remainingMs = new Date(user.suspendedUntil).getTime() - Date.now();
  if (remainingMs <= 0) return null;

  return (
    <Card
      variant="solid"
      className="flex items-start gap-3 border-amber-500/30 bg-amber-500/10"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
        <ShieldAlert className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-base-content">
          You're temporarily restricted from playing and chatting
        </p>
        <p className="mt-0.5 text-xs text-base-content/60">
          Ends in {formatRemaining(remainingMs)}. Your wallet is unaffected — deposits and
          withdrawals still work as normal.
        </p>
      </div>
    </Card>
  );
}
