import { customAlphabet } from "nanoid";
import bcrypt from "bcrypt";
import type { Types } from "mongoose";
import {
  Tournament,
  type ITournament,
  type ITournamentPairing,
  type ITournamentPlayer,
  type ITournamentRound,
  type ITournamentPrizeTier,
  type TournamentFormat,
} from "../models/Tournament.js";
import { Game } from "../models/Game.js";
import { ApiError } from "../utils/ApiError.js";
import {
  createDirectGame,
  finalizeGame,
  type TimeControlInput,
} from "./game.service.js";
import {
  getLiveState,
  deleteLiveState,
  endGame,
  applyBerserk,
  BerserkNotAllowedError,
} from "./gameState.service.js";
import { clearGameTimer } from "./clock.service.js";
import {
  debitTournamentRegFee,
  debitTournamentPrizeFund,
  creditTournamentReturn,
} from "./wallet.service.js";
import { getIo } from "../sockets/io.js";

const generateCode = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);

const MAX_WAGER_TOKENS = 100_000;
const PASSWORD_BCRYPT_ROUNDS = 10;
const MIN_START_DELAY_MS = 10_000; // scheduled start must be at least 10s out
const MAX_START_DELAY_MS = 30 * 24 * 60 * 60 * 1000; // and at most 30 days

// --- Inter-round break timer -------------------------------------------------
//
// Same shape as the no-show/first-move timers elsewhere in the codebase: an
// in-memory setTimeout keyed by tournament id, with a reconciliation sweep
// (reconcileActiveTournaments, called from index.ts) to self-heal if the
// process restarts mid-break. Much lower stakes than a chess clock though —
// a round starting a few seconds late because of a redeploy is a non-event,
// so there's no urgency to make this bulletproof the way the clock timers
// are.
const pendingRoundTimers = new Map<string, NodeJS.Timeout>();

function clearPendingRoundTimer(tournamentId: string): void {
  const t = pendingRoundTimers.get(tournamentId);
  if (t) {
    clearTimeout(t);
    pendingRoundTimers.delete(tournamentId);
  }
}

/** Puts the tournament into its inter-round break, then activates the given
 *  round once that break elapses. A breakSeconds of 0 (or less) skips the
 *  break entirely and activates immediately, same as the old unconditional
 *  behavior — so existing short-break expectations aren't disrupted. */
async function scheduleRoundStart(
  tournament: ITournament,
  roundIndex: number,
): Promise<void> {
  const breakMs = Math.max(0, tournament.breakSeconds ?? 0) * 1000;
  if (breakMs <= 0) {
    await activateRound(tournament, roundIndex);
    return;
  }

  const startsAt = new Date(Date.now() + breakMs);
  tournament.nextRoundStartsAt = startsAt;
  await tournament.save();
  broadcastUpdate(tournament);

  clearPendingRoundTimer(tournament.id);
  const timer = setTimeout(() => {
    pendingRoundTimers.delete(tournament.id);
    fireRoundStart(tournament.id, roundIndex).catch((err) =>
      console.error("scheduled round start failed:", err),
    );
  }, breakMs);
  timer.unref?.();
  pendingRoundTimers.set(tournament.id, timer);
}

/** Re-fetches fresh state before actually activating — the in-memory timer
 *  firing doesn't guarantee the world hasn't changed (tournament finished
 *  some other way, round already active from a reconciliation sweep race,
 *  etc), so this re-verifies rather than trusting the closure's stale doc. */
async function fireRoundStart(tournamentId: string, roundIndex: number): Promise<void> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament || tournament.status !== "active") return;
  const round = tournament.rounds[roundIndex];
  if (!round || round.status !== "pending") return;

  tournament.nextRoundStartsAt = null;
  await activateRound(tournament, roundIndex);
}

/** Boot/periodic self-heal for scheduleRoundStart's in-memory timer — finds
 *  any active tournament sitting in a break whose nextRoundStartsAt has
 *  already passed (timer lost to a restart) and fires it, and re-arms a
 *  fresh in-memory timer for any break still genuinely in progress so a
 *  redeploy doesn't leave it waiting on the next periodic sweep alone. Also
 *  does the exact same self-heal for scheduleAutoStart's timers below —
 *  same underlying risk (in-memory setTimeout, wiped by a restart), so one
 *  sweep covers both. */
export async function reconcileActiveTournaments(): Promise<{
  activated: number;
  rearmed: number;
  autoStarted: number;
  autoStartRearmed: number;
}> {
  const pending = await Tournament.find({
    status: "active",
    nextRoundStartsAt: { $ne: null },
  }).select("currentRoundIndex nextRoundStartsAt breakSeconds");

  let activated = 0;
  let rearmed = 0;
  const now = Date.now();

  for (const doc of pending) {
    const roundIndex = doc.currentRoundIndex;
    const dueAt = doc.nextRoundStartsAt ? doc.nextRoundStartsAt.getTime() : 0;
    if (dueAt <= now) {
      await fireRoundStart(doc.id, roundIndex);
      activated++;
    } else if (!pendingRoundTimers.has(doc.id)) {
      const timer = setTimeout(() => {
        pendingRoundTimers.delete(doc.id);
        fireRoundStart(doc.id, roundIndex).catch((err) =>
          console.error("re-armed round start failed:", err),
        );
      }, dueAt - now);
      timer.unref?.();
      pendingRoundTimers.set(doc.id, timer);
      rearmed++;
    }
  }

  const pendingStarts = await Tournament.find({
    status: "pending",
    scheduledStartAt: { $ne: null },
  }).select("scheduledStartAt");

  let autoStarted = 0;
  let autoStartRearmed = 0;

  for (const doc of pendingStarts) {
    const dueAt = doc.scheduledStartAt ? doc.scheduledStartAt.getTime() : 0;
    if (dueAt <= now) {
      await fireAutoStart(doc.id);
      autoStarted++;
    } else if (!pendingAutoStartTimers.has(doc.id)) {
      const timer = setTimeout(() => {
        pendingAutoStartTimers.delete(doc.id);
        fireAutoStart(doc.id).catch((err) => console.error("re-armed auto-start failed:", err));
      }, dueAt - now);
      timer.unref?.();
      pendingAutoStartTimers.set(doc.id, timer);
      autoStartRearmed++;
    }
  }

  return { activated, rearmed, autoStarted, autoStartRearmed };
}

// --- Scheduled auto-start timer ---------------------------------------------
//
// Same shape and same self-heal story as the inter-round break timer above.
// A tournament's scheduledStartAt is set once, at creation, and cleared the
// moment it actually starts (whether that's this timer firing, or the
// creator hitting manual Start early — see activateTournament).
const pendingAutoStartTimers = new Map<string, NodeJS.Timeout>();

function clearPendingAutoStart(tournamentId: string): void {
  const t = pendingAutoStartTimers.get(tournamentId);
  if (t) {
    clearTimeout(t);
    pendingAutoStartTimers.delete(tournamentId);
  }
}

function scheduleAutoStart(tournament: ITournament): void {
  clearPendingAutoStart(tournament.id);
  if (!tournament.scheduledStartAt) return;

  const delay = tournament.scheduledStartAt.getTime() - Date.now();
  if (delay <= 0) {
    fireAutoStart(tournament.id).catch((err) => console.error("auto-start failed:", err));
    return;
  }
  const timer = setTimeout(() => {
    pendingAutoStartTimers.delete(tournament.id);
    fireAutoStart(tournament.id).catch((err) => console.error("scheduled auto-start failed:", err));
  }, delay);
  timer.unref?.();
  pendingAutoStartTimers.set(tournament.id, timer);
}

/** Fires at the creator's chosen start time: starts the event if enough
 *  players have joined, otherwise calls the whole thing off and refunds
 *  everyone — same as a real-world event that doesn't reach minimum
 *  turnout, rather than leaving it stuck waiting indefinitely. Re-verifies
 *  fresh state first, same reasoning as fireRoundStart. */
async function fireAutoStart(tournamentId: string): Promise<void> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament || tournament.status !== "pending") return;

  if (tournament.players.length >= tournament.minPlayers) {
    await activateTournament(tournament);
  } else {
    await refundAllEscrow(tournament);
    tournament.status = "cancelled";
    tournament.scheduledStartAt = null;
    await tournament.save();
    broadcastUpdate(tournament, "tournament:cancelled");
  }
}

// Every format has its own sane player-count bounds — knockout tolerates any
// field size >= 2 (byes soak up the gap to the next power of two), swiss
// wants enough players to make several rounds meaningful, and the two
// round-robin formats are capped fairly low since game count grows
// quadratically (double round-robin doubles that again).
const FORMAT_BOUNDS: Record<TournamentFormat, { min: number; max: number }> = {
  normal: { min: 2, max: 64 },
  swiss: { min: 4, max: 64 },
  robin: { min: 3, max: 20 },
  round_robin: { min: 3, max: 14 },
};

async function uniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const existing = await Tournament.exists({ code });
    if (!existing) return code;
  }
  throw ApiError.internal(
    "Could not generate a unique tournament code, please retry",
  );
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function findPlayer(
  tournament: ITournament,
  userId: any,
): ITournamentPlayer | undefined {
  const id = userId?.toString();
  return tournament.players.find((p) => p.user.toString() === id);
}

function emptyPairing(
  index: number,
  player1: any,
  player2: any | null,
): ITournamentPairing {
  return {
    index,
    player1,
    player2,
    whiteId: null,
    blackId: null,
    gameId: null,
    joinCode: null,
    status: "pending",
    result: null,
    endReason: null,
    berserk: { p1: false, p2: false },
  };
}

// --- Creation / registration --------------------------------------------------

export interface CreateTournamentInput {
  name: string;
  format: TournamentFormat;
  variant: "standard" | "chess960";
  baseMinutes: number | null;
  incrementSeconds: number;
  maxPlayers: number;
  berserkAllowed: boolean;
  // Show up in the public "Open tournaments" browse list? Defaults to false
  // (link/code-only) if omitted.
  isPublic?: boolean;
  // Prize pool: creator-funded, paid out by final rank. Empty/omitted = no
  // prize pool. See the ITournament doc comment in Tournament.ts.
  prizeSchedule?: { fromRank: number; toRank: number; tokens: number }[];
  // Registration fee: player-funded, the whole pool goes to the creator once
  // the event finishes. 0/omitted = no registration fee.
  regFeeTokens?: number;
  // Required (and only meaningful) for format === 'swiss'.
  swissRounds: number | null;
  // Seconds to pause between rounds — see the ITournament doc comment.
  // Optional on input; defaults to 10 like the schema itself.
  breakSeconds?: number;
  // When the event starts itself — required, must be far enough in the
  // future to give players time to join (see MIN_START_DELAY_MS). The
  // creator can still manually start early via startTournament.
  scheduledStartAt: string | Date;
  // Optional gate on joining — anyone with the link can view the page, but
  // becoming a player requires this. Omitted/empty = no password.
  password?: string;
}

const DEFAULT_BREAK_SECONDS = 10;
const MAX_BREAK_SECONDS = 300;

/** Validates and totals a creator's prize schedule — throws on anything
 *  that doesn't cleanly partition 1..maxPlayers into non-overlapping,
 *  ascending, gap-free rank tiers. Returns the full committed total (tokens
 *  per tier * how many ranks that tier covers, summed). */
function validatePrizeSchedule(
  schedule: { fromRank: number; toRank: number; tokens: number }[],
  maxPlayers: number,
): { tiers: ITournamentPrizeTier[]; total: number } {
  if (schedule.length === 0) return { tiers: [], total: 0 };

  const sorted = [...schedule].sort((a, b) => a.fromRank - b.fromRank);
  let expectedNext = 1;
  let total = 0;

  for (const tier of sorted) {
    if (!Number.isInteger(tier.fromRank) || !Number.isInteger(tier.toRank)) {
      throw ApiError.badRequest("Prize schedule ranks must be whole numbers");
    }
    if (tier.fromRank !== expectedNext) {
      throw ApiError.badRequest(
        `Prize schedule must cover every rank starting at 1 with no gaps or overlaps (expected rank ${expectedNext} next)`,
      );
    }
    if (tier.toRank < tier.fromRank) {
      throw ApiError.badRequest("Each prize tier's rank range must end at or after where it starts");
    }
    if (tier.toRank > maxPlayers) {
      throw ApiError.badRequest(`Prize schedule can't cover a rank beyond the ${maxPlayers}-player cap`);
    }
    if (tier.tokens < 0 || tier.tokens > MAX_WAGER_TOKENS) {
      throw ApiError.badRequest("Each prize tier's token amount must be a valid, reasonable number");
    }
    total += tier.tokens * (tier.toRank - tier.fromRank + 1);
    expectedNext = tier.toRank + 1;
  }

  if (total > MAX_WAGER_TOKENS * 50) {
    throw ApiError.badRequest("That prize pool total is too large");
  }

  return {
    tiers: sorted.map((t) => ({ fromRank: t.fromRank, toRank: t.toRank, tokens: t.tokens })),
    total,
  };
}

export async function createTournament(
  creatorId: string,
  creatorUsername: string,
  input: CreateTournamentInput,
): Promise<ITournament> {
  const bounds = FORMAT_BOUNDS[input.format];
  if (!bounds) throw ApiError.badRequest("Unknown tournament format");
  if (input.name.trim().length < 3)
    throw ApiError.badRequest(
      "Give your tournament a name (at least 3 characters)",
    );
  if (input.maxPlayers < bounds.min || input.maxPlayers > bounds.max) {
    throw ApiError.badRequest(
      `A ${input.format} tournament supports between ${bounds.min} and ${bounds.max} players`,
    );
  }
  if (
    input.baseMinutes !== null &&
    (input.baseMinutes < 1 || input.baseMinutes > 180)
  ) {
    throw ApiError.badRequest(
      "Base time must be between 1 and 180 minutes (or unlimited)",
    );
  }
  if (input.incrementSeconds < 0 || input.incrementSeconds > 60) {
    throw ApiError.badRequest("Increment must be between 0 and 60 seconds");
  }
  if (
    input.format === "swiss" &&
    (!input.swissRounds || input.swissRounds < 3 || input.swissRounds > 15)
  ) {
    throw ApiError.badRequest(
      "Choose between 3 and 15 rounds for a swiss tournament",
    );
  }
  const regFeeTokens = input.regFeeTokens ?? 0;
  if (regFeeTokens < 0 || regFeeTokens > MAX_WAGER_TOKENS) {
    throw ApiError.badRequest("Enter a valid registration fee");
  }
  if (
    input.breakSeconds !== undefined &&
    (input.breakSeconds < 0 || input.breakSeconds > MAX_BREAK_SECONDS)
  ) {
    throw ApiError.badRequest(
      `Break between rounds must be between 0 and ${MAX_BREAK_SECONDS} seconds`,
    );
  }
  const scheduledStartAt = new Date(input.scheduledStartAt);
  const startDelay = scheduledStartAt.getTime() - Date.now();
  if (Number.isNaN(scheduledStartAt.getTime()) || startDelay < MIN_START_DELAY_MS) {
    throw ApiError.badRequest("Pick a start time at least a few seconds from now");
  }
  if (startDelay > MAX_START_DELAY_MS) {
    throw ApiError.badRequest("That start time is too far in the future");
  }
  const { tiers: prizeSchedule, total: prizePoolTokens } = validatePrizeSchedule(
    input.prizeSchedule ?? [],
    input.maxPlayers,
  );
  const passwordHash = input.password?.trim()
    ? await bcrypt.hash(input.password.trim(), PASSWORD_BCRYPT_ROUNDS)
    : null;

  const code = await uniqueCode();
  const tournament = await Tournament.create({
    code,
    name: input.name.trim(),
    createdBy: creatorId,
    format: input.format,
    variant: input.variant,
    baseMinutes: input.baseMinutes,
    incrementSeconds: input.incrementSeconds,
    status: "pending",
    minPlayers: bounds.min,
    maxPlayers: input.maxPlayers,
    players: [
      {
        user: creatorId,
        username: creatorUsername,
        points: 0,
        tiebreak: 0,
        gamesPlayed: 0,
        berserkWins: 0,
        eliminatedRound: null,
        hadBye: false,
        withdrawn: false,
      },
    ],
    berserkAllowed: input.berserkAllowed,
    isPublic: input.isPublic ?? false,
    prizeSchedule,
    prizePoolTokens,
    regFeeTokens,
    regFeePoolTokens: 0,
    passwordHash,
    swissRounds: input.format === "swiss" ? input.swissRounds : null,
    breakSeconds: input.breakSeconds ?? DEFAULT_BREAK_SECONDS,
    scheduledStartAt,
  });

  // The creator funds the ENTIRE prize pool up front, and — since they're
  // auto-joined as the first player — also pays their own registration fee
  // if the event charges one. Either debit failing rolls the whole
  // tournament back rather than leaving a half-funded event around.
  try {
    if (prizePoolTokens > 0) await debitTournamentPrizeFund(creatorId, tournament.id, prizePoolTokens);
    if (regFeeTokens > 0) {
      await debitTournamentRegFee(creatorId, tournament.id, regFeeTokens);
      tournament.regFeePoolTokens = regFeeTokens;
      await tournament.save();
    }
  } catch (err) {
    await Tournament.deleteOne({ _id: tournament.id });
    throw err;
  }

  scheduleAutoStart(tournament);

  return tournament;
}

export async function joinTournament(
  tournamentId: string,
  userId: string,
  username: string,
  password?: string,
): Promise<ITournament> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (tournament.status !== "pending")
    throw ApiError.conflict("This tournament has already started");
  if (findPlayer(tournament, userId))
    throw ApiError.badRequest("You've already joined this tournament");
  if (tournament.players.length >= tournament.maxPlayers)
    throw ApiError.conflict("This tournament is full");
  if (tournament.passwordHash) {
    const matches = !!password && (await bcrypt.compare(password, tournament.passwordHash));
    if (!matches) throw ApiError.forbidden("Incorrect tournament password");
  }

  if (tournament.regFeeTokens > 0) {
    await debitTournamentRegFee(userId, tournament.id, tournament.regFeeTokens);
    tournament.regFeePoolTokens += tournament.regFeeTokens;
  }
  const timestamp = Date.now();
  const dateObject = new Date(timestamp);

  tournament.players.push({
    user: userId as any,
    username,
    points: 0,
    tiebreak: 0,
    gamesPlayed: 0,
    berserkWins: 0,
    eliminatedRound: null,
    hadBye: false,
    withdrawn: false,
    joinedAt: dateObject,
  });
  await tournament.save();
  return tournament;
}

/** Only valid before the tournament starts — see withdrawFromTournament for
 *  backing out of an already-active event. If the creator leaves, the next
 *  earliest-joined player inherits the "creator" powers (start/cancel)
 *  rather than orphaning the tournament — and since the prize pool (if any)
 *  was funded by the ORIGINAL creator specifically, it goes back to them
 *  rather than staying committed to an event they're no longer running. */
export async function leaveTournament(
  tournamentId: string,
  userId: string,
): Promise<ITournament> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (tournament.status !== "pending")
    throw ApiError.conflict(
      "The tournament has already started — use withdraw instead",
    );
  const player = findPlayer(tournament, userId);
  if (!player) throw ApiError.badRequest("You're not in this tournament");

  tournament.players = tournament.players.filter(
    (p: ITournamentPlayer) => p.user.toString() !== userId,
  );

  if (tournament.regFeeTokens > 0) {
    await creditTournamentReturn(userId, tournament.id, tournament.regFeeTokens, "tournament_refund");
    tournament.regFeePoolTokens = Math.max(0, tournament.regFeePoolTokens - tournament.regFeeTokens);
  }

  const wasCreator = tournament.createdBy.toString() === userId;
  if (wasCreator && tournament.prizePoolTokens > 0 && !tournament.prizePoolSettled) {
    await creditTournamentReturn(userId, tournament.id, tournament.prizePoolTokens, "tournament_refund");
    tournament.prizePoolSettled = true;
    tournament.prizePoolTokens = 0;
    tournament.prizeSchedule = [];
  }

  if (tournament.players.length === 0) {
    clearPendingAutoStart(tournament.id);
    tournament.status = "cancelled";
  } else if (wasCreator) {
    tournament.createdBy = tournament.players[0].user;
  }
  await tournament.save();
  return tournament;
}

/** Shared refund path for both cancelling and deleting a tournament before
 *  it's settled anything on its own — everyone who paid a registration fee
 *  gets it back, and the creator gets the prize pool they funded back (if
 *  it hasn't already been distributed). Mutates and saves the passed-in
 *  document but leaves status/deletion to the caller. */
async function refundAllEscrow(tournament: ITournament): Promise<void> {
  if (tournament.regFeeTokens > 0 && !tournament.regFeeSettled) {
    await Promise.all(
      tournament.players.map((p: ITournamentPlayer) =>
        creditTournamentReturn(p.user.toString(), tournament.id, tournament.regFeeTokens, "tournament_refund"),
      ),
    );
    tournament.regFeeSettled = true;
    tournament.regFeePoolTokens = 0;
  }
  if (tournament.prizePoolTokens > 0 && !tournament.prizePoolSettled) {
    await creditTournamentReturn(
      tournament.createdBy.toString(),
      tournament.id,
      tournament.prizePoolTokens,
      "tournament_refund",
    );
    tournament.prizePoolSettled = true;
  }
}

export async function cancelTournament(
  tournamentId: string,
  requesterId: string,
): Promise<ITournament> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (tournament.createdBy.toString() !== requesterId)
    throw ApiError.forbidden("Only the organizer can cancel this");
  if (tournament.status !== "pending")
    throw ApiError.conflict("This tournament has already started");

  clearPendingAutoStart(tournament.id);
  await refundAllEscrow(tournament);
  tournament.status = "cancelled";
  await tournament.save();
  return tournament;
}

/** Fully removes a pending tournament — distinct from cancelTournament,
 *  which leaves a 'cancelled' record around for history. Scoped to
 *  status === 'pending' only: once games exist (status 'active'), there's
 *  no clean way to unwind in-progress pairings, so the organizer's only
 *  option at that point is to let it play out (or cancel individual games
 *  isn't supported here either — a tournament that's started stays
 *  started). Refunds everything the same way cancelling would. */
export async function deleteTournament(
  tournamentId: string,
  requesterId: string,
): Promise<{ code: string }> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (tournament.createdBy.toString() !== requesterId)
    throw ApiError.forbidden("Only the organizer can delete this");
  if (tournament.status !== "pending")
    throw ApiError.conflict("Only a tournament that hasn't started yet can be deleted");

  clearPendingAutoStart(tournament.id);
  await refundAllEscrow(tournament);
  const code = tournament.code;
  await Tournament.deleteOne({ _id: tournament.id });
  return { code };
}

// --- Pairing engines -----------------------------------------------------------

/** Standard "circle method" round-robin schedule. Returns one array of
 *  [player1, player2|null] pairs per round; a null partner is a bye (only
 *  possible when the field has an odd number of players — everyone sits out
 *  exactly one round in that case). `doubled` runs the whole schedule twice
 *  with player1/player2 swapped the second time (double round-robin) —
 *  actual board color is still randomized per pairing at game-creation time,
 *  same as everywhere else in this codebase, so this swap mainly keeps the
 *  bookkeeping honest about who's "home" rather than guaranteeing a literal
 *  color alternation. */
function circleMethodSchedule(
  playerIds: string[],
  doubled: boolean,
): [string, string | null][][] {
  const ids: (string | null)[] = [...playerIds];
  if (ids.length % 2 === 1) ids.push(null);
  const n = ids.length;
  const arr = [...ids];
  const rounds: [string, string | null][][] = [];

  for (let r = 0; r < n - 1; r++) {
    const roundPairs: [string, string | null][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === null && b === null) continue;
      // Keep a real player as "player1" even when they're facing the bye slot.
      if (a === null) roundPairs.push([b as string, null]);
      else roundPairs.push([a, b]);
    }
    rounds.push(roundPairs);
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr.splice(0, arr.length, fixed, ...rest);
  }

  if (!doubled) return rounds;
  const reversed = rounds.map((round) =>
    round.map(([a, b]) => [b ?? a, b ? a : null] as [string, string | null]),
  );
  return [...rounds, ...reversed];
}

/** Builds round 0 of a single-elimination bracket. Byes only ever happen in
 *  round 0 (bracket size is the next power of two above the field, so every
 *  later round is automatically a clean power-of-two pairing of winners). */
function buildKnockoutRound0(playerIds: any[]): ITournamentRound {
  const bracketSize = nextPowerOfTwo(playerIds.length);
  const shuffled = shuffle(playerIds);
  const byeCount = bracketSize - shuffled.length;
  const byePlayers = shuffled.slice(0, byeCount);
  const pairPlayers = shuffled.slice(byeCount);

  const pairings: ITournamentPairing[] = [];
  let idx = 0;
  for (const id of byePlayers) pairings.push(emptyPairing(idx++, id, null));
  for (let i = 0; i < pairPlayers.length; i += 2) {
    pairings.push(emptyPairing(idx++, pairPlayers[i], pairPlayers[i + 1]));
  }
  return { index: 0, status: "pending", pairings };
}

/** Simplified swiss pairing: sort by score (random tiebreak among equals),
 *  then greedily pair each player with the nearest player below them in the
 *  order who they haven't already faced. Not FIDE-caliber (no proper
 *  Buchholz-optimal search, no float-avoidance guarantees) but keeps games
 *  fair and rematch-free for reasonably sized fields, and never stalls —
 *  if literally everyone remaining has already played everyone else, it
 *  falls back to allowing a rematch rather than leaving someone unpaired. */
function buildSwissRound(
  tournament: ITournament,
  roundIndex: number,
): ITournamentRound {
  const active = tournament.players.filter((p) => !p.withdrawn);
  const priorOpponents = new Map<string, Set<string>>();
  for (const round of tournament.rounds) {
    for (const pairing of round.pairings) {
      if (!pairing.player2) continue;
      const a = pairing.player1.toString();
      const b = pairing.player2.toString();
      if (!priorOpponents.has(a)) priorOpponents.set(a, new Set());
      if (!priorOpponents.has(b)) priorOpponents.set(b, new Set());
      priorOpponents.get(a)!.add(b);
      priorOpponents.get(b)!.add(a);
    }
  }

  const sorted = [...active].sort(
    (a, b) => b.points - a.points || Math.random() - 0.5,
  );

  let byePlayer: ITournamentPlayer | null = null;
  if (sorted.length % 2 === 1) {
    let byeTaken = false;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (!sorted[i].hadBye) {
        byePlayer = sorted[i];
        sorted.splice(i, 1);
        byeTaken = true;
        break;
      }
    }
    if (!byeTaken) byePlayer = sorted.pop()!;
  }

  const remaining = [...sorted];
  const pairs: [ITournamentPlayer, ITournamentPlayer][] = [];
  while (remaining.length > 0) {
    const a = remaining.shift()!;
    let idx = remaining.findIndex(
      (b) => !priorOpponents.get(a.user.toString())?.has(b.user.toString()),
    );
    if (idx === -1) idx = 0;
    const b = remaining.splice(idx, 1)[0];
    pairs.push([a, b]);
  }

  const pairings: ITournamentPairing[] = pairs.map(([a, b], i) =>
    emptyPairing(i, a.user, b.user),
  );
  if (byePlayer)
    pairings.push(emptyPairing(pairings.length, byePlayer.user, null));

  return { index: roundIndex, status: "pending", pairings };
}

// --- Starting the event / activating a round ------------------------------

export async function startTournament(
  tournamentId: string,
  requesterId: string,
): Promise<ITournament> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (tournament.createdBy.toString() !== requesterId)
    throw ApiError.forbidden("Only the organizer can start this");
  if (tournament.status !== "pending")
    throw ApiError.conflict("This tournament has already started");
  if (tournament.players.length < tournament.minPlayers) {
    throw ApiError.badRequest(
      `Needs at least ${tournament.minPlayers} players to start`,
    );
  }

  // Manual early start — the creator doesn't have to wait out the full
  // scheduledStartAt if the lobby's already ready to go.
  await activateTournament(tournament);
  return tournament;
}

/** Shared by both the manual "Start now" action and the scheduled
 *  auto-start timer firing — builds the first round's pairings and flips
 *  the tournament into 'active'. Assumes the caller has already checked
 *  authorization and minPlayers; this just does the state transition. */
async function activateTournament(tournament: ITournament): Promise<void> {
  clearPendingAutoStart(tournament.id);
  tournament.status = "active";
  tournament.startedAt = new Date();
  tournament.scheduledStartAt = null;

  const playerIds = tournament.players.map((p: ITournamentPlayer) => p.user);
  if (tournament.format === "normal") {
    tournament.rounds.push(buildKnockoutRound0(playerIds));
  } else if (tournament.format === "swiss") {
    tournament.rounds.push(buildSwissRound(tournament, 0));
  } else {
    const doubled = tournament.format === "round_robin";
    const schedule = circleMethodSchedule(
      playerIds.map((id: any) => id.toString()),
      doubled,
    );
    schedule.forEach((pairs, roundIdx) => {
      tournament.rounds.push({
        index: roundIdx,
        status: "pending",
        pairings: pairs.map(([a, b], i) => emptyPairing(i, a, b)),
      });
    });
  }

  await tournament.save();
  broadcastUpdate(tournament, "tournament:started");
  await activateRound(tournament, 0);
}

/** Turns a round's pending pairings into reality: creates the actual Game for
 *  every real pairing (randomizing colors, same convention as cage match
 *  legs), and immediately resolves any bye as a full point with no game
 *  needed. If every pairing in the round happens to be a bye, the round
 *  completes itself right away and cascades into the next one. Also notifies
 *  each paired-up player individually (see notifyPairingReady) so they land
 *  on their game — or at least hear about it — the moment it's ready. */
async function activateRound(
  tournament: ITournament,
  roundIndex: number,
): Promise<void> {
  const round = tournament.rounds[roundIndex];
  round.status = "active";
  round.startedAt = new Date();

  const timeControl: TimeControlInput = {
    baseMinutes: tournament.baseMinutes,
    incrementSeconds: tournament.incrementSeconds,
  };

  // Collected as pairings activate below, then notified once the round's
  // state is fully saved — so a player clicking straight through never
  // races the DB write that made their game real.
  const readyPlayers: { userId: string; joinCode: string }[] = [];

  for (const pairing of round.pairings) {
    if (pairing.player2 === null) {
      pairing.status = "finished";
      pairing.result = "p1";
      pairing.endReason = "bye";
      const p1 = findPlayer(tournament, pairing.player1);
      if (p1) p1.hadBye = true;
      applyPairingScore(
        tournament,
        pairing,
        "p1",
        { p1: false, p2: false },
        roundIndex,
      );
      continue;
    }

    const [whiteId, blackId] =
      Math.random() < 0.5
        ? [pairing.player1.toString(), pairing.player2.toString()]
        : [pairing.player2.toString(), pairing.player1.toString()];
    const game = await createDirectGame(
      whiteId,
      blackId,
      timeControl,
      undefined,
      tournament.variant,
      0,
      undefined,
      { tournamentId: tournament.id, roundIndex, pairingIndex: pairing.index },
    );
    pairing.whiteId = whiteId as any;
    pairing.blackId = blackId as any;
    pairing.gameId = game._id;
    pairing.joinCode = game.joinCode;
    pairing.status = "active";
    readyPlayers.push({ userId: whiteId, joinCode: game.joinCode }, { userId: blackId, joinCode: game.joinCode });
  }

  await tournament.save();
  broadcastUpdate(tournament);
  notifyPairingReady(tournament, readyPlayers);
  await maybeCompleteRound(tournament, roundIndex);
}

/** Tells each paired-up player, individually, that their game for this round
 *  is ready — separate from broadcastUpdate's room-wide "something changed,
 *  go refetch" ping, since this needs to reach a specific two people with a
 *  specific joinCode they can act on immediately (auto-redirect if they're
 *  sitting on the tournament page, a "play it now" notification otherwise —
 *  see GlobalListeners.tsx's tournament:pairing_ready handler). */
function notifyPairingReady(
  tournament: ITournament,
  readyPlayers: { userId: string; joinCode: string }[],
): void {
  if (readyPlayers.length === 0) return;
  try {
    const io = getIo();
    for (const { userId, joinCode } of readyPlayers) {
      io.to(`user:${userId}`).emit("tournament:pairing_ready", {
        tournamentId: tournament.id,
        code: tournament.code,
        joinCode,
      });
    }
  } catch {
    // Socket.IO not initialized (script/test context) — the pairing is
    // still correctly persisted; the player just won't get the live nudge.
  }
}

// --- Scoring ---------------------------------------------------------------

function applyPairingScore(
  tournament: ITournament,
  pairing: ITournamentPairing,
  result: "p1" | "p2" | "draw",
  berserk: { p1: boolean; p2: boolean },
  roundIndex: number,
): void {
  const p1 = findPlayer(tournament, pairing.player1);
  const p2 = pairing.player2 ? findPlayer(tournament, pairing.player2) : null;

  if (tournament.format === "normal") {
    // Knockout doesn't use a points table — only who's still alive matters.
    if (p2) {
      const loser = result === "p1" ? p2 : p1;
      if (loser) loser.eliminatedRound = roundIndex;
    }
    return;
  }

  if (!p2) {
    // Bye — counts as having played the round (for pairing/hadBye purposes)
    // but awards no points, unlike a real win. A bye isn't a game anyone
    // actually won.
    return;
  }

  if (result === "draw") {
    if (p1) {
      p1.points += 0.5;
      p1.gamesPlayed += 1;
    }
    if (p2) {
      p2.points += 0.5;
      p2.gamesPlayed += 1;
    }
  } else {
    const winner = result === "p1" ? p1 : p2;
    const loser = result === "p1" ? p2 : p1;
    const winnerBerserked = result === "p1" ? berserk.p1 : berserk.p2;
    if (winner) {
      // A won-after-berserking game earns a 0.5 bonus on top of the normal
      // point — same risk/reward shape as Lichess arena berserking, just
      // applied to swiss/round-robin point totals instead of arena streaks.
      winner.points += winnerBerserked ? 1.5 : 1;
      winner.gamesPlayed += 1;
      if (winnerBerserked) winner.berserkWins += 1;
    }
    if (loser) loser.gamesPlayed += 1;
  }

  // Simplified Buchholz-style tiebreaker: accumulate each opponent's points
  // total at the time this game was scored. Not a strict FIDE Buchholz (that
  // sums opponents' FINAL scores), but a reasonable running proxy that keeps
  // ties resolved sensibly without needing a second recompute pass.
  if (p1 && p2) p1.tiebreak += p2.points;
  if (p1 && p2) p2.tiebreak += p1.points;
}

export function rankPlayers(tournament: ITournament): ITournamentPlayer[] {
  return [...tournament.players]
    .filter((p) => !p.withdrawn)
    .sort((a, b) => b.points - a.points || b.tiebreak - a.tiebreak);
}

// --- Round completion / advancement -----------------------------------------

async function maybeCompleteRound(
  tournament: ITournament,
  roundIndex: number,
): Promise<void> {
  const round = tournament.rounds[roundIndex];
  if (round.status === "finished") return;
  if (round.pairings.some((p) => p.status !== "finished")) return;

  round.status = "finished";
  round.endedAt = new Date();
  await tournament.save();
  await advanceAfterRound(tournament, roundIndex);
}

async function advanceAfterRound(
  tournament: ITournament,
  roundIndex: number,
): Promise<void> {
  if (tournament.format === "normal") {
    const round = tournament.rounds[roundIndex];
    const winners = round.pairings.map((p) =>
      p.result === "p1" ? p.player1 : p.player2!,
    );
    if (winners.length === 1) {
      await finishTournament(tournament, winners[0].toString());
      return;
    }
    const nextPairings: ITournamentPairing[] = [];
    for (let i = 0; i < winners.length; i += 2) {
      nextPairings.push(emptyPairing(i / 2, winners[i], winners[i + 1]));
    }
    tournament.rounds.push({
      index: roundIndex + 1,
      status: "pending",
      pairings: nextPairings,
    });
    tournament.currentRoundIndex = roundIndex + 1;
    await tournament.save();
    await scheduleRoundStart(tournament, roundIndex + 1);
    return;
  }

  if (tournament.format === "swiss") {
    const totalRounds = tournament.swissRounds ?? 1;
    if (roundIndex + 1 >= totalRounds) {
      await finishTournament(tournament);
      return;
    }
    tournament.rounds.push(buildSwissRound(tournament, roundIndex + 1));
    tournament.currentRoundIndex = roundIndex + 1;
    await tournament.save();
    await scheduleRoundStart(tournament, roundIndex + 1);
    return;
  }

  // robin / round_robin — the whole schedule was pre-built at start time.
  if (roundIndex + 1 < tournament.rounds.length) {
    tournament.currentRoundIndex = roundIndex + 1;
    await tournament.save();
    await scheduleRoundStart(tournament, roundIndex + 1);
  } else {
    await finishTournament(tournament);
  }
}

async function finishTournament(
  tournament: ITournament,
  explicitKnockoutWinner?: string,
): Promise<void> {
  tournament.status = "finished";
  tournament.endedAt = new Date();

  if (tournament.format === "normal") {
    tournament.winner = explicitKnockoutWinner as any;
    const finalRound = tournament.rounds[tournament.rounds.length - 1];
    const finalPairing = finalRound.pairings[0];
    if (finalPairing?.player2) {
      tournament.runnerUp = (
        finalPairing.result === "p1"
          ? finalPairing.player2
          : finalPairing.player1
      ) as any;
    }
  } else {
    const ranked = rankPlayers(tournament);
    tournament.winner = (ranked[0]?.user as any) ?? null;
    tournament.runnerUp = (ranked[1]?.user as any) ?? null;
  }

  await tournament.save();
  await distributePrize(tournament);
  broadcastUpdate(tournament, "tournament:finished");
}

/** Full 1st-through-last ordering for the whole field, used to match players
 *  up against the creator's prize schedule by rank. For points-based
 *  formats this is just rankPlayers' order with anyone who withdrew tacked
 *  on the end (they're excluded from rankPlayers, but still occupy a rank
 *  for schedule purposes if the schedule happens to reach that far).
 *  Knockout has no points table, so it's built from bracket position
 *  instead: winner, runner-up, then everyone else grouped by which round
 *  eliminated them (later round = better placement) — ties within a group
 *  (e.g. two people both lost in the semifinal) aren't distinguishable by
 *  this system, so they're ordered by username just to be deterministic. */
function computeFinalRanking(tournament: ITournament): Types.ObjectId[] {
  if (tournament.format === "normal") {
    const order: Types.ObjectId[] = [];
    const seen = new Set<string>();
    if (tournament.winner) {
      order.push(tournament.winner);
      seen.add(tournament.winner.toString());
    }
    if (tournament.runnerUp) {
      order.push(tournament.runnerUp);
      seen.add(tournament.runnerUp.toString());
    }
    const rest = tournament.players
      .filter((p: ITournamentPlayer) => !seen.has(p.user.toString()))
      .sort(
        (a: ITournamentPlayer, b: ITournamentPlayer) =>
          (b.eliminatedRound ?? -1) - (a.eliminatedRound ?? -1) || a.username.localeCompare(b.username),
      );
    for (const p of rest) order.push(p.user);
    return order;
  }

  const ranked = rankPlayers(tournament);
  const rankedIds = new Set(ranked.map((p) => p.user.toString()));
  const withdrawn = tournament.players.filter((p: ITournamentPlayer) => !rankedIds.has(p.user.toString()));
  return [...ranked.map((p) => p.user), ...withdrawn.map((p: ITournamentPlayer) => p.user)];
}

/** Settles both independent money flows once a tournament finishes — see
 *  the ITournament doc comment in Tournament.ts. Each flow is claimed with
 *  its own atomic findOneAndUpdate guard, same pattern as the old single
 *  prizeSettled flag, so a retry (e.g. from advanceTournamentIfPairing being
 *  called twice for the same final result) can't double-pay either one. */
async function distributePrize(tournament: ITournament): Promise<void> {
  if (tournament.prizePoolTokens > 0 && !tournament.prizePoolSettled) {
    const claimed = await Tournament.findOneAndUpdate(
      { _id: tournament.id, prizePoolSettled: false },
      { $set: { prizePoolSettled: true } },
    );
    if (claimed) {
      const ranking = computeFinalRanking(tournament);
      let paidOut = 0;
      for (const tier of tournament.prizeSchedule) {
        if (tier.tokens <= 0) continue;
        for (let rank = tier.fromRank; rank <= tier.toRank; rank++) {
          const userId = ranking[rank - 1];
          if (!userId) continue;
          await creditTournamentReturn(
            userId.toString(),
            tournament.id,
            tier.tokens,
            "tournament_payout",
            `r${rank}`,
          );
          paidOut += tier.tokens;
        }
      }
      // A schedule tier can outreach the actual field (e.g. "9th-15th" in a
      // 10-player event) — whatever couldn't be handed to a real finisher
      // goes back to whoever funded the pool, rather than vanishing.
      const unused = tournament.prizePoolTokens - paidOut;
      if (unused > 0) {
        await creditTournamentReturn(
          tournament.createdBy.toString(),
          tournament.id,
          unused,
          "tournament_refund",
          "unused",
        );
      }
    }
  }

  if (tournament.regFeePoolTokens > 0 && !tournament.regFeeSettled) {
    const claimed = await Tournament.findOneAndUpdate(
      { _id: tournament.id, regFeeSettled: false },
      { $set: { regFeeSettled: true } },
    );
    if (claimed) {
      await creditTournamentReturn(
        tournament.createdBy.toString(),
        tournament.id,
        tournament.regFeePoolTokens,
        "tournament_reg_revenue",
      );
    }
  }
}

function broadcastUpdate(
  tournament: ITournament,
  event: "tournament:update" | "tournament:finished" | "tournament:started" | "tournament:cancelled" = "tournament:update",
) {
  try {
    getIo()
      .to(`tournament:${tournament.id}`)
      .emit(event, { tournamentId: tournament.id, code: tournament.code });
  } catch {
    // Socket.IO not initialized (script/test context) — state is still
    // correctly persisted; clients pick it up on next fetch/reconnect.
  }
}

// --- Reacting to a pairing's game finishing ---------------------------------

/** Called once a pairing's underlying Game finishes (checkmate, timeout,
 *  resignation, draw, abandonment). Records the result, updates standings,
 *  and cascades round completion / tournament progression exactly like
 *  advanceCageMatchLeg does for cage matches. Shared by the live socket path
 *  and the boot/periodic reconciliation sweep. Safe to call more than once
 *  for the same pairing (a no-op past the first call), same idempotency
 *  guard shape as the cage match equivalent. */
export async function advanceTournamentIfPairing(
  tournamentId: string,
  roundIndex: number,
  pairingIndex: number,
  gameResult: "white" | "black" | "draw",
  endReason: string,
): Promise<ITournament | null> {
  try {
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) return null;
    const round = tournament.rounds[roundIndex];
    const pairing = round?.pairings[pairingIndex];
    if (!pairing || pairing.status !== "active") return null; // already processed

    let resultP: "p1" | "p2" | "draw" = "draw";
    let berserk = { p1: false, p2: false };

    if (pairing.gameId) {
      const gameDoc = await Game.findById(pairing.gameId)
        .select("white black berserk")
        .lean();
      if (!gameDoc) throw ApiError.internal("Pairing game record missing");
      const whiteIsP1 = gameDoc.white.toString() === pairing.player1.toString();
      if (gameResult === "draw") resultP = "draw";
      else if (gameResult === "white") resultP = whiteIsP1 ? "p1" : "p2";
      else resultP = whiteIsP1 ? "p2" : "p1";
      berserk = {
        p1: whiteIsP1 ? !!gameDoc.berserk?.white : !!gameDoc.berserk?.black,
        p2: whiteIsP1 ? !!gameDoc.berserk?.black : !!gameDoc.berserk?.white,
      };
    }

    // A knockout bracket needs a single decisive winner — there's no natural
    // decisive mechanism available here (no rematch/playoff games in scope),
    // so a drawn knockout pairing is broken by a coin flip. Documented
    // simplification, not a FIDE tiebreak.
    if (
      tournament.format === "normal" &&
      pairing.player2 &&
      resultP === "draw"
    ) {
      resultP = Math.random() < 0.5 ? "p1" : "p2";
      endReason = `${endReason}_coinflip`;
    }

    pairing.status = "finished";
    pairing.result = resultP;
    pairing.endReason = endReason;
    pairing.berserk = berserk;

    applyPairingScore(tournament, pairing, resultP, berserk, roundIndex);
    await tournament.save();
    broadcastUpdate(tournament);

    await maybeCompleteRound(tournament, roundIndex);
    return tournament;
  } catch (err) {
    console.error("tournament pairing advance failed:", err);
    return null;
  }
}

// --- Berserk -----------------------------------------------------------------

export async function berserkInTournamentGame(
  gameId: string,
  userId: string,
): Promise<"white" | "black"> {
  const gameDoc = await Game.findById(gameId)
    .select("tournamentId roundIndex pairingIndex")
    .lean();
  if (
    !gameDoc?.tournamentId ||
    gameDoc.roundIndex === undefined ||
    gameDoc.pairingIndex === undefined
  ) {
    throw new BerserkNotAllowedError("This isn't a tournament game");
  }
  const tournament = await Tournament.findById(gameDoc.tournamentId).select(
    "berserkAllowed rounds",
  );
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (!tournament.berserkAllowed)
    throw new BerserkNotAllowedError(
      "Berserking is turned off for this tournament",
    );

  // The authoritative flag scoring reads from lives on the Game document
  // (set just below). The mirrored flag on the pairing is only so the
  // tournament view can show a live "berserked" badge before the game ends.
  const pairing =
    tournament.rounds[gameDoc.roundIndex]?.pairings[gameDoc.pairingIndex];

  const { side } = await applyBerserk(gameId, userId);
  await Game.updateOne(
    { _id: gameId },
    { $set: { [`berserk.${side}`]: true } },
  );

  if (pairing) {
    const isP1 = pairing.player1.toString() === userId;
    if (isP1) pairing.berserk.p1 = true;
    else pairing.berserk.p2 = true;
    await tournament.save();
    broadcastUpdate(tournament as unknown as ITournament);
  }

  return side;
}

// --- Withdrawing from an already-active tournament --------------------------

/** Backs a player out of a tournament that's already running. If they have a
 *  live pairing in progress this round, it's resolved as a loss for them
 *  (same tokens-neutral treatment as a resignation — there's no per-game
 *  wager inside a tournament to settle). They're excluded from all future
 *  pairing generation via the `withdrawn` flag. */
export async function withdrawFromTournament(
  tournamentId: string,
  userId: string,
): Promise<ITournament> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (tournament.status !== "active")
    throw ApiError.conflict("This tournament isn't currently active");
  const player = findPlayer(tournament, userId);
  if (!player) throw ApiError.badRequest("You're not in this tournament");
  if (player.withdrawn) return tournament;

  player.withdrawn = true;

  const round = tournament.rounds[tournament.currentRoundIndex];
  const pairing = round?.pairings.find(
    (p) =>
      p.status === "active" &&
      (p.player1.toString() === userId || p.player2?.toString() === userId),
  );

  if (pairing?.gameId) {
    const gameId = pairing.gameId.toString();
    const liveState = await getLiveState(gameId);
    if (liveState && liveState.status === "active") {
      clearGameTimer(gameId);
      const winnerColor = liveState.whiteId === userId ? "black" : "white";
      const finalState = await endGame(gameId, winnerColor, "withdrawn");
      await finalizeGame(
        gameId,
        finalState.fen,
        "finished",
        winnerColor,
        "withdrawn",
      );
      await deleteLiveState(gameId);
      try {
        getIo().to(`game:${gameId}`).emit("game:over", {
          gameId,
          result: winnerColor,
          reason: "withdrawn",
        });
      } catch {
        // Socket.IO not initialized — safe to ignore.
      }
    }
  }

  await tournament.save();

  if (pairing) {
    await advanceTournamentIfPairing(
      tournament.id,
      tournament.currentRoundIndex,
      pairing.index,
      "draw",
      "withdrawn",
    ).catch((err) =>
      console.error("advanceTournamentIfPairing after withdrawal failed:", err),
    );
  }

  return tournament;
}

// --- Reads ---------------------------------------------------------------------

/** Strips the password hash out of a lean tournament doc, replacing it with
 *  a plain hasPassword boolean the client can use to decide whether to show
 *  a password field on join — never send the hash itself down the wire. */
function sanitizeForClient<T extends { passwordHash?: string | null }>(
  doc: T,
): Omit<T, "passwordHash"> & { hasPassword: boolean } {
  const { passwordHash, ...rest } = doc;
  return { ...rest, hasPassword: !!passwordHash };
}

export async function getTournamentByCode(codeOrId: string) {
  const mongoose = await import("mongoose");
  const query = mongoose.isValidObjectId(codeOrId)
    ? { $or: [{ code: codeOrId }, { _id: codeOrId }] }
    : { code: codeOrId };
  const tournament = await Tournament.findOne(query).lean();
  if (!tournament) throw ApiError.notFound("Tournament not found");
  return sanitizeForClient(tournament);
}

/** Only tournaments the creator opted to list publicly (isPublic) show up
 *  here — everything else is reachable only via its direct link/code. See
 *  the ITournament doc comment. */
export async function listTournaments(
  status?: "pending" | "active" | "finished",
) {
  const query: Record<string, unknown> = { isPublic: true };
  query.status = status ?? { $ne: "cancelled" };
  const tournaments = await Tournament.find(query)
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return tournaments.map(sanitizeForClient);
}

export async function listMyTournaments(userId: string) {
  const tournaments = await Tournament.find({ "players.user": userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return tournaments.map(sanitizeForClient);
}
