import { apiFetch } from './http.js';

export type PuzzleRaceStatus = 'waiting' | 'active' | 'finished' | 'cancelled';
export type PuzzleRaceDifficulty = 'easy' | 'medium' | 'hard' | 'mixed';

export interface RacePlayer {
  userId: string;
  username: string;
  avatarGradient: string | null;
  solved: number;
  mistakes: number;
  finished: boolean;
  /** ms from the race start to this player's last solve. */
  lastSolveMs: number | null;
}

export interface PuzzleRace {
  id: string;
  code: string;
  status: PuzzleRaceStatus;
  difficulty: PuzzleRaceDifficulty;
  puzzleCount: number;
  maxPlayers: number;
  wagerTokens: number;
  timeLimitSeconds: number;
  creatorId: string;
  players: RacePlayer[];
  startsAt: number | null;
  endsAt: number | null;
  /** Server clock when this was sent; use it to correct for clock skew. */
  serverNow: number;
  winnerId: string | null;
  endReason: 'completed' | 'time_limit' | 'cancelled' | null;
  /** The rematch the host opened after this race finished, once they have. */
  rematchCode: string | null;
  potTokens: number;
  rakeTokens: number;
  payoutTokens: number;
  createdAt: number;
}

/** The player's current puzzle. Only positions, never the solution. */
export interface PuzzleView {
  index: number;
  total: number;
  /** Which move of the puzzle's line is to be found next (1 = fresh puzzle).
   *  Sent back with each move so the server can answer from one write. */
  moveIdx: number;
  fen: string;
  /** The opponent's opening move to animate (null when resuming mid-puzzle). */
  firstMove: { from: string; to: string; promotion?: string } | null;
  lastMove: [string, string] | null;
  /** The side the player solves for. */
  orientation: 'white' | 'black';
}

export type MoveResult =
  | { ok: true; status: 'correct'; reply: { from: string; to: string; promotion?: string }; nextMoveIdx: number }
  | { ok: true; status: 'solved'; next: PuzzleView }
  | { ok: true; status: 'finished'; won: boolean }
  | { ok: false; status: 'wrong'; lockMs: number }
  | { ok: false; status: 'locked'; lockMs: number }
  | { ok: false; status: 'illegal' | 'not_started' | 'not_active' | 'not_player' | 'stale' | 'done' };

export interface CreateRaceInput {
  difficulty: PuzzleRaceDifficulty;
  puzzleCount: number;
  maxPlayers: number;
  wagerTokens: number;
}

export const DIFFICULTY_LABEL: Record<PuzzleRaceDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  mixed: 'Mixed',
};

export function listOpenRaces() {
  return apiFetch<{ races: PuzzleRace[] }>('/puzzle-races/open');
}

/** The race (waiting or running) the current user is in, if any. */
export function getMyRace() {
  return apiFetch<{ race: { code: string; status: 'waiting' | 'active' } | null }>('/puzzle-races/mine');
}

export function getRaceByCode(code: string) {
  return apiFetch<{ race: PuzzleRace }>(`/puzzle-races/code/${code}`);
}

export function createRace(input: CreateRaceInput) {
  return apiFetch<{ id: string; code: string }>('/puzzle-races', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function joinRace(id: string) {
  return apiFetch<{ id: string; code: string }>(`/puzzle-races/${id}/join`, { method: 'POST' });
}

export function leaveRace(id: string) {
  return apiFetch<void>(`/puzzle-races/${id}/leave`, { method: 'POST' });
}

export function cancelRace(id: string) {
  return apiFetch<void>(`/puzzle-races/${id}/cancel`, { method: 'POST' });
}

/** Host only, finished races only: opens a new race with the same settings. */
export function rematchRace(id: string) {
  return apiFetch<{ id: string; code: string }>(`/puzzle-races/${id}/rematch`, { method: 'POST' });
}

export function startRace(id: string) {
  return apiFetch<void>(`/puzzle-races/${id}/start`, { method: 'POST' });
}
