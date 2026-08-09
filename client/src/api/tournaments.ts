import { apiFetch } from './http.js';

export type TournamentFormat = 'normal' | 'swiss' | 'robin' | 'round_robin';
export type TournamentStatus = 'pending' | 'active' | 'finished' | 'cancelled';
export type PairingResult = 'p1' | 'p2' | 'draw' | null;

export interface TournamentPrizeTier {
  fromRank: number;
  toRank: number;
  tokens: number;
}

export interface TournamentPlayer {
  user: string;
  username: string;
  avatarGradient: string | null;
  joinedAt: string;
  points: number;
  tiebreak: number;
  gamesPlayed: number;
  berserkWins: number;
  eliminatedRound: number | null;
  hadBye: boolean;
  withdrawn: boolean;
}

export interface TournamentPairing {
  index: number;
  player1: string;
  player2: string | null;
  whiteId: string | null;
  blackId: string | null;
  gameId: string | null;
  joinCode: string | null;
  status: 'pending' | 'active' | 'finished';
  result: PairingResult;
  endReason: string | null;
  berserk: { p1: boolean; p2: boolean };
}

export interface TournamentRound {
  index: number;
  status: 'pending' | 'active' | 'finished';
  pairings: TournamentPairing[];
}

export interface Tournament {
  _id: string;
  code: string;
  name: string;
  createdBy: string;
  format: TournamentFormat;
  variant: 'standard' | 'chess960';
  baseMinutes: number | null;
  incrementSeconds: number;
  status: TournamentStatus;
  minPlayers: number;
  maxPlayers: number;
  players: TournamentPlayer[];
  berserkAllowed: boolean;
  isPublic: boolean;
  prizeSchedule: TournamentPrizeTier[];
  prizePoolTokens: number;
  prizePoolSettled: boolean;
  regFeeTokens: number;
  regFeePoolTokens: number;
  regFeeSettled: boolean;
  // Never the actual hash — just whether joining requires a password.
  hasPassword: boolean;
  swissRounds: number | null;
  currentRoundIndex: number;
  rounds: TournamentRound[];
  breakSeconds: number;
  nextRoundStartsAt: string | null;
  scheduledStartAt: string | null;
  winner: string | null;
  runnerUp: string | null;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export function listOpenTournaments(status?: TournamentStatus) {
  const qs = status ? `?status=${status}` : '';
  return apiFetch<{ tournaments: Tournament[] }>(`/tournaments${qs}`);
}

export function listMyTournaments() {
  return apiFetch<{ tournaments: Tournament[] }>('/tournaments/mine');
}

export function getTournamentByCode(code: string) {
  return apiFetch<{ tournament: Tournament }>(`/tournaments/code/${encodeURIComponent(code)}`);
}

/** Sorted standings for swiss/robin/round_robin formats — for 'normal'
 *  (knockout) use the bracket view instead, points aren't tracked there. */
export function rankTournamentPlayers(tournament: Tournament): TournamentPlayer[] {
  return [...tournament.players]
    .filter((p) => !p.withdrawn)
    .sort((a, b) => b.points - a.points || b.tiebreak - a.tiebreak);
}

export function usernameOf(tournament: Tournament, userId: string | null): string {
  if (!userId) return 'Bye';
  return tournament.players.find((p) => p.user === userId)?.username ?? 'Unknown';
}

export function gradientOf(tournament: Tournament, userId: string | null): string | null {
  if (!userId) return null;
  return tournament.players.find((p) => p.user === userId)?.avatarGradient ?? null;
}

export function formatTimeControl(t: Pick<Tournament, 'baseMinutes' | 'incrementSeconds' | 'variant'>): string {
  const base = t.baseMinutes === null ? 'Unlimited' : `${t.baseMinutes}+${t.incrementSeconds}`;
  return t.variant === 'chess960' ? `${base} · 960` : base;
}

/** Total the creator committed across every tier of a prize schedule — the
 *  exact number debited from them at creation time. */
export function totalPrizePool(schedule: TournamentPrizeTier[]): number {
  return schedule.reduce((sum, t) => sum + t.tokens * (t.toRank - t.fromRank + 1), 0);
}

/** "R" for a single-rank tier (only one person can ever receive it) vs
 *  "R each" for a multi-rank tier (every rank in the range gets that
 *  amount) — auto-detected from the tier's own range rather than something
 *  the creator has to separately toggle. */
export function tokensLabel(tier: Pick<TournamentPrizeTier, 'fromRank' | 'toRank'>): string {
  return tier.fromRank === tier.toRank ? 'R' : 'R each';
}

export const FORMAT_LABEL: Record<TournamentFormat, string> = {
  normal: 'Knockout',
  swiss: 'Swiss',
  robin: 'Round-robin',
  round_robin: 'Double round-robin',
};

export const FORMAT_DESCRIPTION: Record<TournamentFormat, string> = {
  normal: 'Single-elimination bracket — lose once and you\'re out.',
  swiss: 'A fixed number of rounds, paired by score each round.',
  robin: 'Everyone plays everyone else once.',
  round_robin: 'Everyone plays everyone else twice.',
};
