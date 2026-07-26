import { customAlphabet } from "nanoid";
import {
  Tournament,
  type ITournament,
  type ITournamentPairing,
  type ITournamentPlayer,
  type ITournamentRound,
  type TournamentFormat,
  type TournamentWagerMode,
} from "../models/Tournament.js";
import { Game } from "../models/Game.js";
import { ApiError } from "../utils/ApiError.js";
import { createDirectGame, finalizeGame, type TimeControlInput } from "./game.service.js";
import { getLiveState, deleteLiveState, endGame, applyBerserk, BerserkNotAllowedError } from "./gameState.service.js";
import { clearGameTimer } from "./clock.service.js";
import { debitTournamentEntry, creditTournamentReturn } from "./wallet.service.js";
import { getIo } from "../sockets/io.js";

const generateCode = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);

const MAX_WAGER_TOKENS = 100_000;

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
  throw ApiError.internal("Could not generate a unique tournament code, please retry");
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

function findPlayer(tournament: ITournament, userId: any): ITournamentPlayer | undefined {
  const id = userId?.toString();
  return tournament.players.find((p) => p.user.toString() === id);
}

function emptyPairing(index: number, player1: any, player2: any | null): ITournamentPairing {
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
  wagerMode: TournamentWagerMode;
  wagerTokens: number;
  // Required (and only meaningful) for format === 'swiss'.
  swissRounds: number | null;
}

export async function createTournament(
  creatorId: string,
  creatorUsername: string,
  input: CreateTournamentInput,
): Promise<ITournament> {
  const bounds = FORMAT_BOUNDS[input.format];
  if (!bounds) throw ApiError.badRequest("Unknown tournament format");
  if (input.name.trim().length < 3) throw ApiError.badRequest("Give your tournament a name (at least 3 characters)");
  if (input.maxPlayers < bounds.min || input.maxPlayers > bounds.max) {
    throw ApiError.badRequest(`A ${input.format} tournament supports between ${bounds.min} and ${bounds.max} players`);
  }
  if (input.baseMinutes !== null && (input.baseMinutes < 1 || input.baseMinutes > 180)) {
    throw ApiError.badRequest("Base time must be between 1 and 180 minutes (or unlimited)");
  }
  if (input.incrementSeconds < 0 || input.incrementSeconds > 60) {
    throw ApiError.badRequest("Increment must be between 0 and 60 seconds");
  }
  if (input.format === "swiss" && (!input.swissRounds || input.swissRounds < 3 || input.swissRounds > 15)) {
    throw ApiError.badRequest("Choose between 3 and 15 rounds for a swiss tournament");
  }
  if (input.wagerMode === "entry_fee" && (input.wagerTokens <= 0 || input.wagerTokens > MAX_WAGER_TOKENS)) {
    throw ApiError.badRequest("Enter a valid entry fee");
  }

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
    wagerMode: input.wagerMode,
    wagerTokens: input.wagerMode === "none" ? 0 : input.wagerTokens,
    swissRounds: input.format === "swiss" ? input.swissRounds : null,
  });

  if (input.wagerMode === "entry_fee" && input.wagerTokens > 0) {
    try {
      await debitTournamentEntry(creatorId, tournament.id, input.wagerTokens);
    } catch (err) {
      await Tournament.deleteOne({ _id: tournament.id });
      throw err;
    }
  }

  return tournament;
}

export async function joinTournament(tournamentId: string, userId: string, username: string): Promise<ITournament> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (tournament.status !== "pending") throw ApiError.conflict("This tournament has already started");
  if (findPlayer(tournament, userId)) throw ApiError.badRequest("You've already joined this tournament");
  if (tournament.players.length >= tournament.maxPlayers) throw ApiError.conflict("This tournament is full");

  if (tournament.wagerMode === "entry_fee" && tournament.wagerTokens > 0) {
    await debitTournamentEntry(userId, tournament.id, tournament.wagerTokens);
  }

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
  });
  await tournament.save();
  return tournament;
}

/** Only valid before the tournament starts — see withdrawFromTournament for
 *  backing out of an already-active event. If the creator leaves, the next
 *  earliest-joined player inherits the "creator" powers (start/cancel) rather
 *  than orphaning the tournament. */
export async function leaveTournament(tournamentId: string, userId: string): Promise<ITournament> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (tournament.status !== "pending") throw ApiError.conflict("The tournament has already started — use withdraw instead");
  const player = findPlayer(tournament, userId);
  if (!player) throw ApiError.badRequest("You're not in this tournament");

  tournament.players = tournament.players.filter((p: ITournamentPlayer) => p.user.toString() !== userId);

  if (tournament.wagerMode === "entry_fee" && tournament.wagerTokens > 0) {
    await creditTournamentReturn(userId, tournament.id, tournament.wagerTokens, "tournament_refund");
  }

  if (tournament.players.length === 0) {
    tournament.status = "cancelled";
  } else if (tournament.createdBy.toString() === userId) {
    tournament.createdBy = tournament.players[0].user;
  }
  await tournament.save();
  return tournament;
}

export async function cancelTournament(tournamentId: string, requesterId: string): Promise<ITournament> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (tournament.createdBy.toString() !== requesterId) throw ApiError.forbidden("Only the organizer can cancel this");
  if (tournament.status !== "pending") throw ApiError.conflict("This tournament has already started");

  if (tournament.wagerMode === "entry_fee" && tournament.wagerTokens > 0) {
    await Promise.all(
      tournament.players.map((p: ITournamentPlayer) =>
        creditTournamentReturn(p.user.toString(), tournament.id, tournament.wagerTokens, "tournament_refund"),
      ),
    );
  }
  tournament.status = "cancelled";
  await tournament.save();
  return tournament;
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
function circleMethodSchedule(playerIds: string[], doubled: boolean): [string, string | null][][] {
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
  const reversed = rounds.map((round) => round.map(([a, b]) => [b ?? a, b ? a : null] as [string, string | null]));
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
function buildSwissRound(tournament: ITournament, roundIndex: number): ITournamentRound {
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

  const sorted = [...active].sort((a, b) => b.points - a.points || Math.random() - 0.5);

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
    let idx = remaining.findIndex((b) => !priorOpponents.get(a.user.toString())?.has(b.user.toString()));
    if (idx === -1) idx = 0;
    const b = remaining.splice(idx, 1)[0];
    pairs.push([a, b]);
  }

  const pairings: ITournamentPairing[] = pairs.map(([a, b], i) => emptyPairing(i, a.user, b.user));
  if (byePlayer) pairings.push(emptyPairing(pairings.length, byePlayer.user, null));

  return { index: roundIndex, status: "pending", pairings };
}

// --- Starting the event / activating a round ------------------------------

export async function startTournament(tournamentId: string, requesterId: string): Promise<ITournament> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (tournament.createdBy.toString() !== requesterId) throw ApiError.forbidden("Only the organizer can start this");
  if (tournament.status !== "pending") throw ApiError.conflict("This tournament has already started");
  if (tournament.players.length < tournament.minPlayers) {
    throw ApiError.badRequest(`Needs at least ${tournament.minPlayers} players to start`);
  }

  tournament.status = "active";
  tournament.startedAt = new Date();
  if (tournament.wagerMode === "entry_fee") {
    tournament.prizePoolTokens = tournament.wagerTokens * tournament.players.length;
  }

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
  await activateRound(tournament, 0);
  return tournament;
}

/** Turns a round's pending pairings into reality: creates the actual Game for
 *  every real pairing (randomizing colors, same convention as cage match
 *  legs), and immediately resolves any bye as a full point with no game
 *  needed. If every pairing in the round happens to be a bye, the round
 *  completes itself right away and cascades into the next one. */
async function activateRound(tournament: ITournament, roundIndex: number): Promise<void> {
  const round = tournament.rounds[roundIndex];
  round.status = "active";
  round.startedAt = new Date();

  const timeControl: TimeControlInput = { baseMinutes: tournament.baseMinutes, incrementSeconds: tournament.incrementSeconds };

  for (const pairing of round.pairings) {
    if (pairing.player2 === null) {
      pairing.status = "finished";
      pairing.result = "p1";
      pairing.endReason = "bye";
      const p1 = findPlayer(tournament, pairing.player1);
      if (p1) p1.hadBye = true;
      applyPairingScore(tournament, pairing, "p1", { p1: false, p2: false }, roundIndex);
      continue;
    }

    const [whiteId, blackId] =
      Math.random() < 0.5 ? [pairing.player1.toString(), pairing.player2.toString()] : [pairing.player2.toString(), pairing.player1.toString()];
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
  }

  await tournament.save();
  broadcastUpdate(tournament);
  await maybeCompleteRound(tournament, roundIndex);
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
    // Bye — a full point, no opponent to update.
    if (p1) {
      p1.points += 1;
      p1.gamesPlayed += 1;
    }
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

async function maybeCompleteRound(tournament: ITournament, roundIndex: number): Promise<void> {
  const round = tournament.rounds[roundIndex];
  if (round.status === "finished") return;
  if (round.pairings.some((p) => p.status !== "finished")) return;

  round.status = "finished";
  round.endedAt = new Date();
  await tournament.save();
  await advanceAfterRound(tournament, roundIndex);
}

async function advanceAfterRound(tournament: ITournament, roundIndex: number): Promise<void> {
  if (tournament.format === "normal") {
    const round = tournament.rounds[roundIndex];
    const winners = round.pairings.map((p) => (p.result === "p1" ? p.player1 : p.player2!));
    if (winners.length === 1) {
      await finishTournament(tournament, winners[0].toString());
      return;
    }
    const nextPairings: ITournamentPairing[] = [];
    for (let i = 0; i < winners.length; i += 2) {
      nextPairings.push(emptyPairing(i / 2, winners[i], winners[i + 1]));
    }
    tournament.rounds.push({ index: roundIndex + 1, status: "pending", pairings: nextPairings });
    tournament.currentRoundIndex = roundIndex + 1;
    await tournament.save();
    await activateRound(tournament, roundIndex + 1);
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
    await activateRound(tournament, roundIndex + 1);
    return;
  }

  // robin / round_robin — the whole schedule was pre-built at start time.
  if (roundIndex + 1 < tournament.rounds.length) {
    tournament.currentRoundIndex = roundIndex + 1;
    await tournament.save();
    await activateRound(tournament, roundIndex + 1);
  } else {
    await finishTournament(tournament);
  }
}

async function finishTournament(tournament: ITournament, explicitKnockoutWinner?: string): Promise<void> {
  tournament.status = "finished";
  tournament.endedAt = new Date();

  if (tournament.format === "normal") {
    tournament.winner = explicitKnockoutWinner as any;
    const finalRound = tournament.rounds[tournament.rounds.length - 1];
    const finalPairing = finalRound.pairings[0];
    if (finalPairing?.player2) {
      tournament.runnerUp = (finalPairing.result === "p1" ? finalPairing.player2 : finalPairing.player1) as any;
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

async function distributePrize(tournament: ITournament): Promise<void> {
  if (tournament.wagerMode !== "entry_fee" || tournament.prizePoolTokens <= 0) return;

  const claimed = await Tournament.findOneAndUpdate(
    { _id: tournament.id, prizeSettled: false },
    { $set: { prizeSettled: true } },
  );
  if (!claimed) return;

  const pool = tournament.prizePoolTokens;

  if (tournament.format === "normal") {
    if (tournament.winner) {
      await creditTournamentReturn(tournament.winner.toString(), tournament.id, pool, "tournament_payout");
    }
    return;
  }

  const ranked = rankPlayers(tournament);
  if (ranked.length === 0) return;
  if (ranked.length <= 2) {
    await creditTournamentReturn(ranked[0].user.toString(), tournament.id, pool, "tournament_payout");
    return;
  }

  const firstShare = Math.floor(pool * 0.5);
  const secondShare = Math.floor(pool * 0.3);
  const thirdShare = pool - firstShare - secondShare; // remainder soaks up rounding
  await creditTournamentReturn(ranked[0].user.toString(), tournament.id, firstShare, "tournament_payout", "1");
  await creditTournamentReturn(ranked[1].user.toString(), tournament.id, secondShare, "tournament_payout", "2");
  await creditTournamentReturn(ranked[2].user.toString(), tournament.id, thirdShare, "tournament_payout", "3");
}

function broadcastUpdate(tournament: ITournament, event: "tournament:update" | "tournament:finished" = "tournament:update") {
  try {
    getIo().to(`tournament:${tournament.id}`).emit(event, { tournamentId: tournament.id, code: tournament.code });
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
      const gameDoc = await Game.findById(pairing.gameId).select("white black berserk").lean();
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
    if (tournament.format === "normal" && pairing.player2 && resultP === "draw") {
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

export async function berserkInTournamentGame(gameId: string, userId: string): Promise<"white" | "black"> {
  const gameDoc = await Game.findById(gameId).select("tournamentId roundIndex pairingIndex").lean();
  if (!gameDoc?.tournamentId || gameDoc.roundIndex === undefined || gameDoc.pairingIndex === undefined) {
    throw new BerserkNotAllowedError("This isn't a tournament game");
  }
  const tournament = await Tournament.findById(gameDoc.tournamentId).select("berserkAllowed rounds");
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (!tournament.berserkAllowed) throw new BerserkNotAllowedError("Berserking is turned off for this tournament");

  // The authoritative flag scoring reads from lives on the Game document
  // (set just below). The mirrored flag on the pairing is only so the
  // tournament view can show a live "berserked" badge before the game ends.
  const pairing = tournament.rounds[gameDoc.roundIndex]?.pairings[gameDoc.pairingIndex];

  const { side } = await applyBerserk(gameId, userId);
  await Game.updateOne({ _id: gameId }, { $set: { [`berserk.${side}`]: true } });

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
export async function withdrawFromTournament(tournamentId: string, userId: string): Promise<ITournament> {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");
  if (tournament.status !== "active") throw ApiError.conflict("This tournament isn't currently active");
  const player = findPlayer(tournament, userId);
  if (!player) throw ApiError.badRequest("You're not in this tournament");
  if (player.withdrawn) return tournament;

  player.withdrawn = true;

  const round = tournament.rounds[tournament.currentRoundIndex];
  const pairing = round?.pairings.find(
    (p) => p.status === "active" && (p.player1.toString() === userId || p.player2?.toString() === userId),
  );

  if (pairing?.gameId) {
    const gameId = pairing.gameId.toString();
    const liveState = await getLiveState(gameId);
    if (liveState && liveState.status === "active") {
      clearGameTimer(gameId);
      const winnerColor = liveState.whiteId === userId ? "black" : "white";
      const finalState = await endGame(gameId, winnerColor, "withdrawn");
      await finalizeGame(gameId, finalState.fen, "finished", winnerColor, "withdrawn");
      await deleteLiveState(gameId);
      try {
        getIo().to(`game:${gameId}`).emit("game:over", { gameId, result: winnerColor, reason: "withdrawn" });
      } catch {
        // Socket.IO not initialized — safe to ignore.
      }
    }
  }

  await tournament.save();

  if (pairing) {
    await advanceTournamentIfPairing(tournament.id, tournament.currentRoundIndex, pairing.index, "draw", "withdrawn").catch(
      (err) => console.error("advanceTournamentIfPairing after withdrawal failed:", err),
    );
  }

  return tournament;
}

// --- Reads ---------------------------------------------------------------------

export async function getTournamentByCode(codeOrId: string) {
  const mongoose = await import("mongoose");
  const query = mongoose.isValidObjectId(codeOrId)
    ? { $or: [{ code: codeOrId }, { _id: codeOrId }] }
    : { code: codeOrId };
  const tournament = await Tournament.findOne(query).lean();
  if (!tournament) throw ApiError.notFound("Tournament not found");
  return tournament;
}

export async function listTournaments(status?: "pending" | "active" | "finished") {
  return Tournament.find(status ? { status } : { status: { $ne: "cancelled" } })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
}

export async function listMyTournaments(userId: string) {
  return Tournament.find({ "players.user": userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
}
