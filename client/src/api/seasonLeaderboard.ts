import { apiFetch } from "./http.js";

export type SeasonBoard = "games" | "points";

export interface SeasonRow {
  rank: number;
  user: string;
  username: string;
  avatarGradient: string | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** R prize this row is currently on course for (0 = none). */
  prize: number;
}

export interface SeasonBoardData {
  top: SeasonRow[];
  me: SeasonRow | null;
  totalPlayers: number;
}

export interface SeasonLeaderboard {
  season: number;
  startsAt: string;
  endsAt: string;
  isCurrent: boolean;
  lengthDays: number;
  prizes: number[];
  minGamesForPointsPrize: number;
  boards: Record<SeasonBoard, SeasonBoardData>;
}

export interface PastSeasonWinner {
  board: SeasonBoard;
  rank: number;
  user: string;
  username: string;
  avatarGradient: string | null;
  /** Games played on the games board; always null on the points board. */
  value: number | null;
  prize: number;
}

export interface PastSeason {
  season: number;
  startsAt: string;
  endsAt: string;
  winners: PastSeasonWinner[];
}

export const getSeasonLeaderboard = (season?: number) =>
  apiFetch<SeasonLeaderboard>(`/leaderboards/seasons/${season ?? "current"}`);

export const getPastSeasons = () =>
  apiFetch<{ seasons: PastSeason[] }>("/leaderboards/seasons/past");
