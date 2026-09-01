import { getPlatformConfig, type PlatformConfig } from "../api/config.js";

// Module-level cache, the whole platform config (rake %, rating tier
// ladder, ...) is operator-set and effectively static for the lifetime of
// a page session, so every hook that needs a piece of it shares one fetch
// instead of each firing its own request to /config on mount.
let cached: PlatformConfig | null = null;
let inFlight: Promise<PlatformConfig> | null = null;

export function fetchPlatformConfig(): Promise<PlatformConfig> {
  if (cached !== null) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = getPlatformConfig()
      .then((c) => {
        cached = c;
        return cached;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function getCachedPlatformConfig(): PlatformConfig | null {
  return cached;
}
