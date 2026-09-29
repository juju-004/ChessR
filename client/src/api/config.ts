import { apiFetch } from './http.js';

export interface RatingTier {
  name: string;
  min: number;
}

export interface QuickPairingSegment {
  id: string;
  /** e.g. "1+0" */
  label: string;
  /** e.g. "Bullet" */
  categoryLabel: string;
  baseMinutes: number;
  incrementSeconds: number;
  variant: 'standard' | 'chess960';
}

export interface PlatformConfig {
  rakePercent: number;
  ratingTiers: RatingTier[];
  quickPairingSegments: QuickPairingSegment[];
}

export function getPlatformConfig() {
  return apiFetch<PlatformConfig>('/config');
}
