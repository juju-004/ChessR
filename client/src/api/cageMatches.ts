import { apiFetch } from './http.js';

export type CageVariant = 'standard' | 'chess960';
export type CageWinnerMode = 'total_score' | 'most_categories' | 'first_to_n';
export type CageWagerMode = 'none' | 'winner_takes_all' | 'per_leg' | 'split_even';
export type LegCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';
export type LegResult = 'p1' | 'p2' | 'draw' | null;

export interface CageLegPlan {
  variant: CageVariant;
  baseMinutes: number | null;
  incrementSeconds: number;
}

export interface CageLeg extends CageLegPlan {
  index: number;
  category: LegCategory;
  status: 'pending' | 'active' | 'finished' | 'skipped';
  gameId: string | null;
  joinCode: string | null;
  result: LegResult;
  endReason: string | null;
}

export interface CageMatch {
  _id: string;
  matchCode: string;
  player1: { _id: string; username: string };
  player2: { _id: string; username: string };
  legs: CageLeg[];
  currentLegIndex: number;
  status: 'active' | 'finished' | 'cancelled';
  winnerMode: CageWinnerMode;
  targetWins: number | null;
  wagerMode: CageWagerMode;
  wagerTokens: number;
  matchWinner: 'p1' | 'p2' | 'draw' | null;
  matchEndReason: 'completed' | 'timeout_forfeit' | 'forfeit' | null;
  forfeitedBy: string | null;
  createdAt: string;
  endedAt?: string;
}

export function listMyCageMatches() {
  return apiFetch<{ matches: CageMatch[] }>('/cage-matches/mine');
}

export function getCageMatchByCode(code: string) {
  return apiFetch<{ match: CageMatch }>(`/cage-matches/code/${encodeURIComponent(code)}`);
}

/** Derived, client-side mirror of the server's computeStandings — used so
 *  the UI can show live-ish scores between socket events without waiting on
 *  a round trip. The server's numbers (delivered on cage:next_leg /
 *  cage:match_over) are always the source of truth. */
export function computeCageStandings(match: CageMatch) {
  let p1Score = 0;
  let p2Score = 0;
  let p1Wins = 0;
  let p2Wins = 0;
  let draws = 0;
  const catTally = new Map<LegCategory, { p1: number; p2: number }>();

  for (const leg of match.legs) {
    if (leg.status !== 'finished') continue;
    const bucket = catTally.get(leg.category) ?? { p1: 0, p2: 0 };
    if (leg.result === 'p1') {
      p1Score += 1;
      p1Wins += 1;
      bucket.p1 += 1;
    } else if (leg.result === 'p2') {
      p2Score += 1;
      p2Wins += 1;
      bucket.p2 += 1;
    } else if (leg.result === 'draw') {
      p1Score += 0.5;
      p2Score += 0.5;
      draws += 1;
    }
    catTally.set(leg.category, bucket);
  }

  let categoriesWonP1 = 0;
  let categoriesWonP2 = 0;
  for (const bucket of catTally.values()) {
    if (bucket.p1 > bucket.p2) categoriesWonP1 += 1;
    else if (bucket.p2 > bucket.p1) categoriesWonP2 += 1;
  }

  return { p1Score, p2Score, p1Wins, p2Wins, draws, categoriesWonP1, categoriesWonP2 };
}

export function formatLegTimeControl(leg: CageLegPlan): string {
  const base = leg.baseMinutes === null ? 'Unlimited' : `${leg.baseMinutes}+${leg.incrementSeconds}`;
  return leg.variant === 'chess960' ? `${base} · 960` : base;
}

export const CATEGORY_LABEL: Record<LegCategory, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
};
