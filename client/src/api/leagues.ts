import { apiFetch } from "./http.js";
import type { Tournament } from "./tournaments.js";

// "League" is the name players see. The server still calls the same thing a
// "cumulative" (routes under /cumulatives, a tournament's `cumulative` /
// `cumulativeName` fields, the `cumulativeId` create payload), so the
// request/response shapes are translated here and the rest of the client only
// ever deals in leagues.

/** Smallest and largest tournament limit a league's creator may choose.
 *  Mirror MIN/MAX_CUMULATIVE_TOURNAMENTS server-side. */
export const MIN_LEAGUE_TOURNAMENTS = 2;
export const MAX_LEAGUE_TOURNAMENTS = 10;

/** Only these formats can be part of a league (knockout has no points). */
export const LEAGUE_FORMATS = ["swiss", "arena"] as const;

export interface LeagueSummary {
  id: string;
  name: string;
  description: string | null;
  organizationName: string;
  tournamentCount: number;
  /** The limit its creator chose. */
  maxTournaments: number;
  /** True when the caller created it (only they can add tournaments). */
  mine: boolean;
  createdAt: string;
}

export interface LeagueStandingRow {
  rank: number;
  user: string;
  username: string;
  avatarGradient: string | null;
  /** Total points across every started tournament up to the one shown. */
  points: number;
  /** Points earned in that one tournament alone. */
  lastPoints: number;
  /** How many of the league's tournaments this player has entered. */
  played: number;
  /** Places gained (+) / lost (-) vs the table before that tournament.
   *  null = nothing to compare against. */
  movement: number | null;
}

export interface LeagueStandings {
  league: { id: string; name: string; organizationName: string };
  /** 1-based position of the tournament the table runs through, 0 if none
   *  has started yet. */
  throughTournament: number;
  tournamentCount: number;
  standings: LeagueStandingRow[];
}

export interface LeagueDetailResponse {
  league: LeagueSummary;
  tournaments: Tournament[];
  throughTournament: number;
  tournamentCount: number;
  standings: LeagueStandingRow[];
}

export function listLeagues() {
  return apiFetch<{ cumulatives: LeagueSummary[] }>("/cumulatives").then((r) => ({
    leagues: r.cumulatives,
  }));
}

export function listMyLeagues() {
  return apiFetch<{ cumulatives: LeagueSummary[] }>("/cumulatives/mine").then((r) => ({
    leagues: r.cumulatives,
  }));
}

export function createLeague(input: {
  name: string;
  description?: string | null;
  maxTournaments: number;
}) {
  return apiFetch<{ cumulative: LeagueSummary }>("/cumulatives", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((r) => ({ league: r.cumulative }));
}

export function getLeague(id: string) {
  return apiFetch<Omit<LeagueDetailResponse, "league"> & { cumulative: LeagueSummary }>(
    `/cumulatives/${id}`,
  ).then(({ cumulative, ...rest }) => ({ ...rest, league: cumulative }));
}

/** The league table as of one specific tournament (by code). */
export function getLeagueStandings(id: string, tournamentCode?: string) {
  const qs = tournamentCode ? `?tournament=${encodeURIComponent(tournamentCode)}` : "";
  return apiFetch<Omit<LeagueStandings, "league"> & { cumulative: LeagueStandings["league"] }>(
    `/cumulatives/${id}/standings${qs}`,
  ).then(({ cumulative, ...rest }) => ({ ...rest, league: cumulative }));
}

/** Organisation-only (the league's creator). Its tournaments stay, they just
 *  stop being part of a league. */
export function deleteLeague(id: string) {
  return apiFetch<void>(`/cumulatives/${id}`, { method: "DELETE" });
}
