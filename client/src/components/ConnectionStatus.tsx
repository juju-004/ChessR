import { useEffect, useRef, useState, memo } from "react";
import { useSocket } from "../contexts/SocketContext.js";
import { Tooltip } from "./ui/Tooltip.js";
import { cn } from "@/lib/cn.js";

type ConnState = "connecting" | "connected" | "reconnecting" | "disconnected";

const PING_INTERVAL_MS = 4000;
const PING_TIMEOUT_MS = 6000;

function dotColor(state: ConnState, latencyMs: number | null): string {
  if (state !== "connected") return "bg-red-500";
  if (latencyMs === null) return "bg-base-300";
  if (latencyMs < 300) return "bg-green-500";
  if (latencyMs < 600) return "bg-amber-500";
  return "bg-red-500";
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
   *  on mobile — no tooltip, label always visible. */
  variant?: "pill" | "row";
  className?: string;
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

  useEffect(() => {
    if (!socket) {
      setState("connecting");
      setLatencyMs(null);
      return;
    }

    function sendPing() {
      if (!socket?.connected) return;
      const sentAt = Date.now();
      if (pingTimeoutRef.current) window.clearTimeout(pingTimeoutRef.current);
      // If a ping never gets an ack back within a reasonable window, treat it
      // as a connection problem rather than leaving a stale "42ms" showing —
      // the socket itself may not have noticed the drop yet.
      pingTimeoutRef.current = window.setTimeout(
        () => setLatencyMs(null),
        PING_TIMEOUT_MS,
      );
      socket.emit("ping:check", sentAt, () => {
        if (pingTimeoutRef.current) window.clearTimeout(pingTimeoutRef.current);
        setLatencyMs(Date.now() - sentAt);
      });
    }

    function onConnect() {
      setState("connected");
      sendPing();
      pingTimerRef.current = window.setInterval(sendPing, PING_INTERVAL_MS);
    }

    function onDisconnect(reason: string) {
      setLatencyMs(null);
      if (pingTimerRef.current) window.clearInterval(pingTimerRef.current);
      // 'io server disconnect' / 'io client disconnect' are deliberate
      // (logout, server kicked us) — anything else is the socket trying to
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
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${dotColor(state, latencyMs)}`}
        />
        <span>{label(state, latencyMs)}</span>
      </div>
    );
  }

  return (
    <Tooltip
      content={
        <>
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${dotColor(state, latencyMs)}`}
          />
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
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${dotColor(state, latencyMs)}`}
        />
        <span className="hidden sm:inline">{label(state, latencyMs)}</span>
      </span>
    </Tooltip>
  );
});
