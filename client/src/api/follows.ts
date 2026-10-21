import type { RatingCategory } from '../timeControls.js';
import { apiFetch } from './http.js';

/** A player in a following / followers / online list. */
export interface PlayerSummary {
  id: string;
  username: string;
  avatarUrl?: string | null;
  avatarGradient?: string | null;
  rating: number;
  /** Which ladder `rating` (their best) is on, drives the badge color. */
  ratingCategory?: RatingCategory | null;
  online: boolean;
  activeGameCode: string | null;
  /** Whether the viewer follows this player (set on following/followers). */
  isFollowing?: boolean;
}

export function listFollowing() {
  return apiFetch<{ following: PlayerSummary[] }>('/follows/following');
}

export function listFollowers() {
  return apiFetch<{ followers: PlayerSummary[] }>('/follows/followers');
}

export function followUser(userId: string) {
  return apiFetch<{ following: boolean }>('/follows', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export function unfollowUser(userId: string) {
  return apiFetch<void>(`/follows/${userId}`, { method: 'DELETE' });
}
