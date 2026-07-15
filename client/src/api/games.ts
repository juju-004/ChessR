import { apiFetch } from './http.js';

export interface OpenGame {
  _id: string;
  white: { _id: string; username: string; rating: number };
  createdAt: string;
}

export function createGame(isPrivate = false) {
  return apiFetch<{ gameId: string; status: string }>('/games', {
    method: 'POST',
    body: JSON.stringify({ isPrivate }),
  });
}

export function joinGame(gameId: string) {
  return apiFetch<{ gameId: string; status: string; fen: string }>(`/games/${gameId}/join`, {
    method: 'POST',
  });
}

export function listOpenGames() {
  return apiFetch<{ games: OpenGame[] }>('/games/open');
}

export function getGame(gameId: string) {
  return apiFetch<{ game: any }>(`/games/${gameId}`);
}
