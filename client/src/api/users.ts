import { apiFetch } from './http.js';

export interface UserSearchResult {
  _id: string;
  username: string;
}

export interface UserProfile {
  id: string;
  username: string;
  memberSince: string;
  stats: { wins: number; losses: number; draws: number; gamesPlayed: number };
  isFriend: boolean;
  isSelf: boolean;
  activeGameCode: string | null;
}

export interface UserGameHistoryItem {
  gameId: string;
  joinCode: string;
  opponent: { _id: string; username: string } | null;
  color: 'white' | 'black';
  result: 'win' | 'loss' | 'draw';
  endReason: string | null;
  timeControl: { baseSeconds: number | null; incrementSeconds: number };
  moveCount: number;
  startedAt: string;
  endedAt: string;
}

export interface UserGameHistoryResponse {
  games: UserGameHistoryItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function searchUsers(q: string) {
  return apiFetch<{ users: UserSearchResult[] }>(`/users/search?q=${encodeURIComponent(q)}`);
}

export function getProfile(username: string) {
  return apiFetch<UserProfile>(`/users/${encodeURIComponent(username)}`);
}

export function getUserGames(username: string, page = 1, limit = 20) {
  return apiFetch<UserGameHistoryResponse>(
    `/users/${encodeURIComponent(username)}/games?page=${page}&limit=${limit}`,
  );
}
