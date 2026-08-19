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
  adjustTournamentEscrow,
  computeRake,
  recordRake,
} from "./wallet.service.js";
import { applyRatingForGame } from "./rating.service.js";
import { getIo } from "../sockets/io.js";
import { isUserOnline } from "./presence.service.js";

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

  // Same self-heal, same reasoning, for arena's own in-memory end timer —
  // a restart mid-arena would otherwise leave arenaEndsAt sitting there
  // with nothing watching it.
  const pendingArenaEnds = await Tournament.find({
    status: "active",
    format: "arena",
    arenaEndsAt: { $ne: null },
  }).select("arenaEndsAt");

  for (const doc of pendingArenaEnds) {
    const dueAt = doc.arenaEndsAt ? doc.arenaEndsAt.getTime() : 0;
    if (dueAt <= now) {
      await fireArenaEnd(doc.id);
    } else if (!pendingArenaEndTimers.has(doc.id)) {
      const timer = setTimeout(() => {
        pendingArenaEndTimers.delete(doc.id);
        fireArenaEnd(doc.id).catch((err) => console.error("re-armed arena end failed:", err));
      }, dueAt - now);
      timer.unref?.();
      pendingArenaEndTimers.set(doc.id, timer);
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
// Every format has its own sane player-count bounds — knockout tolerates any
// field size >= 2 (byes soak up the gap to the next power of two), swiss
// wants enough players to make several rounds meaningful, round-robin is
// capped fairly low since game count grows quadratically (and again with
// each extra robinRounds lap), and arena tolerates a much larger field
// since players aren't all locked into synchronized rounds together — a
// big arena just means more simultaneous games, not more rounds.
const FORMAT_BOUNDS: Record<TournamentFormat, { min: number; max: number }> = {
  normal: { min: 2, max: 64 },
  swiss: { min: 4, max: 64 },
  robin: { min: 3, max: 20 },
  round_robin: { min: 3, max: 14 },
  arena: { min: 4, max: 100 },
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
  // If true, the creator runs the event without playing in it — they're
  // never added to `players` and never charged regFeeTokens (they still
  // fund the prize pool, if any, same as any other creator). Defaults to
  // false. Immutable after creation — see the ITournament doc comment.
  organizerOnly?: boolean;
  // Prize pool: creator-funded, paid out by final rank. Empty/omitted = no
  // prize pool. See the ITournament doc comment in Tournament.ts.
  prizeSchedule?: { fromRank: number; toRank: number; tokens: number }[];
  // Registration fee: player-funded, the whole pool goes to the creator once
  // the event finishes. 0/omitted = no registration fee.
  regFeeTokens?: number;
  // Required (and only meaningful) for format === 'swiss'.
  swissRounds: number | null;
  // Only meaningful for format === 'round_robin' — how many laps through
  // the field (1-4). Omitted/null defaults to 1 (a single round-robin).
  robinRounds?: number | null;
  // Required (and only meaningful) for format === 'arena' — how long the
  // event runs once started, in minutes.
  arenaMinutes?: number | null;
  // Seconds to pause between rounds — see the ITournament doc comment.
  // Optional on input; defaults to 10 like the schema itself.
  breakSeconds?: number;
  // When the event starts itself — required, must be far enough in the
  // future to give players time to join (see MIN_START_DELAY_MS). There's
  // no manual early-start override — every tournament starts at the time
  // it announced, so everyone who's planning around that start time (and
  // anyone still deciding whether to join before then) can rely on it.
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
  creatorAvatarGradient: string | null,
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
  if (
    input.format === "round_robin" &&
    input.robinRounds != null &&
    (input.robinRounds < 1 || input.robinRounds > 4)
  ) {
    throw ApiError.badRequest(
      "Choose between 1 and 4 laps for a round-robin tournament",
    );
  }
  if (
    input.format === "arena" &&
    (!input.arenaMinutes || input.arenaMinutes < 5 || input.arenaMinutes > 360)
  ) {
    throw ApiError.badRequest(
      "Choose an arena duration between 5 and 360 minutes",
    );
  }
  const regFeeTokens = input.regFeeTokens ?? 0;
  if (regFeeTokens < 1 || regFeeTokens > MAX_WAGER_TOKENS) {
    throw ApiError.badRequest("A registration fee is required for every tournament");
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
  const organizerOnly = input.organizerOnly ?? false;
  const tournament = await Tournament.create({
    code,
    name: input.name.trim(),
    createdBy: creatorId,
    organizerOnly,
    format: input.format,
    variant: input.variant,
    baseMinutes: input.baseMinutes,
    incrementSeconds: input.incrementSeconds,
    status: "pending",
    minPlayers: bounds.min,
    maxPlayers: input.maxPlayers,
    // organizerOnly: the creator runs the event but never occupies a
    // player slot themselves, so they're left out of the roster entirely
    // — see the debit block below for the matching skip of their own
    // registration fee.
    players: organizerOnly
      ? []
      : [
          {
            user: creatorId,
            username: creatorUsername,
            avatarGradient: creatorAvatarGradient,
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
    robinRounds: input.format === "round_robin" ? (input.robinRounds ?? 1) : null,
    arenaMinutes: input.format === "arena" ? input.arenaMinutes : null,
    breakSeconds: input.breakSeconds ?? DEFAULT_BREAK_SECONDS,
    scheduledStartAt,
  });

  // The creator funds the ENTIRE prize pool up front regardless of whether
  // they're playing — and, if they ARE auto-joined as the first player
  // (i.e. not organizerOnly), also pays their own registration fee like
  // any other entrant. Either debit failing rolls the whole tournament
  // back rather than leaving a half-funded event around.
  try {
    if (prizePoolTokens > 0) await debitTournamentPrizeFund(creatorId, tournament.id, prizePoolTokens);
    if (!organizerOnly && regFeeTokens > 0) {
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

/** Whether `tournament` is still accepting new players right now. Every
 *  format accepts joins while pending. Arena and swiss additionally accept
 *  "late" joins after the event has started — arena because its pairing
 *  queue is continuous and a newcomer can simply be dropped into the next
 *  pairing wave (see tryArenaPairings), swiss because a fresh round is
 *  built from tournament.players from scratch each time (see
 *  buildSwissRound) so a newcomer just starts appearing in whichever round
 *  gets built next. Knockout and round-robin can't sensibly accept
 *  latecomers — their entire schedule (the bracket, or the round-robin
 *  circle) is fixed the moment the event starts. */
function acceptingJoins(tournament: ITournament): boolean {
  if (tournament.status === "pending") return true;
  if (tournament.status !== "active") return false;
  if (tournament.format === "arena") {
    return (
      !!tournament.arenaEndsAt && Date.now() < tournament.arenaEndsAt.getTime()
    );
  }
  if (tournament.format === "swiss") {
    const totalRounds = tournament.swissRounds ?? 1;
    // Joining only matters if there's still at least one round left that
    // hasn't been built yet — joining during literally the last round
    // would mean sitting there paying a registration fee for a tournament
    // that's already effectively over for them.
    return tournament.currentRoundIndex < totalRounds - 1;
  }
  return false;
}

export async function joinTournament(
  tournamentId: string,
  userId: string,
  username: string,
  avatarGradient: string | null,
  password?: string,
): Promise<ITournament> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (!acceptingJoins(tournament))
    throw ApiError.conflict(
      tournament.status === "pending"
        ? "This tournament has already started"
        : "It's too late to join this tournament",
    );
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
    avatarGradient,
    points: 0,
    tiebreak: 0,
    gamesPlayed: 0,
    berserkWins: 0,
    eliminatedRound: null,
    hadBye: false,
    withdrawn: false,
    paused: false,
    joinedAt: dateObject,
  });
  await tournament.save();

  // A late joiner into an already-running arena might be pairable right
  // now if someone else happens to be free — no reason to make them wait
  // for the next unrelated pairing event. Swiss doesn't need the
  // equivalent here: they'll simply be included the next time a round is
  // built (see buildSwissRound), which only happens at a round boundary
  // anyway, not something joining can trigger early.
  if (tournament.status === "active" && tournament.format === "arena") {
    await tryArenaPairings(tournament);
  }

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
    await creditTournamentReturn(userId, tournament.id, tournament.regFeeTokens, "tournament_refund", "reg");
    tournament.regFeePoolTokens = Math.max(0, tournament.regFeePoolTokens - tournament.regFeeTokens);
  }

  const wasCreator = tournament.createdBy.toString() === userId;
  if (wasCreator && tournament.prizePoolTokens > 0 && !tournament.prizePoolSettled) {
    await creditTournamentReturn(userId, tournament.id, tournament.prizePoolTokens, "tournament_refund", "prize");
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

/** Shared refund path for both cancelling and (formerly) deleting a
 *  tournament before it's settled anything on its own — everyone who paid a
 *  registration fee gets it back, and the creator gets the prize pool they
 *  funded back (if it hasn't already been distributed). Distinct suffixes
 *  on each credit ("reg" vs "prize") because the creator is always also a
 *  player — without them, refunding both to the same person for the same
 *  tournament would produce the exact same reference string twice and trip
 *  the Transaction model's unique index. Mutates and saves the passed-in
 *  document but leaves status/deletion to the caller. */
async function refundAllEscrow(tournament: ITournament): Promise<void> {
  if (tournament.regFeeTokens > 0 && !tournament.regFeeSettled) {
    await Promise.all(
      tournament.players.map((p: ITournamentPlayer) =>
        creditTournamentReturn(p.user.toString(), tournament.id, tournament.regFeeTokens, "tournament_refund", "reg"),
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
      "prize",
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

export interface UpdateTournamentInput {
  name?: string;
  format?: TournamentFormat;
  variant?: "standard" | "chess960";
  baseMinutes?: number | null;
  incrementSeconds?: number;
  maxPlayers?: number;
  berserkAllowed?: boolean;
  isPublic?: boolean;
  prizeSchedule?: { fromRank: number; toRank: number; tokens: number }[];
  regFeeTokens?: number;
  swissRounds?: number | null;
  robinRounds?: number | null;
  arenaMinutes?: number | null;
  breakSeconds?: number;
  scheduledStartAt?: string | Date;
  // undefined = leave the password as-is; null = remove it; a string = set/replace it.
  password?: string | null;
}

/** Only available while the creator is still the sole player — the moment
 *  anyone else joins, every field here becomes load-bearing for someone
 *  else's expectations (they joined knowing the time control, the fee,
 *  etc), so editing stops being safe and cancel-and-recreate is the only
 *  path. Because of that restriction, the only money ever at stake here is
 *  the creator's own — no other player's escrow needs touching. Every field
 *  is optional and independently omittable; omitted fields keep their
 *  current value. */
export async function updateTournament(
  tournamentId: string,
  requesterId: string,
  input: UpdateTournamentInput,
): Promise<ITournament> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (tournament.createdBy.toString() !== requesterId)
    throw ApiError.forbidden("Only the organizer can edit this");
  if (tournament.status !== "pending")
    throw ApiError.conflict("This tournament has already started");
  // Editable only while nobody but possibly the creator has joined.
  // organizerOnly tournaments never count the creator as a player (see
  // createTournament), so their "safe to edit" threshold is 0 joined
  // players rather than 1.
  const maxEditablePlayers = tournament.organizerOnly ? 0 : 1;
  if (tournament.players.length > maxEditablePlayers)
    throw ApiError.conflict("Can't edit a tournament once other players have joined");

  const format = input.format ?? tournament.format;
  const bounds = FORMAT_BOUNDS[format];
  if (!bounds) throw ApiError.badRequest("Unknown tournament format");

  const name = input.name !== undefined ? input.name.trim() : tournament.name;
  if (name.length < 3)
    throw ApiError.badRequest("Give your tournament a name (at least 3 characters)");

  const maxPlayers = input.maxPlayers ?? tournament.maxPlayers;
  if (maxPlayers < bounds.min || maxPlayers > bounds.max) {
    throw ApiError.badRequest(
      `A ${format} tournament supports between ${bounds.min} and ${bounds.max} players`,
    );
  }

  const baseMinutes = input.baseMinutes !== undefined ? input.baseMinutes : tournament.baseMinutes;
  if (baseMinutes !== null && (baseMinutes < 1 || baseMinutes > 180)) {
    throw ApiError.badRequest("Base time must be between 1 and 180 minutes (or unlimited)");
  }
  const incrementSeconds = input.incrementSeconds ?? tournament.incrementSeconds;
  if (incrementSeconds < 0 || incrementSeconds > 60) {
    throw ApiError.badRequest("Increment must be between 0 and 60 seconds");
  }

  const swissRounds = format === "swiss" ? (input.swissRounds ?? tournament.swissRounds) : null;
  if (format === "swiss" && (!swissRounds || swissRounds < 3 || swissRounds > 15)) {
    throw ApiError.badRequest("Choose between 3 and 15 rounds for a swiss tournament");
  }

  const robinRounds =
    format === "round_robin" ? (input.robinRounds ?? tournament.robinRounds ?? 1) : null;
  if (format === "round_robin" && robinRounds != null && (robinRounds < 1 || robinRounds > 4)) {
    throw ApiError.badRequest("Choose between 1 and 4 laps for a round-robin tournament");
  }

  const arenaMinutes = format === "arena" ? (input.arenaMinutes ?? tournament.arenaMinutes) : null;
  if (format === "arena" && (!arenaMinutes || arenaMinutes < 5 || arenaMinutes > 360)) {
    throw ApiError.badRequest("Choose an arena duration between 5 and 360 minutes");
  }

  const regFeeTokens = input.regFeeTokens ?? tournament.regFeeTokens;
  if (regFeeTokens < 1 || regFeeTokens > MAX_WAGER_TOKENS) {
    throw ApiError.badRequest("A registration fee is required for every tournament");
  }

  const breakSeconds = input.breakSeconds ?? tournament.breakSeconds;
  if (breakSeconds < 0 || breakSeconds > MAX_BREAK_SECONDS) {
    throw ApiError.badRequest(`Break between rounds must be between 0 and ${MAX_BREAK_SECONDS} seconds`);
  }

  let scheduledStartAt = tournament.scheduledStartAt;
  if (input.scheduledStartAt !== undefined) {
    scheduledStartAt = new Date(input.scheduledStartAt);
    const startDelay = scheduledStartAt.getTime() - Date.now();
    if (Number.isNaN(scheduledStartAt.getTime()) || startDelay < MIN_START_DELAY_MS) {
      throw ApiError.badRequest("Pick a start time at least a few seconds from now");
    }
    if (startDelay > MAX_START_DELAY_MS) {
      throw ApiError.badRequest("That start time is too far in the future");
    }
  }

  const { tiers: prizeSchedule, total: prizePoolTokens } = validatePrizeSchedule(
    input.prizeSchedule ??
      tournament.prizeSchedule.map((t) => ({ fromRank: t.fromRank, toRank: t.toRank, tokens: t.tokens })),
    maxPlayers,
  );

  // The creator is the only (possible) player so far, so their own reg-fee
  // contribution IS the whole pool — adjusting the fee just means adjusting
  // what they personally already paid in. organizerOnly tournaments skip
  // this entirely: the creator was never charged a registration fee at
  // creation time (they're not a player), so there's nothing of theirs to
  // adjust here either — see createTournament's matching skip.
  const prizeDelta = prizePoolTokens - tournament.prizePoolTokens;
  const regFeeDelta = regFeeTokens - tournament.regFeeTokens;
  if (prizeDelta !== 0) {
    await adjustTournamentEscrow(requesterId, tournament.id, prizeDelta, "tournament_prize_fund");
  }
  if (!tournament.organizerOnly && regFeeDelta !== 0) {
    await adjustTournamentEscrow(requesterId, tournament.id, regFeeDelta, "tournament_reg_fee");
    tournament.regFeePoolTokens = regFeeTokens;
  }

  if (input.password !== undefined) {
    tournament.passwordHash = input.password?.trim()
      ? await bcrypt.hash(input.password.trim(), PASSWORD_BCRYPT_ROUNDS)
      : null;
  }

  tournament.name = name;
  tournament.format = format;
  tournament.variant = input.variant ?? tournament.variant;
  tournament.baseMinutes = baseMinutes;
  tournament.incrementSeconds = incrementSeconds;
  tournament.maxPlayers = maxPlayers;
  tournament.minPlayers = bounds.min;
  tournament.berserkAllowed = input.berserkAllowed ?? tournament.berserkAllowed;
  tournament.isPublic = input.isPublic ?? tournament.isPublic;
  tournament.prizeSchedule = prizeSchedule;
  tournament.prizePoolTokens = prizePoolTokens;
  tournament.regFeeTokens = regFeeTokens;
  tournament.swissRounds = swissRounds;
  tournament.robinRounds = robinRounds;
  tournament.arenaMinutes = arenaMinutes;
  tournament.breakSeconds = breakSeconds;
  tournament.scheduledStartAt = scheduledStartAt;

  await tournament.save();
  if (input.scheduledStartAt !== undefined) scheduleAutoStart(tournament);
  broadcastUpdate(tournament);
  return tournament;
}

// --- Pairing engines -----------------------------------------------------------

/** Builds the round-robin pairing schedule via the standard "circle method"
 *  — one player fixed, the rest rotate around them each round, guaranteeing
 *  everyone plays everyone else exactly once per lap with no repeats. A bye
 *  slot (null) is added for an odd-sized field so every round still pairs
 *  cleanly; that bye rotates through the field along with everyone else.
 *
 *  `laps` repeats the whole schedule that many times — 1 = a single round
 *  robin, 2 = double (colors reversed on the second lap, like home/away),
 *  3+ keeps alternating color on each additional lap. laps <= 1 returns
 *  just the base schedule. */
function circleMethodSchedule(
  playerIds: string[],
  laps: number,
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

  if (laps <= 1) return rounds;
  const schedule = [...rounds];
  for (let lap = 1; lap < laps; lap++) {
    const reverseColors = lap % 2 === 1;
    const lapRounds = rounds.map((round) =>
      round.map(
        ([a, b]) =>
          (reverseColors ? [b ?? a, b ? a : null] : [a, b]) as [string, string | null],
      ),
    );
    schedule.push(...lapRounds);
  }
  return schedule;
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
/** Smart pairing, swiss half: builds the pairing set for a round using only
 *  players who are currently online, so nobody gets paired against someone
 *  who isn't actually around to play — an offline player simply sits this
 *  round out (no bye consumed, no points lost) and is reconsidered fresh
 *  the next time a round is built, whenever they're back.
 *
 *  The one deliberate escape hatch: if fewer than 2 players are online
 *  right now, filtering by presence would leave nothing to pair at all —
 *  rather than stall the whole event indefinitely waiting for people to
 *  show up, this falls back to pairing everyone regardless of online
 *  status for that one round. Presence-based skipping is a fairness
 *  nicety, not something worth deadlocking a tournament over. */
async function buildSwissRound(
  tournament: ITournament,
  roundIndex: number,
): Promise<ITournamentRound> {
  const candidates = tournament.players.filter((p) => !p.withdrawn);
  const onlineFlags = await Promise.all(
    candidates.map((p) => isUserOnline(p.user.toString())),
  );
  const onlineOnly = candidates.filter((_, i) => onlineFlags[i]);
  const active = onlineOnly.length >= 2 ? onlineOnly : candidates;

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
//
// There's deliberately no manual "start now" export here anymore — every
// tournament starts exactly at its announced scheduledStartAt (via
// fireAutoStart above) or is called off and refunded if it doesn't reach
// minPlayers by then. Letting the organizer force an early start meant the
// announced start time wasn't actually reliable, which is worse the more
// this matters — an arena that starts the moment the organizer feels like
// it, rather than when everyone who saw the listing expected it to, isn't
// a fair start for players still on their way in.


/** Shared by both the manual "Start now" action and the scheduled
 *  auto-start timer firing — builds the first round's pairings and flips
 *  the tournament into 'active'. Assumes the caller has already checked
 *  authorization and minPlayers; this just does the state transition.
 *
 *  Arena is structurally different from every other format here: instead
 *  of building a fixed schedule of rounds up front, it kicks off the
 *  continuous pairing queue (see tryArenaPairings) and an end-of-arena
 *  timer, then returns early — there's no "round 0" to activate the normal
 *  way. */
async function activateTournament(tournament: ITournament): Promise<void> {
  clearPendingAutoStart(tournament.id);
  tournament.status = "active";
  tournament.startedAt = new Date();
  tournament.scheduledStartAt = null;

  if (tournament.format === "arena") {
    const minutes = tournament.arenaMinutes ?? 60;
    tournament.arenaEndsAt = new Date(Date.now() + minutes * 60_000);
    await tournament.save();
    broadcastUpdate(tournament, "tournament:started");
    scheduleArenaEnd(tournament);
    await tryArenaPairings(tournament);
    return;
  }

  const playerIds = tournament.players.map((p: ITournamentPlayer) => p.user);
  if (tournament.format === "normal") {
    tournament.rounds.push(buildKnockoutRound0(playerIds));
  } else if (tournament.format === "swiss") {
    tournament.rounds.push(await buildSwissRound(tournament, 0));
  } else {
    // 'robin' (legacy, always 1 lap) or 'round_robin' (robinRounds laps,
    // defaulting to 1 if somehow unset on an older document).
    const laps = tournament.format === "round_robin" ? (tournament.robinRounds ?? 1) : 1;
    const schedule = circleMethodSchedule(
      playerIds.map((id: any) => id.toString()),
      laps,
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

// --- Arena: continuous pairing -----------------------------------------------
//
// Every other format builds its rounds as a synchronized batch (everyone
// moves to the next round together). Arena doesn't: once it starts, players
// get paired the instant both they and an opponent are free, independent of
// anyone else's game — closer to a Lichess arena than a swiss round. This is
// modeled by reusing the exact same rounds/pairings shape everything else
// uses, just with each "round" holding exactly one pairing (one game). That
// keeps a finished arena game advancing on its own the moment IT finishes
// (via the ordinary maybeCompleteRound → advanceAfterRound path below)
// instead of waiting on unrelated games from some shared "wave" to also
// finish — which is what would happen if multiple simultaneous pairings
// were grouped into one round the way a swiss round groups them.

const pendingArenaEndTimers = new Map<string, NodeJS.Timeout>();

function clearPendingArenaEnd(tournamentId: string): void {
  const t = pendingArenaEndTimers.get(tournamentId);
  if (t) {
    clearTimeout(t);
    pendingArenaEndTimers.delete(tournamentId);
  }
}

/** Arms the timer that closes the arena's pairing queue once arenaEndsAt
 *  passes. Doesn't necessarily finish the tournament itself at that
 *  instant — games already in progress are allowed to complete naturally;
 *  see fireArenaEnd. */
function scheduleArenaEnd(tournament: ITournament): void {
  clearPendingArenaEnd(tournament.id);
  if (!tournament.arenaEndsAt) return;
  const delay = tournament.arenaEndsAt.getTime() - Date.now();
  const fire = () =>
    fireArenaEnd(tournament.id).catch((err) =>
      console.error("arena end failed:", err),
    );
  if (delay <= 0) {
    fire();
    return;
  }
  const timer = setTimeout(() => {
    pendingArenaEndTimers.delete(tournament.id);
    fire();
  }, delay);
  timer.unref?.();
  pendingArenaEndTimers.set(tournament.id, timer);
}

function hasActivePairing(tournament: ITournament): boolean {
  return tournament.rounds.some((round) =>
    round.pairings.some((p) => p.status === "active"),
  );
}

/** Fires right at arenaEndsAt: closes the pairing queue (tryArenaPairings
 *  itself already refuses to pair once past this time, so there's nothing
 *  extra to "turn off" here) and, if nothing is still being played, ends
 *  the tournament immediately. If games ARE still in progress, this is a
 *  no-op — whichever of those finishes last will notice (via
 *  advanceAfterRound's arena branch) that time's up and no one else is
 *  playing, and finish the tournament itself at that point. */
async function fireArenaEnd(tournamentId: string): Promise<void> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament || tournament.status !== "active" || tournament.format !== "arena")
    return;
  if (!hasActivePairing(tournament)) await finishTournament(tournament);
}

/** Smart pairing, arena half: every player currently eligible for a new
 *  pairing — joined, not withdrawn, not paused (see the
 *  ITournamentPlayer.paused doc comment), not already sitting in a still-
 *  active pairing themselves, AND currently online. That last check is
 *  what stops the arena from ever pairing someone against an opponent who
 *  isn't actually there to play — an offline player is simply left out of
 *  the pool until they reconnect (see retryArenaPairingsForUser, called on
 *  socket connect, which re-checks them the moment they're back rather
 *  than making them wait for some unrelated pairing event to happen to
 *  pick them up). Unlike swiss's buildSwissRound, there's no "too few
 *  online, pair everyone anyway" fallback needed here — arena tolerates an
 *  empty pool fine, it just means nobody gets paired until the next
 *  trigger. */
async function arenaAvailablePlayers(
  tournament: ITournament,
): Promise<ITournamentPlayer[]> {
  const busy = new Set<string>();
  for (const round of tournament.rounds) {
    for (const pairing of round.pairings) {
      if (pairing.status !== "active") continue;
      busy.add(pairing.player1.toString());
      if (pairing.player2) busy.add(pairing.player2.toString());
    }
  }
  const candidates = tournament.players.filter(
    (p) => !p.withdrawn && !p.paused && !busy.has(p.user.toString()),
  );
  const onlineFlags = await Promise.all(
    candidates.map((p) => isUserOnline(p.user.toString())),
  );
  return candidates.filter((_, i) => onlineFlags[i]);
}

/** Every current player's single most recent opponent, keyed by userId —
 *  the "you can't immediately rematch this person" constraint for arena
 *  pairing. Computed once per tryArenaPairings call rather than re-scanning
 *  round history per player: walks rounds newest-first and stops as soon
 *  as every player currently in the tournament has an entry, rather than
 *  always scanning the tournament's entire history regardless of size. */
function computeLastArenaOpponents(tournament: ITournament): Map<string, string> {
  const lastOpponent = new Map<string, string>();
  const total = tournament.players.length;
  for (let i = tournament.rounds.length - 1; i >= 0 && lastOpponent.size < total; i--) {
    const pairing = tournament.rounds[i].pairings[0];
    if (!pairing?.player2) continue;
    const a = pairing.player1.toString();
    const b = pairing.player2.toString();
    if (!lastOpponent.has(a)) lastOpponent.set(a, b);
    if (!lastOpponent.has(b)) lastOpponent.set(b, a);
  }
  return lastOpponent;
}

/** True if pairing a against b would immediately repeat either of their
 *  most recent games. Checked in both directions deliberately: if A played
 *  someone else more recently than B did, A's own "last opponent" entry no
 *  longer points at B even though B's still does (B hasn't played since) —
 *  checking only a's side would let that stale-on-B's-end rematch slip
 *  through. */
function isImmediateArenaRematch(
  lastOpponent: Map<string, string>,
  a: ITournamentPlayer,
  b: ITournamentPlayer,
): boolean {
  const aId = a.user.toString();
  const bId = b.user.toString();
  return lastOpponent.get(aId) === bId || lastOpponent.get(bId) === aId;
}

/** Greedily pairs off `pool` two at a time, skipping any candidate that
 *  would recreate either player's immediately preceding game. Returns null
 *  (rather than a partial result) if it gets stuck on a player whose only
 *  remaining candidates are all forbidden — the caller retries with a
 *  different shuffle order rather than accepting a worse pairing than
 *  necessary. `allowRematch` is the escape hatch for when no shuffle order
 *  can avoid it (see matchArenaPairs below); with it set, a stuck player is
 *  paired with whoever's next rather than giving up. */
function greedyArenaMatch(
  pool: ITournamentPlayer[],
  lastOpponent: Map<string, string>,
  allowRematch: boolean,
): [ITournamentPlayer, ITournamentPlayer][] | null {
  const remaining = [...pool];
  const pairs: [ITournamentPlayer, ITournamentPlayer][] = [];
  while (remaining.length >= 2) {
    const a = remaining.shift()!;
    let idx = remaining.findIndex((b) => !isImmediateArenaRematch(lastOpponent, a, b));
    if (idx === -1) {
      if (!allowRematch) return null;
      idx = 0;
    }
    const b = remaining.splice(idx, 1)[0];
    pairs.push([a, b]);
  }
  return pairs;
}

// Shuffled retries before falling back to an allowed rematch — a single
// greedy pass can paint itself into a corner (pair off two players early
// that turn out to be the only valid partner for someone paired later)
// even when a full rematch-free matching exists; reshuffling and retrying
// finds one almost every time without needing a proper (and much more
// code) maximum-matching algorithm.
const ARENA_PAIRING_ATTEMPTS = 25;

/** Pairs up `pool` two at a time with a hard guarantee against immediate
 *  rematches — nobody plays the same opponent twice in a row — EXCEPT in
 *  the rare case where it's mathematically unavoidable (most simply: only
 *  two players are available at all, and they just played each other).
 *  That's an explicit, narrow fallback rather than a silent one: it only
 *  ever engages after every shuffled attempt at a clean matching has
 *  failed. */
function matchArenaPairs(
  pool: ITournamentPlayer[],
  lastOpponent: Map<string, string>,
): [ITournamentPlayer, ITournamentPlayer][] {
  for (let attempt = 0; attempt < ARENA_PAIRING_ATTEMPTS; attempt++) {
    const result = greedyArenaMatch(shuffle(pool), lastOpponent, false);
    if (result) return result;
  }
  return greedyArenaMatch(shuffle(pool), lastOpponent, true)!;
}

/** The heart of the arena format: pairs up every currently-available player
 *  it can, two at a time, each pairing becoming its own new one-pairing
 *  round (see the section comment above for why). Called right when the
 *  arena starts (to pair up everyone waiting in the lobby at once) and
 *  again every time a game finishes or a player un-pauses (to immediately
 *  re-pair whoever just freed up, rather than making them wait for some
 *  fixed tick). An odd one out just waits — there's no bye/point awarded
 *  for simply not having a partner available this instant, unlike swiss. */
async function tryArenaPairings(tournament: ITournament): Promise<void> {
  if (tournament.status !== "active" || tournament.format !== "arena") return;
  if (!tournament.arenaEndsAt || Date.now() >= tournament.arenaEndsAt.getTime())
    return;

  const pool = await arenaAvailablePlayers(tournament);
  if (pool.length < 2) return;
  const lastOpponent = computeLastArenaOpponents(tournament);
  const pairs = matchArenaPairs(pool, lastOpponent);
  const newRoundIndexes: number[] = [];

  for (const [a, b] of pairs) {
    const roundIndex = tournament.rounds.length;
    tournament.rounds.push({
      index: roundIndex,
      status: "pending",
      pairings: [emptyPairing(0, a.user, b.user)],
    });
    newRoundIndexes.push(roundIndex);
  }

  if (newRoundIndexes.length === 0) return;
  tournament.currentRoundIndex = tournament.rounds.length - 1;
  await tournament.save();
  // Sequential, not Promise.all — each activateRound call creates a real
  // Game document and re-saves the same in-memory tournament doc; running
  // them concurrently would race that shared save.
  for (const roundIndex of newRoundIndexes) {
    await activateRound(tournament, roundIndex);
  }
}

/** Toggles a player's arena pause state — see the ITournamentPlayer.paused
 *  doc comment. Un-pausing immediately tries to find them a new opponent
 *  rather than waiting for the next unrelated pairing event to happen to
 *  pick them up. */
export async function setArenaPause(
  tournamentId: string,
  userId: string,
  paused: boolean,
): Promise<ITournament> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (tournament.format !== "arena")
    throw ApiError.badRequest("Pausing is only available in arena tournaments");
  if (tournament.status !== "active")
    throw ApiError.conflict("This tournament isn't currently active");
  const player = findPlayer(tournament, userId);
  if (!player) throw ApiError.badRequest("You're not in this tournament");
  if (player.withdrawn)
    throw ApiError.badRequest("You've already withdrawn from this tournament");

  player.paused = paused;
  await tournament.save();

  if (!paused) await tryArenaPairings(tournament);

  return tournament;
}

/** Called when a user's socket connects (see presenceSocket.ts) — the
 *  online-only filtering in arenaAvailablePlayers means a player who was
 *  offline simply sat out of pairing consideration entirely, so nothing
 *  else would notice they're back until some unrelated pairing event (a
 *  different game finishing, someone else pausing/resuming) happened to
 *  run tryArenaPairings again. This closes that gap: the moment they
 *  reconnect, every active arena they're registered in gets an immediate
 *  re-check specifically on their behalf. */
export async function retryArenaPairingsForUser(userId: string): Promise<void> {
  const tournaments = await Tournament.find({
    status: "active",
    format: "arena",
    "players.user": userId,
  });
  for (const tournament of tournaments) {
    await tryArenaPairings(tournament).catch((err) =>
      console.error("arena re-pairing on reconnect failed:", err),
    );
  }
}

/** Finds the round/pairing a player is currently, actively playing in —
 *  needed instead of just looking at tournament.currentRoundIndex because
 *  arena can have many rounds "active" at once (each one a different pair
 *  of players' game), so the single most-recently-created round isn't
 *  necessarily the one THIS player is in. Round-based formats only ever
 *  have one active round at a time, so this is equally correct (if
 *  marginally more work) for them too. */
function findActivePairingForPlayer(
  tournament: ITournament,
  userId: string,
): { roundIndex: number; pairing: ITournamentPairing } | null {
  for (let i = tournament.rounds.length - 1; i >= 0; i--) {
    const pairing = tournament.rounds[i].pairings.find(
      (p) =>
        p.status === "active" &&
        (p.player1.toString() === userId || p.player2?.toString() === userId),
    );
    if (pairing) return { roundIndex: i, pairing };
  }
  return null;
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
  if (tournament.format === "arena") {
    const timeUp =
      !tournament.arenaEndsAt || Date.now() >= tournament.arenaEndsAt.getTime();
    if (timeUp) {
      // Other games from this arena might still be in progress — the last
      // one to finish is the one that actually triggers finishTournament,
      // same idea as fireArenaEnd for the case where the clock runs out
      // while nothing at all is being played.
      if (!hasActivePairing(tournament)) await finishTournament(tournament);
      return;
    }
    await tryArenaPairings(tournament);
    return;
  }

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
    tournament.rounds.push(await buildSwissRound(tournament, roundIndex + 1));
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
  clearPendingArenaEnd(tournament.id);
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
      const { rakeTokens, netTokens } = computeRake(tournament.regFeePoolTokens);
      await creditTournamentReturn(
        tournament.createdBy.toString(),
        tournament.id,
        netTokens,
        "tournament_reg_revenue",
      );
      await recordRake("tournament", tournament.id, rakeTokens, tournament.regFeePoolTokens);
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

  const found = findActivePairingForPlayer(tournament, userId);
  const pairing = found?.pairing;

  if (pairing?.gameId) {
    const gameId = pairing.gameId.toString();
    const liveState = await getLiveState(gameId);
    if (liveState && liveState.status === "active") {
      clearGameTimer(gameId);
      const winnerColor = liveState.whiteId === userId ? "black" : "white";
      const finalState = await endGame(gameId, winnerColor, "withdrawn");
      await finalizeGame(gameId, finalState.fen, "finished", winnerColor, "withdrawn", {
        whiteRemainingMs: finalState.whiteRemainingMs,
        blackRemainingMs: finalState.blackRemainingMs,
      });
      await deleteLiveState(gameId);
      const ratingUpdate = await applyRatingForGame(
        gameId,
        finalState.whiteId,
        finalState.blackId,
        winnerColor,
      ).catch((err) => {
        console.error("applyRatingForGame failed during withdrawal:", err);
        return null;
      });
      try {
        getIo().to(`game:${gameId}`).emit("game:over", {
          gameId,
          result: winnerColor,
          reason: "withdrawn",
          ratingUpdate,
        });
      } catch {
        // Socket.IO not initialized — safe to ignore.
      }
    }
  }

  await tournament.save();

  if (pairing && found) {
    await advanceTournamentIfPairing(
      tournament.id,
      found.roundIndex,
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
  // Matches both "you're an entrant" (players.user) and "you organize it
  // but don't play" (createdBy + organizerOnly) — an organizerOnly creator
  // is deliberately never added to `players` (see createTournament), so
  // without the second clause here their own tournament would never show
  // up in their own "My tournaments" list.
  const tournaments = await Tournament.find({
    $or: [
      { "players.user": userId },
      { createdBy: userId, organizerOnly: true },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return tournaments.map(sanitizeForClient);
}
