import { apiFetch } from './http.js';

export type ChallengeIcon =
  | 'swords'
  | 'trophy'
  | 'puzzle'
  | 'users'
  | 'crown'
  | 'flame'
  | 'coins'
  | 'zap'
  | 'target';

export interface DailyChallenge {
  id: string;
  title: string;
  icon: ChallengeIcon;
  /** Where the "Go" button takes you. */
  link: string;
  target: number;
  progress: number;
  completed: boolean;
}

export interface WeekDay {
  day: number;
  reward: number;
  /** Extra paid on top for finishing the week (Day 7 only). */
  bonus: number;
  status: 'done' | 'today' | 'upcoming';
}

export interface DailyChallengeState {
  day: number;
  dateKey: string;
  serverNow: number;
  msUntilReset: number;
  challenges: DailyChallenge[];
  dayCompleted: boolean;
  rewardToday: number;
  week: WeekDay[];
  weekBonus: number;
  weekComplete: boolean;
  tomorrow: { day: number; reward: number } | null;
  /** Set on the day a missed day sent the player back to Day 1. */
  resetNotice: { fromDay: number } | null;
  streak: number;
  bestStreak: number;
  daysCompleted: number;
  weeksCompleted: number;
  totalEarned: number;
}

export function getDailyChallenges() {
  return apiFetch<DailyChallengeState>('/daily-challenges');
}
