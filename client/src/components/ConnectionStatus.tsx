import { useEffect, useRef, useState, memo } from "react";
import { useSocket } from "../contexts/SocketContext.js";
import { Tooltip } from "./ui/Tooltip.js";
import { cn } from "@/lib/cn.js";

type ConnState = "connecting" | "connected" | "reconnecting" | "disconnected";

// Lichess pings roughly every 2s and displays a smoothed reading rather
// than the raw last round-trip, a single slow sample (a GC pause, a wifi
// blip) shouldn't make the dot/number jump around on its own. Matched here:
// a 2s cadence with an exponential moving average over the last several
// samples instead of the previous 4s interval showing the bare last value.
const PING_INTERVAL_MS = 2000;
const PING_TIMEOUT_MS = 6000;
// Weight given to each new sample in the running average, lower is
// smoother/slower to react, higher tracks the latest sample more closely.
// 0.3 settles within ~4-5 samples (~10s) of a step change, which is
// responsive enough to reflect "connection got bad" quickly while still
// ironing out single-sample noise.
const LATENCY_EMA_ALPHA = 0.3;

function signalColor(state: ConnState, latencyMs: number | null): string {
  if (state !== "connected") return "text-red-500";
  if (latencyMs === null) return "text-base-content/30";
  if (latencyMs < 300) return "text-green-500";
  if (latencyMs < 600) return "text-amber-500";
  return "text-red-500";
}

function label(state: ConnState, latencyMs: number | null): string {
  if (state === "connecting") return "Connecting…";
  if (state === "reconnecting") return "Reconnecting…";
  if (state === "disconnected") return "Offline";
  return latencyMs === null ? "Connected" : `${latencyMs}ms`;
}

interface ConnectionStatusProps {
  /** "pill" (default) is the elevated pill used in the navbar. "row" is a
   *  plain menu-item-style row, sized to slot into AccountMenu's dropdown
   *  on mobile, no tooltip, label always visible. */
  variant?: "pill" | "row";
  className?: string;
}

/** Three ascending bars, like a phone's signal-strength glyph. Always
 *  shown at full "strength" (all three bars filled), it's the current
 *  color, not the bar heights, that communicates connection quality, see
 *  signalColor above, so this stays a single static shape rather than
 *  swapping between 1/2/3-bar variants. */
function SignalBarsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect x="1" y="9" width="3.5" height="6" rx="1" fill="currentColor" />
      <rect x="6.25" y="5.5" width="3.5" height="9.5" rx="1" fill="currentColor" />
      <rect x="11.5" y="1" width="3.5" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

export const ConnectionStatus = memo(function ConnectionStatus({
  variant = "pill",
  className,
}: ConnectionStatusProps) {
  const socket = useSocket();
  const [state, setState] = useState<ConnState>("connecting");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const pingTimeoutRef = useRef<number | null>(null);
  // The running average itself, kept in a ref (not state) since it's
  // purely internal bookkeeping for sendPing's own next calculation, not
  // something anything needs to read/react to directly. Reset to null on
  // disconnect so a reconnect starts fresh instead of averaging in a stale
  // pre-drop reading.
  const smoothedLatencyRef = useRef<number | null>(null);

  useEffect(() => {
    if (!socket) {
      setState("connecting");
      setLatencyMs(null);
      smoothedLatencyRef.current = null;
      return;
    }

    function sendPing() {
      if (!socket?.connected) return;
      const sentAt = Date.now();
      if (pingTimeoutRef.current) window.clearTimeout(pingTimeoutRef.current);
      // If a ping never gets an ack back within a reasonable window, treat it
      // as a connection problem rather than leaving a stale "42ms" showing, 
      // the socket itself may not have noticed the drop yet.
      pingTimeoutRef.current = window.setTimeout(() => {
        smoothedLatencyRef.current = null;
        setLatencyMs(null);
      }, PING_TIMEOUT_MS);
      socket.emit("ping:check", sentAt, () => {
        if (pingTimeoutRef.current) window.clearTimeout(pingTimeoutRef.current);
        const sample = Date.now() - sentAt;
        const prev = smoothedLatencyRef.current;
        const next =
          prev === null
            ? sample
            : Math.round(prev + LATENCY_EMA_ALPHA * (sample - prev));
        smoothedLatencyRef.current = next;
        setLatencyMs(next);
      });
    }

    function onConnect() {
      setState("connected");
      smoothedLatencyRef.current = null;
      sendPing();
      pingTimerRef.current = window.setInterval(sendPing, PING_INTERVAL_MS);
    }

    function onDisconnect(reason: string) {
      setLatencyMs(null);
      smoothedLatencyRef.current = null;
      if (pingTimerRef.current) window.clearInterval(pingTimerRef.current);
      // 'io server disconnect' / 'io client disconnect' are deliberate
      // (logout, server kicked us), anything else is the socket trying to
      // recover on its own, which is what "reconnecting" should communicate.
      setState(
        reason === "io server disconnect" || reason === "io client disconnect"
          ? "disconnected"
          : "reconnecting",
      );
    }

    function onReconnectAttempt() {
      setState("reconnecting");
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_attempt", onReconnectAttempt);

    if (socket.connected) onConnect();
    else setState("connecting");

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      if (pingTimerRef.current) window.clearInterval(pingTimerRef.current);
      if (pingTimeoutRef.current) window.clearTimeout(pingTimeoutRef.current);
    };
  }, [socket]);

  if (variant === "row") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-base-content/60",
          className,
        )}
      >
        <SignalBarsIcon className={cn("h-3.5 w-3.5 shrink-0", signalColor(state, latencyMs))} />
        <span>{label(state, latencyMs)}</span>
      </div>
    );
  }

  return (
    <Tooltip
      content={
        <>
          <SignalBarsIcon className={cn("h-3.5 w-3.5 shrink-0", signalColor(state, latencyMs))} />
          <span>{label(state, latencyMs)}</span>
        </>
      }
      side="bottom"
      className="md:hidden"
    >
      <span
        className={cn(
          "elevated flex h-9 items-center gap-1.5 rounded-full px-3 text-xs text-base-content/70",
          className,
        )}
        title={
          state === "connected"
            ? `Connected${latencyMs !== null ? ` · ${latencyMs}ms round trip` : ""}`
            : label(state, latencyMs)
        }
      >
        <SignalBarsIcon className={cn("h-3.5 w-3.5 shrink-0", signalColor(state, latencyMs))} />
        <span className="hidden sm:inline">{label(state, latencyMs)}</span>
      </span>
    </Tooltip>
  );
});
