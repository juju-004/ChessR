import { useEffect, useState } from 'react';
import { fetchPlatformConfig, getCachedPlatformConfig } from './platformConfigCache.js';

/** The platform's rake percentage, straight from the server .env
 *  (RAKE_PERCENT, see config/env.ts and wallet.service.ts's computeRake
 *  on the server). Returns `null` until it's loaded; forms should treat
 *  that as "don't show the exact split yet" rather than assuming 0. */
export function useRakePercent(): number | null {
  const [percent, setPercent] = useState<number | null>(
    getCachedPlatformConfig()?.rakePercent ?? null,
  );

  useEffect(() => {
    if (percent !== null) return;
    let cancelled = false;
    fetchPlatformConfig().then((c) => {
      if (!cancelled) setPercent(c.rakePercent);
    });
    return () => {
      cancelled = true;
    };
  }, [percent]);

  return percent;
}

