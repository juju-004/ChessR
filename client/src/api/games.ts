import { apiFetch } from './http.js';

export interface TimeControlChoice {
  baseMinutes: number | null;
  incrementSeconds: number;
}

export type GameVariant = 'standard' | 'chess960';

export interface ActiveFriendGame {
  _id: string;
  joinCode: string;
  white: { _id: string; username: string };
  black: { _id: string; username: string };
  timeControl: { baseSeconds: number | null; incrementSeconds: number };
  wagerTokens: number;
  moves: unknown[];
  fen: string;
  startedAt: string;
}

export interface OpenGame {
  _id: string;
  joinCode: string;
  white: { _id: string; username: string };
  timeControl: { baseSeconds: number | null; incrementSeconds: number };
  wagerTokens: number;
  variant: GameVariant;
  createdAt: string;
}

export function createGame(
  timeControl: TimeControlChoice,
  variant: GameVariant = 'standard',
  isPrivate = false,
  wagerTokens = 0,
) {
  return apiFetch<{ gameId: string; joinCode: string; variant: GameVariant; status: string; wagerTokens: number }>(
    '/games',
    {
      method: 'POST',
      body: JSON.stringify({ ...timeControl, variant, isPrivate, wagerTokens }),
    },
  );
}

export function joinGame(gameId: string) {
  return apiFetch<{ gameId: string; joinCode: string; status: string; fen: string }>(
    `/games/${gameId}/join`,
    { method: 'POST' },
  );
}

export function cancelGame(gameId: string) {
  return apiFetch<void>(`/games/${gameId}`, { method: 'DELETE' });
}

export interface MyActiveGame {
  _id: string;
  joinCode: string;
  variant: GameVariant;
  status: 'waiting' | 'active';
  white: { _id: string; username: string };
  black: { _id: string; username: string } | null;
  timeControl: { baseSeconds: number | null; incrementSeconds: number };
  wagerTokens: number;
  fen: string;
  moves: unknown[];
  startedAt?: string;
  createdAt: string;
}

export function listMyActiveGames() {
  return apiFetch<{ games: MyActiveGame[] }>('/games/active/mine');
}

export function listOpenGames() {
  return apiFetch<{ games: OpenGame[] }>('/games/open');
}

export function getGame(gameId: string) {
  return apiFetch<{ game: any }>(`/games/${gameId}`);
}

export function getGameByCode(code: string) {
  return apiFetch<{ game: any }>(`/games/code/${encodeURIComponent(code)}`);
}

export function listFriendsActiveGames() {
  return apiFetch<{ games: ActiveFriendGame[] }>('/games/active/friends');
}
