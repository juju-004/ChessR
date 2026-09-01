import { useEffect, useState } from "react";
import { fetchPlatformConfig, getCachedPlatformConfig } from "./platformConfigCache.js";
import type { RatingTier } from "../api/config.js";

/** The public rank tier ladder (name + minimum threshold), straight from
 *  the server's RATING_TIERS (see rating.service.ts). The hidden rating
 *  number itself is never exposed, only where these public boundaries
 *  sit, for the "what do the badges mean" help tip next to RatingBadge.
 *  Returns `null` until it's loaded. */
export function useRatingTiers(): RatingTier[] | null {
  const [tiers, setTiers] = useState<RatingTier[] | null>(
    getCachedPlatformConfig()?.ratingTiers ?? null,
  );

  useEffect(() => {
    if (tiers !== null) return;
    let cancelled = false;
    fetchPlatformConfig().then((c) => {
      if (!cancelled) setTiers(c.ratingTiers);
    });
    return () => {
      cancelled = true;
    };
  }, [tiers]);

  return tiers;
}
