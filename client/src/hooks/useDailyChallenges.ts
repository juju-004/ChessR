import { useCallback, useEffect, useRef, useState } from "react";
import { getDailyChallenges, type DailyChallengeState } from "../api/dailyChallenges.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useTokenBalance } from "./useTokenBalance.js";
import { errMsg } from "../lib/errMsg.js";

/** Today's daily challenges, kept fresh: pushed over the socket when progress
 *  changes (dailyChallenges:updated), refetched when the tab becomes visible
 *  again, and refetched at midnight when a new day begins. */
export function useDailyChallenges() {
  const socket = useSocket();
  const { refresh: refreshBalance } = useTokenBalance();
  const [state, setState] = useState<DailyChallengeState | null>(null);
  const [error, setError] = useState("");
  /** Local time the state arrived, to count the reset timer down from. */
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const midnightTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const next = await getDailyChallenges();
      setState(next);
      setFetchedAt(Date.now());
      setError("");
      window.clearTimeout(midnightTimer.current);
      // A new day starts the moment this one ends; pick it up without a reload.
      midnightTimer.current = window.setTimeout(() => void load(), next.msUntilReset + 1500);
    } catch (err) {
      setError(errMsg(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(midnightTimer.current);
    };
  }, [load]);

  useEffect(() => {
    if (!socket) return;
    const s = socket;
    const onUpdated = () => {
      void load();
      refreshBalance().catch(() => {}); // a finished day pays coins
    };
    s.on("dailyChallenges:updated", onUpdated);
    return () => {
      s.off("dailyChallenges:updated", onUpdated);
    };
  }, [socket, load, refreshBalance]);

  return { state, error, fetchedAt, reload: load };
}

/** "5h 12m" / "42m" / "<1m" from a millisecond count. */
export function formatCountdown(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return totalMin > 0 ? `${m}m` : "<1m";
}
