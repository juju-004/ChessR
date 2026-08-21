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
  joinedAt: string;
  points: number;
  tiebreak: number;
  gamesPlayed: number;
  berserkWins: number;
  eliminatedRound: number | null;
  hadBye: boolean;
  withdrawn: boolean;
  // Arena-only — see the server's ITournamentPlayer doc comment. Always
  // false for every other format.
  paused: boolean;
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
}

export interface TournamentRound {
  index: number;
  status: "pending" | "active" | "finished";
  pairings: TournamentPairing[];
}

export interface Tournament {
  _id: string;
  code: string;
  name: string;
  createdBy: string;
  /** True if the creator set up this tournament purely to run it — they
   *  never occupy a player slot and were never charged the registration
   *  fee. See tournament.service.ts's createTournament for the server-side
   *  half of this. */
  organizerOnly: boolean;
  format: TournamentFormat;
  variant: "standard" | "chess960";
  baseMinutes: number | null;
  incrementSeconds: number;
  status: TournamentStatus;
  // Set when status === "cancelled" — a short human-readable reason, e.g.
  // "Cancelled by the organiser" or "Not enough players to start the
  // tournament". Null otherwise.
  cancelReason: string | null;
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
  // Knockout-only — see tournament.service.ts's CreateTournamentInput doc
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

export function listMyTournaments() {
  return apiFetch<{ tournaments: Tournament[] }>("/tournaments/mine");
}

export function getTournamentByCode(code: string) {
  return apiFetch<{ tournament: Tournament }>(
    `/tournaments/code/${encodeURIComponent(code)}`,
  );
}

/** Sorted standings for swiss/robin/round_robin formats — for 'normal'
 *  (knockout) use the bracket view instead, points aren't tracked there. */
export function rankTournamentPlayers(
  tournament: Tournament,
): TournamentPlayer[] {
  return [...tournament.players]
    .filter((p) => !p.withdrawn)
    .sort((a, b) => b.points - a.points || b.tiebreak - a.tiebreak);
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

/** Total the creator committed across every tier of a prize schedule — the
 *  exact number debited from them at creation time. */
export function totalPrizePool(schedule: TournamentPrizeTier[]): number {
  return schedule.reduce(
    (sum, t) => sum + t.tokens * (t.toRank - t.fromRank + 1),
    0,
  );
}

/** "R" for a single-rank tier (only one person can ever receive it) vs
 *  "R each" for a multi-rank tier (every rank in the range gets that
 *  amount) — auto-detected from the tier's own range rather than something
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

// Upper bound on maxPlayers for each format, matching the server's
// FORMAT_BOUNDS — used to keep the create/edit form's input hint honest
// rather than always showing a flat 64 regardless of format.
export const FORMAT_MAX_PLAYERS: Record<TournamentFormat, number> = {
  normal: 64,
  swiss: 64,
  round_robin: 14,
  arena: 100,
};

/** How many games a round-robin field actually plays — for display next to
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
 *  `parsePrizePoolText` understands — used to seed the textarea when
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
    // separators (hyphen, whitespace) — quietly discards ordinal suffixes,
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
