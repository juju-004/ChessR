import { apiFetch } from './http.js';

export interface PlatformConfig {
  rakePercent: number;
}

export function getPlatformConfig() {
  return apiFetch<PlatformConfig>('/config');
}
