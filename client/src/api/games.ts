import { apiFetch } from './http.js';

export interface TimeControlChoice {
  baseMinutes: number | null;
  incrementSeconds: number;
}

export interface ActiveFriendGame {
  _id: string;
  joinCode: string;
  white: { _id: string; username: string; rating: number };
  black: { _id: string; username: string; rating: number };
  timeControl: { baseSeconds: number | null; incrementSeconds: number };
  moves: unknown[];
  fen: string;
  startedAt: string;
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

export function getGame(gameId: string) {
  return apiFetch<{ game: any }>(`/games/${gameId}`);
}

export function getGameByCode(code: string) {
  return apiFetch<{ game: any }>(`/games/code/${encodeURIComponent(code)}`);
}

export function listFriendsActiveGames() {
  return apiFetch<{ games: ActiveFriendGame[] }>('/games/active/friends');
}
