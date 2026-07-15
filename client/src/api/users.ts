import { apiFetch } from './http.js';

export interface UserSearchResult {
  _id: string;
  username: string;
  rating: number;
}

export interface UserProfile {
  id: string;
  username: string;
  rating: number;
  memberSince: string;
  stats: { gamesPlayed: number; wins: number };
  isFriend: boolean;
  isSelf: boolean;
}

export function searchUsers(q: string) {
  return apiFetch<{ users: UserSearchResult[] }>(`/users/search?q=${encodeURIComponent(q)}`);
}

export function getProfile(username: string) {
  return apiFetch<UserProfile>(`/users/${encodeURIComponent(username)}`);
}
