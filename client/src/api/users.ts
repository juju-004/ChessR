import { apiFetch } from './http.js';
import type { Friend } from './friends.js';

export interface UserSearchResult {
  _id: string;
  username: string;
  avatarUrl?: string | null;
  avatarGradient?: string | null;
  rating: number;
  /** Whether they're connected right now (needed to challenge them). */
  online: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  avatarUrl?: string | null;
  avatarGradient?: string | null;
  bio?: string | null;
  memberSince: string;
  rating: number;
  stats: { wins: number; losses: number; draws: number; gamesPlayed: number };
  isFriend: boolean;
  isSelf: boolean;
  activeGameCode: string | null;
  /** Same online/offline presence the friends list (Players.tsx) shows via
   *  Avatar's status prop — a snapshot as of when this profile was
   *  fetched, kept live afterward only for friends (see Profile.tsx's
   *  friend:presence listener; that event is only ever broadcast to
   *  friends, so a stranger's dot won't update again until the page is
   *  reloaded). Always true for isSelf. */
  online: boolean;
  /** Viewer's record against this profile's owner, null if not logged in,
   *  viewing your own profile, or the two of you have never played. */
  h2h: { wins: number; losses: number; draws: number } | null;
  /** Set when this user owns an approved organisation. */
  organization?: { name: string } | null;
}

export interface UserGameHistoryItem {
  gameId: string;
  joinCode: string;
  opponent: { _id: string; username: string; avatarGradient?: string | null } | null;
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

/** Top online players by rating (never the caller), same shape as a friends
 *  list entry. Empty when nobody else is online. */
export function listOnlinePlayers() {
  return apiFetch<{ players: Friend[] }>('/users/online/players');
}

export function getProfile(username: string) {
  return apiFetch<UserProfile>(`/users/${encodeURIComponent(username)}`);
}

export function getUserGames(username: string, page = 1, limit = 20) {
  return apiFetch<UserGameHistoryResponse>(
    `/users/${encodeURIComponent(username)}/games?page=${page}&limit=${limit}`,
  );
}

export function updateMyProfile(body: { avatarGradient?: string; bio?: string; username?: string; acceptChallenges?: boolean }) {
  return apiFetch<{ username: string; avatarUrl?: string | null; avatarGradient?: string | null; bio?: string | null; acceptChallenges?: boolean }>(
    '/users/me',
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}
