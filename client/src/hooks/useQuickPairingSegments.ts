import { useEffect, useState } from "react";
import { fetchPlatformConfig, getCachedPlatformConfig } from "./platformConfigCache.js";
import type { QuickPairingSegment } from "../api/config.js";

/** The quick-pairing lobbies (id, label, time control, variant), straight
 *  from the server's QUICK_PAIRING_SEGMENTS so the two can't drift.
 *  Returns `null` until loaded. */
export function useQuickPairingSegments(): QuickPairingSegment[] | null {
  const [segments, setSegments] = useState<QuickPairingSegment[] | null>(
    getCachedPlatformConfig()?.quickPairingSegments ?? null,
  );

  useEffect(() => {
    if (segments !== null) return;
    let cancelled = false;
    fetchPlatformConfig().then((c) => {
      if (!cancelled) setSegments(c.quickPairingSegments);
    });
    return () => {
      cancelled = true;
    };
  }, [segments]);

  return segments;
}
