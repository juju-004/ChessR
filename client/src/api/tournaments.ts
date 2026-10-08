import { apiFetch } from "./http.js";

export type TournamentFormat = "normal" | "swiss" | "round_robin" | "arena";
export type TournamentStatus = "pending" | "active" | "finished" | "cancelled";
export type PairingResult = "p1" | "p2" | "draw" | null;

export interface TournamentPrizeTier {
  fromRank: number;
  toRank: number;
  tokens: number;
}

export interface TournamentPlayer {
  user: string;
  username: string;
  avatarGradient: string | null;
  rating: number;
  joinedAt: string;
  points: number;
  tiebreak: number;
  eliminatedRound: number | null;
  // Not part of the tournament payload (every viewer refetches that on every
  // update); they arrive with getTournamentPlayerDetails when a player's row
  // is opened.
  gamesPlayed?: number;
  berserkWins?: number;
  // Arena-only scoring stats (see applyArenaPairingScore server-side).
  // currentWinStreak is also part of the live tournament payload (it drives
  // the flame in standings); the rest arrive with the player details.
  // Always 0 for every other format.
  currentWinStreak?: number;
  streakWins?: number;
  // Last 3 finished game results, oldest first (standings "Form" column).
  // Missing on players whose games predate the field.
  form?: ("W" | "D" | "L")[];
  hadBye?: boolean;
  // Arena-only, see the server's ITournamentPlayer doc comment. Always
  // false for every other format.
  paused: boolean;
  /** Team battles only: id of the team this player represents. */
  battleTeam?: string | null;
}

/** One row of a team battle's team standings (computed server-side). */
export interface TeamStanding {
  team: string;
  name: string;
  /** Sum of the points of the team's best `leadersPerTeam` players. */
  score: number;
  playerCount: number;
  leaders: { user: string; username: string; points: number }[];
}

export interface TeamBattleConfig {
  teams: { team: string; name: string }[];
  leadersPerTeam: number;
}

export interface TournamentPairing {
  index: number;
  player1: string;
  player2: string | null;
  // Knockout-only: true for the bonus match between the two semifinal
  // losers, played alongside the final. See tournament.service.ts's
  // ITournamentPairing doc comment.
  isThirdPlace?: boolean;
  whiteId: string | null;
  blackId: string | null;
  gameId: string | null;
  joinCode: string | null;
  status: "pending" | "active" | "finished";
  result: PairingResult;
  endReason: string | null;
  berserk: { p1: boolean; p2: boolean };
  // Only meaningful once status is "finished". See the server's
  // ITournamentPairing doc comment — recorded at scoring time rather than
  // derivable from `result` alone (arena's doubling can depend on state
  // that isn't visible on the pairing itself).
  pointsAwarded: { p1: number; p2: number };
}

export interface TournamentRound {
  index: number;
  status: "pending" | "active" | "finished";
  pairings: TournamentPairing[];
  /** How many pairings the round really has. A swiss/round-robin round that
   *  isn't the current one arrives as a stub (empty `pairings`) and is
   *  filled in by getTournamentRound when its tab is opened. */
  pairingCount?: number;
}

export interface Tournament {
  _id: string;
  code: string;
  name: string;
  // Optional, freeform. null/empty means no description card renders.
  description: string | null;
  createdBy: string;
  /** Set for in-house tournaments (the owning team's id), only that team's
   *  members can join. */
  team?: string | null;
  /** Set for team battles (created by an approved organisation). */
  teamBattle?: TeamBattleConfig | null;
  /** Name of the organisation that created this team battle. */
  organizationName?: string | null;
  /** Set when this tournament is one stage of a league (the server calls
   *  leagues "cumulatives", hence the field names). */
  cumulative?: string | null;
  cumulativeName?: string | null;
  /** Team battles only, on the detail endpoints: teams ranked best first. */
  teamStandings?: TeamStanding[];
  /** True if the creator set up this tournament purely to run it, they
   *  never occupy a player slot and were never charged the registration
   *  fee. See tournament.service.ts's createTournament for the server-side
   *  half of this. */
  organizerOnly: boolean;
  format: TournamentFormat;
  variant: "standard" | "chess960";
  baseMinutes: number | null;
  incrementSeconds: number;
  status: TournamentStatus;
  // Set when status === "cancelled", a short human-readable reason, e.g.
  // "Cancelled by the organiser" or "Not enough players to start the
  // tournament". Null otherwise.
  cancelReason: string | null;
  minPlayers: number;
  players: TournamentPlayer[];
  /** Set on list responses, which send an empty `players` array. */
  playerCount?: number;
  berserkAllowed: boolean;
  chatEnabled: boolean;
  isPublic: boolean;
  prizeSchedule: TournamentPrizeTier[];
  prizePoolTokens: number;
  prizePoolSettled: boolean;
  // 'tokens' (default) or 'naira' — see the ITournament doc comment in
  // Tournament.ts server-side. Naira prize pools never touch any wallet;
  // real cash is disbursed manually, see AccountDetails.tsx / the admin
  // "Naira tournaments" tab.
  prizePoolCurrency: "tokens" | "naira";
  // Naira-prize tournaments only, filled in once the tournament finishes:
  // one entry per rank that actually wins a prize. Absent/empty otherwise.
  nairaWinners?: { user: string; rank: number; naira: number }[];
  regFeeTokens: number;
  regFeePoolTokens: number;
  regFeeSettled: boolean;
  // Never the actual hash, just whether joining requires a password.
  hasPassword: boolean;
  swissRounds: number | null;
  robinRounds: number | null;
  arenaMinutes: number | null;
  arenaEndsAt: string | null;
  currentRoundIndex: number;
  rounds: TournamentRound[];
  breakSeconds: number;
  nextRoundStartsAt: string | null;
  scheduledStartAt: string | null;
  winner: string | null;
  runnerUp: string | null;
  // Knockout-only, see tournament.service.ts's CreateTournamentInput doc
  // comment for thirdPlaceMatch, and ITournament's for thirdPlace/
  // fourthPlace. All null/false for every other format.
  thirdPlaceMatch: boolean;
  thirdPlace: string | null;
  fourthPlace: string | null;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export function listOpenTournaments(status?: TournamentStatus) {
  const qs = status ? `?status=${status}` : "";
  return apiFetch<{ tournaments: Tournament[] }>(`/tournaments${qs}`);
}

/** Page size of the Finished tournaments list, kept in step with
 *  FINISHED_TOURNAMENTS_PAGE_SIZE on the server. */
export const FINISHED_PAGE_SIZE = 5;

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Your pending/active tournaments (finished ones are paged separately, see
 *  listMyFinishedTournaments). */
export function listMyTournaments() {
  return apiFetch<{ tournaments: Tournament[] }>("/tournaments/mine");
}

/** One page (1-based) of your finished tournaments, newest first. */
export function listMyFinishedTournaments(page = 1, limit = FINISHED_PAGE_SIZE) {
  return apiFetch<{ tournaments: Tournament[] } & PageMeta>(
    `/tournaments/mine?scope=finished&page=${page}&limit=${limit}`,
  );
}

export function getTournamentRound(code: string, index: number) {
  return apiFetch<{ round: TournamentRound }>(
    `/tournaments/code/${encodeURIComponent(code)}/rounds/${index}`,
  );
}

export interface TournamentPlayerPairing {
  roundIndex: number;
  pairing: TournamentPairing;
}

export function getTournamentPlayerDetails(code: string, userId: string) {
  return apiFetch<{ player: TournamentPlayer; pairings: TournamentPlayerPairing[] }>(
    `/tournaments/code/${encodeURIComponent(code)}/players/${encodeURIComponent(userId)}`,
  );
}

export function getTournamentByCode(code: string) {
  return apiFetch<{ tournament: Tournament }>(
    `/tournaments/code/${encodeURIComponent(code)}`,
  );
}

/** Arena: a player who has won this many games in a row is "on streak", so
 *  their next game is worth double (flame icon). Mirrors the server's
 *  ARENA_STREAK_START_WINS in tournament.service.ts. */
export const ARENA_STREAK_START_WINS = 2;
export function isOnArenaStreak(
  p: { currentWinStreak?: number } | null | undefined,
): boolean {
  return (p?.currentWinStreak ?? 0) >= ARENA_STREAK_START_WINS;
}

/** Sorted standings for swiss/robin/round_robin formats, for 'normal'
 *  (knockout) use the bracket view instead, points aren't tracked there. */
export function rankTournamentPlayers(
  tournament: Tournament,
): TournamentPlayer[] {
  return [...tournament.players].sort(
    (a, b) => b.points - a.points || b.tiebreak - a.tiebreak,
  );
}

export function usernameOf(
  tournament: Tournament,
  userId: string | null,
): string {
  if (!userId) return "Bye";
  return (
    tournament.players.find((p) => p.user === userId)?.username ?? "Unknown"
  );
}

export function gradientOf(
  tournament: Tournament,
  userId: string | null,
): string | null {
  if (!userId) return null;
  return (
    tournament.players.find((p) => p.user === userId)?.avatarGradient ?? null
  );
}

export function formatTimeControl(
  t: Pick<Tournament, "baseMinutes" | "incrementSeconds" | "variant">,
): string {
  const base =
    t.baseMinutes === null
      ? "Unlimited"
      : `${t.baseMinutes}+${t.incrementSeconds}`;
  return t.variant === "chess960" ? `${base} · 960` : base;
}

/** Standard chess speed category (estimated game length = base + 40 moves'
 *  worth of increment, the same convention lichess uses), null for
 *  Unlimited since "Bullet"/etc doesn't mean anything without a clock. */
export function timeControlSpeed(
  t: Pick<Tournament, "baseMinutes" | "incrementSeconds">,
): string | null {
  if (t.baseMinutes === null) return null;
  const estimatedSeconds = t.baseMinutes * 60 + 40 * t.incrementSeconds;
  if (estimatedSeconds < 60) return "Hyper Bullet";
  if (estimatedSeconds < 180) return "Bullet";
  if (estimatedSeconds < 480) return "Blitz";
  if (estimatedSeconds < 1500) return "Rapid";
  return "Classical";
}

/** Total the creator committed across every tier of a prize schedule, the
 *  exact number debited from them at creation time. */
export function totalPrizePool(schedule: TournamentPrizeTier[]): number {
  return schedule.reduce(
    (sum, t) => sum + t.tokens * (t.toRank - t.fromRank + 1),
    0,
  );
}

/** "R" for a single-rank tier (only one person can ever receive it) vs
 *  "R each" for a multi-rank tier (every rank in the range gets that
 *  amount), auto-detected from the tier's own range rather than something
 *  the creator has to separately toggle. */
export function tokensLabel(
  tier: Pick<TournamentPrizeTier, "fromRank" | "toRank">,
): string {
  return tier.fromRank === tier.toRank ? "R" : "R each";
}

export const FORMAT_LABEL: Record<TournamentFormat, string> = {
  normal: "Knockout",
  swiss: "Swiss",
  round_robin: "Round-robin",
  arena: "Arena",
};

export const FORMAT_DESCRIPTION: Record<TournamentFormat, string> = {
  normal: "Single elimination bracket. Lose once and you're out.",
  swiss: "A fixed number of rounds, paired by score each round.",
  round_robin: "Everyone plays everyone else a set number of times.",
  arena: "Play as many games as you can before time runs out.",
};

// Server-side roster cap, the same for every format (organizers no longer
// choose one). Only used client-side to sanity-check prize tiers; the server
// is the one that actually enforces it.
export const MAX_TOURNAMENT_PLAYERS = 200;

/** How many games a round-robin field actually plays, for display next to
 *  the format picker/summary. */
export function robinRoundsLabel(robinRounds: number | null): string {
  if (!robinRounds || robinRounds === 1) return "Everyone plays everyone once.";
  if (robinRounds === 2) return "Everyone plays everyone twice.";
  return `Everyone plays everyone ${robinRounds} times.`;
}

/** "1st", "2nd", "3rd", "4th"... */
export function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** Render a prize schedule back into the plain-text format
 *  `parsePrizePoolText` understands, used to seed the textarea when
 *  editing an existing schedule so the round trip stays lossless. */
export function prizeTiersToText(tiers: TournamentPrizeTier[]): string {
  return tiers
    .slice()
    .sort((a, b) => a.fromRank - b.fromRank)
    .map((t) => {
      const from = `${t.fromRank}${ordinalSuffix(t.fromRank)}`;
      const range =
        t.fromRank === t.toRank
          ? from
          : `${from}-${t.toRank}${ordinalSuffix(t.toRank)}`;
      return `${range} - ${t.tokens}`;
    })
    .join("\n");
}

export interface PrizePoolParseResult {
  tiers: TournamentPrizeTier[];
  /** Raw lines that couldn't be understood, verbatim, for surfacing back
   *  to whoever's typing. */
  errors: string[];
}

/** Parses free-form prize pool text into a prize schedule. One tier per
 *  line, each line either `rank - amount` (a single place) or
 *  `fromRank - toRank - amount` (a range that all shares that amount).
 *
 *  Deliberately lenient about how a line is written, since this is meant
 *  to be typed quickly rather than filled into a rigid template:
 *   - Ordinal suffixes are fine and ignored: "1st", "10th".
 *   - Hyphens and spaces are interchangeable as separators: "1st-500",
 *     "1st 500", "1st - 500" all mean the same thing.
 *   - Amounts can use a "k" shorthand for thousands: "4k" -> 4000.
 *   - Stray punctuation (commas, #, extra spaces) is ignored, so
 *     "5-10-4000#" and "5th-10th-4k" both resolve to the same tier: ranks
 *     5 through 10 each receive 4000.
 *
 *  A line that doesn't reduce to exactly two or three numbers is reported
 *  back in `errors` (trimmed, verbatim) rather than silently dropped, so
 *  the caller can point out what it couldn't parse. */
export function parsePrizePoolText(text: string): PrizePoolParseResult {
  const tiers: TournamentPrizeTier[] = [];
  const errors: string[] = [];

  function parseAmount(s: string): number | null {
    const m = s.match(/^(\d+(?:\.\d+)?)(k)?$/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Math.round(m[2] ? n * 1000 : n);
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // Strip everything but digits, a decimal point, "k", and the two
    // separators (hyphen, whitespace), quietly discards ordinal suffixes,
    // stray punctuation, and thousands-separator commas in one pass.
    const cleaned = line.replace(/[^0-9kK.\-\s]/g, " ");
    const parts = cleaned
      .split(/[-\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length === 2) {
      const rank = parseAmount(parts[0]);
      const tokens = parseAmount(parts[1]);
      if (rank === null || tokens === null || rank < 1) {
        errors.push(line);
        continue;
      }
      tiers.push({ fromRank: rank, toRank: rank, tokens });
    } else if (parts.length === 3) {
      const fromRank = parseAmount(parts[0]);
      const toRank = parseAmount(parts[1]);
      const tokens = parseAmount(parts[2]);
      if (
        fromRank === null ||
        toRank === null ||
        tokens === null ||
        fromRank < 1 ||
        toRank < fromRank
      ) {
        errors.push(line);
        continue;
      }
      tiers.push({ fromRank, toRank, tokens });
    } else {
      errors.push(line);
    }
  }

  tiers.sort((a, b) => a.fromRank - b.fromRank);
  return { tiers, errors };
}
