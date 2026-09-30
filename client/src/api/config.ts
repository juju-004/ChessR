import { apiFetch } from './http.js';

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
  quickPairingSegments: QuickPairingSegment[];
}

export function getPlatformConfig() {
  return apiFetch<PlatformConfig>('/config');
}
