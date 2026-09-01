import { apiFetch } from './http.js';

export interface RatingTier {
  name: string;
  min: number;
}

export interface PlatformConfig {
  rakePercent: number;
  ratingTiers: RatingTier[];
}

export function getPlatformConfig() {
  return apiFetch<PlatformConfig>('/config');
}
