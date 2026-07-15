import { apiFetch } from './http.js';

export interface OpenGame {
  _id: string;
  white: { _id: string; username: string; rating: number };
  createdAt: string;
}

export interface TimeControlChoice {
  baseMinutes: number | null; // null = unlimited
  incrementSeconds: number;
}

export function createGame(timeControl: TimeControlChoice, isPrivate = false) {
  return apiFetch<{ gameId: string; joinCode: string; status: string }>('/games', {
    method: 'POST',
    body: JSON.stringify({ ...timeControl, isPrivate }),
  });
}

export function joinGame(gameId: string) {
  return apiFetch<{ gameId: string; joinCode: string; status: string; fen: string }>(
    `/games/${gameId}/join`,
    { method: 'POST' },
  );
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
