import { useEffect, useState } from 'react';
import { getPlatformConfig } from '../api/config.js';

// Module-level cache — the rake rate is operator-set (RAKE_PERCENT in the
// server .env) and effectively static for the lifetime of a page session,
// so every form that needs it (create-game, cage match, tournament) shares
// one fetch instead of each firing its own on mount.
let cached: number | null = null;
let inFlight: Promise<number> | null = null;

function fetchRakePercent(): Promise<number> {
  if (cached !== null) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = getPlatformConfig()
      .then((c) => {
        cached = c.rakePercent;
        return cached;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** The platform's rake percentage, straight from the server .env
 *  (RAKE_PERCENT — see config/env.ts and wallet.service.ts's computeRake
 *  on the server). Returns `null` until it's loaded; forms should treat
 *  that as "don't show the exact split yet" rather than assuming 0. */
export function useRakePercent(): number | null {
  const [percent, setPercent] = useState<number | null>(cached);

  useEffect(() => {
    if (percent !== null) return;
    let cancelled = false;
    fetchRakePercent().then((p) => {
      if (!cancelled) setPercent(p);
    });
    return () => {
      cancelled = true;
    };
  }, [percent]);

  return percent;
}
