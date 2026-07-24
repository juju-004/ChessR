import mongoose from "mongoose";
import { customAlphabet } from "nanoid";
import { CageMatch, type ICageMatch, type ICageLeg, type CageWinnerMode, type CageWagerMode, type LegCategory } from "../models/CageMatch.js";
import { Game } from "../models/Game.js";
import { ApiError } from "../utils/ApiError.js";
import { createDirectGame, finalizeGame, settleWager, type TimeControlInput } from "./game.service.js";
import { getLiveState, deleteLiveState } from "./gameState.service.js";
import { clearGameTimer } from "./clock.service.js";
import { debitWagerStake, creditWagerReturn } from "./wallet.service.js";
import { getIo } from "../sockets/io.js";

const generateCode = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);

const MIN_LEGS = 2;
const MAX_LEGS = 30;
// Sanity ceiling mirroring MAX_WAGER_TOKENS in game.controller.ts — same
// reasoning: not a business limit, just a guard against garbage input.
const MAX_WAGER_TOKENS = 100_000;

async function uniqueMatchCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const existing = await CageMatch.exists({ matchCode: code });
    if (!existing) return code;
  }
  throw ApiError.internal("Could not generate a unique match code, please retry");
}

export interface CageLegInput {
  variant: "standard" | "chess960";
  baseMinutes: number | null;
  incrementSeconds: number;
}

function classifyCategory(baseMinutes: number | null): LegCategory {
  if (baseMinutes === null) return "classical";
  if (baseMinutes < 3) return "bullet";
  if (baseMinutes < 10) return "blitz";
  if (baseMinutes < 30) return "rapid";
  return "classical";
}

export function validateLegPlan(legs: CageLegInput[]) {
  if (legs.length < MIN_LEGS) throw ApiError.badRequest(`A cage match needs at least ${MIN_LEGS} legs`);
  if (legs.length > MAX_LEGS) throw ApiError.badRequest(`A cage match can have at most ${MAX_LEGS} legs`);
  for (const leg of legs) {
    if (leg.baseMinutes !== null && (leg.baseMinutes < 1 || leg.baseMinutes > 180)) {
      throw ApiError.badRequest("Each leg's base time must be between 1 and 180 minutes (or unlimited)");
    }
    if (leg.incrementSeconds < 0 || leg.incrementSeconds > 60) {
      throw ApiError.badRequest("Each leg's increment must be between 0 and 60 seconds");
    }
  }
}

// --- Standings ---------------------------------------------------------------

export interface CageStandings {
  p1Score: number;
  p2Score: number;
  p1Wins: number;
  p2Wins: number;
  draws: number;
  categoriesWonP1: number;
  categoriesWonP2: number;
  categoriesTied: number;
  legsRemaining: number;
}

export function computeStandings(match: ICageMatch): CageStandings {
  let p1Score = 0;
  let p2Score = 0;
  let p1Wins = 0;
  let p2Wins = 0;
  let draws = 0;
  const catTally = new Map<LegCategory, { p1: number; p2: number }>();

  for (const leg of match.legs) {
    if (leg.status !== "finished") continue;
    const bucket = catTally.get(leg.category) ?? { p1: 0, p2: 0 };
    if (leg.result === "p1") {
      p1Score += 1;
      p1Wins += 1;
      bucket.p1 += 1;
    } else if (leg.result === "p2") {
      p2Score += 1;
      p2Wins += 1;
      bucket.p2 += 1;
    } else if (leg.result === "draw") {
      p1Score += 0.5;
      p2Score += 0.5;
      draws += 1;
    }
    catTally.set(leg.category, bucket);
  }

  let categoriesWonP1 = 0;
  let categoriesWonP2 = 0;
  let categoriesTied = 0;
  for (const bucket of catTally.values()) {
    if (bucket.p1 > bucket.p2) categoriesWonP1 += 1;
    else if (bucket.p2 > bucket.p1) categoriesWonP2 += 1;
    else categoriesTied += 1;
  }

  const legsRemaining = match.legs.filter((l) => l.status === "pending" || l.status === "active").length;

  return { p1Score, p2Score, p1Wins, p2Wins, draws, categoriesWonP1, categoriesWonP2, categoriesTied, legsRemaining };
}

interface Outcome {
  decided: boolean;
  winner: "p1" | "p2" | "draw" | null;
}

function decideOutcome(match: ICageMatch, standings: CageStandings): Outcome {
  const allLegsDone = standings.legsRemaining === 0;

  if (match.winnerMode === "first_to_n" && match.targetWins) {
    if (standings.p1Wins >= match.targetWins) return { decided: true, winner: "p1" };
    if (standings.p2Wins >= match.targetWins) return { decided: true, winner: "p2" };
    if (!allLegsDone) return { decided: false, winner: null };
    // Ran out of legs before either side reached the target — fall back to
    // whoever's ahead on wins so the match still resolves to something.
    if (standings.p1Wins > standings.p2Wins) return { decided: true, winner: "p1" };
    if (standings.p2Wins > standings.p1Wins) return { decided: true, winner: "p2" };
    return { decided: true, winner: "draw" };
  }

  if (!allLegsDone) return { decided: false, winner: null };

  if (match.winnerMode === "most_categories") {
    if (standings.categoriesWonP1 > standings.categoriesWonP2) return { decided: true, winner: "p1" };
    if (standings.categoriesWonP2 > standings.categoriesWonP1) return { decided: true, winner: "p2" };
    // Tied on categories won — total score breaks the tie before calling it
    // an outright draw.
    if (standings.p1Score > standings.p2Score) return { decided: true, winner: "p1" };
    if (standings.p2Score > standings.p1Score) return { decided: true, winner: "p2" };
    return { decided: true, winner: "draw" };
  }

  // total_score
  if (standings.p1Score > standings.p2Score) return { decided: true, winner: "p1" };
  if (standings.p2Score > standings.p1Score) return { decided: true, winner: "p2" };
  return { decided: true, winner: "draw" };
}

// --- Wager helpers -------------------------------------------------------------

function perLegWagerTokens(match: ICageMatch): number {
  if (match.wagerMode === "per_leg") return match.wagerTokens;
  if (match.wagerMode === "split_even") return Math.floor(match.wagerTokens / match.legs.length);
  return 0; // 'none' and 'winner_takes_all' don't stake individual legs
}

async function escrowWinnerTakesAll(match: ICageMatch): Promise<void> {
  if (match.wagerMode !== "winner_takes_all" || match.wagerTokens <= 0) return;
  const matchId = match.id;
  try {
    await debitWagerStake(match.player1.toString(), matchId, match.wagerTokens);
    try {
      await debitWagerStake(match.player2.toString(), matchId, match.wagerTokens);
    } catch (err) {
      await creditWagerReturn(match.player1.toString(), matchId, match.wagerTokens, "wager_refund");
      throw err;
    }
  } catch (err) {
    throw err;
  }
}

/** Pays out (or refunds) a winner-takes-all pot exactly once — guarded the
 *  same way settleWager guards a normal game's wager. */
async function settleWinnerTakesAll(match: ICageMatch, winner: "p1" | "p2" | "draw"): Promise<void> {
  if (match.wagerMode !== "winner_takes_all" || match.wagerTokens <= 0) return;

  const claimed = await CageMatch.findOneAndUpdate(
    { _id: match.id, wagerSettled: false },
    { $set: { wagerSettled: true } },
  );
  if (!claimed) return;

  const matchId = match.id;
  const pot = match.wagerTokens * 2;
  if (winner === "draw") {
    await Promise.all([
      creditWagerReturn(match.player1.toString(), matchId, match.wagerTokens, "wager_refund"),
      creditWagerReturn(match.player2.toString(), matchId, match.wagerTokens, "wager_refund"),
    ]);
    return;
  }
  const winnerId = winner === "p1" ? match.player1.toString() : match.player2.toString();
  await creditWagerReturn(winnerId, matchId, pot, "wager_payout");
}

/** Refunds an escrowed winner-takes-all pot without paying anyone — used when
 *  a match is cancelled/forfeited in a way that shouldn't produce a winner
 *  payout (e.g. the very first leg fails to start). */
async function refundWinnerTakesAll(match: ICageMatch): Promise<void> {
  if (match.wagerMode !== "winner_takes_all" || match.wagerTokens <= 0) return;
  const claimed = await CageMatch.findOneAndUpdate(
    { _id: match.id, wagerSettled: false },
    { $set: { wagerSettled: true } },
  );
  if (!claimed) return;
  const matchId = match.id;
  await Promise.all([
    creditWagerReturn(match.player1.toString(), matchId, match.wagerTokens, "wager_refund"),
    creditWagerReturn(match.player2.toString(), matchId, match.wagerTokens, "wager_refund"),
  ]);
}

// --- Leg lifecycle -------------------------------------------------------------

/** Creates the Game for whichever leg is next in line, marks it active on the
 *  match, and returns the fresh Game doc. Colors are randomized per leg, same
 *  as a normal challenge — nothing here guarantees a player is white in every
 *  leg or anything like that. */
async function startNextLeg(match: ICageMatch): Promise<ICageMatch> {
  const leg = match.legs[match.currentLegIndex];
  if (!leg) throw ApiError.internal("No leg to start");

  const [whiteId, blackId] =
    Math.random() < 0.5 ? [match.player1.toString(), match.player2.toString()] : [match.player2.toString(), match.player1.toString()];

  const timeControl: TimeControlInput = { baseMinutes: leg.baseMinutes, incrementSeconds: leg.incrementSeconds };
  const game = await createDirectGame(
    whiteId,
    blackId,
    timeControl,
    undefined,
    leg.variant,
    perLegWagerTokens(match),
    { cageMatchId: match.id, legIndex: leg.index },
  );

  leg.status = "active";
  leg.gameId = game._id;
  leg.joinCode = game.joinCode;
  await match.save();
  return match;
}

export async function startCageMatch(
  challengerId: string,
  opponentId: string,
  legsInput: CageLegInput[],
  winnerMode: CageWinnerMode,
  targetWins: number | null,
  wagerMode: CageWagerMode,
  wagerTokens: number,
): Promise<{ match: ICageMatch; firstLeg: ICageLeg }> {
  if (challengerId === opponentId) throw ApiError.badRequest("You can't start a cage match with yourself");
  validateLegPlan(legsInput);
  if (winnerMode === "first_to_n" && (!targetWins || targetWins < 1)) {
    throw ApiError.badRequest("Choose a target win count for a first-to-N match");
  }
  if (wagerMode !== "none" && (wagerTokens <= 0 || wagerTokens > MAX_WAGER_TOKENS)) {
    throw ApiError.badRequest("Enter a valid wager amount");
  }
  if (wagerMode === "split_even" && Math.floor(wagerTokens / legsInput.length) <= 0) {
    throw ApiError.badRequest("That wager doesn't divide into a whole token per leg — raise it or use fewer legs");
  }

  const matchCode = await uniqueMatchCode();
  const legs: ICageLeg[] = legsInput.map((l, index) => ({
    index,
    variant: l.variant,
    baseMinutes: l.baseMinutes,
    incrementSeconds: l.incrementSeconds,
    category: classifyCategory(l.baseMinutes),
    status: "pending",
    gameId: null,
    joinCode: null,
    result: null,
    endReason: null,
  }));

  const match = await CageMatch.create({
    matchCode,
    player1: challengerId,
    player2: opponentId,
    legs,
    currentLegIndex: 0,
    status: "active",
    winnerMode,
    targetWins: winnerMode === "first_to_n" ? targetWins : null,
    wagerMode,
    wagerTokens: wagerMode === "none" ? 0 : wagerTokens,
  });

  try {
    await escrowWinnerTakesAll(match);
  } catch (err) {
    await CageMatch.deleteOne({ _id: match.id });
    throw err;
  }

  try {
    await startNextLeg(match);
  } catch (err) {
    if (match.wagerMode === "winner_takes_all" && match.wagerTokens > 0) {
      await refundWinnerTakesAll(match).catch(() => {});
    }
    await CageMatch.deleteOne({ _id: match.id });
    throw err;
  }

  return { match, firstLeg: match.legs[0] };
}

export interface LegFinishedOutcome {
  match: ICageMatch;
  standings: CageStandings;
  matchStatus: "leg_advanced" | "match_over";
  nextLeg: ICageLeg | null;
  matchWinner: "p1" | "p2" | "draw" | null;
}

/** Called once a leg's underlying Game finishes. Records the result, figures
 *  out whether the match continues or concludes, and either creates the next
 *  leg's Game or finalizes the match (including wager payout). */
export async function onLegFinished(
  cageMatchId: string,
  legIndex: number,
  gameResult: "white" | "black" | "draw",
  endReason: string,
): Promise<LegFinishedOutcome> {
  const match = await CageMatch.findById(cageMatchId);
  if (!match) throw ApiError.notFound("Cage match not found");

  const leg = match.legs[legIndex];
  if (!leg || leg.status !== "active") {
    // Already processed (e.g. a duplicate event) — just report current state.
    const standings = computeStandings(match);
    return { match, standings, matchStatus: match.status === "finished" ? "match_over" : "leg_advanced", nextLeg: null, matchWinner: match.matchWinner };
  }

  // Leg results are always recorded relative to white/black of that specific
  // leg's game, which is why we need the leg's own Game doc to know who was
  // playing which color this time round.
  const gameDoc = await Game.findById(leg.gameId).select("white black").lean();
  if (!gameDoc) throw ApiError.internal("Leg game record missing");

  const whiteIsP1 = gameDoc.white.toString() === match.player1.toString();
  let legResult: "p1" | "p2" | "draw";
  if (gameResult === "draw") legResult = "draw";
  else if (gameResult === "white") legResult = whiteIsP1 ? "p1" : "p2";
  else legResult = whiteIsP1 ? "p2" : "p1";

  leg.status = "finished";
  leg.result = legResult;
  leg.endReason = endReason;

  const standings = computeStandings(match);
  const outcome = decideOutcome(match, standings);

  if (outcome.decided) {
    // Skip any legs that never got played (only possible for first_to_n
    // clinching early).
    for (const l of match.legs) {
      if (l.status === "pending") l.status = "skipped";
    }
    match.status = "finished";
    match.matchWinner = outcome.winner;
    match.endedAt = new Date();
    await match.save();
    await settleWinnerTakesAll(match, outcome.winner!).catch((err) => console.error("settleWinnerTakesAll failed:", err));
    return { match, standings: computeStandings(match), matchStatus: "match_over", nextLeg: null, matchWinner: outcome.winner };
  }

  match.currentLegIndex = legIndex + 1;
  await match.save();
  await startNextLeg(match);
  const nextLeg = match.legs[match.currentLegIndex];
  return { match, standings: computeStandings(match), matchStatus: "leg_advanced", nextLeg, matchWinner: null };
}

/** A player concedes the whole series (not just the current leg). The other
 *  player is declared the overall winner regardless of the running score,
 *  and any escrowed pot pays out to them; per-leg wagers already settled
 *  stay settled since each leg is independent. */
export async function forfeitCageMatch(matchId: string, forfeitingUserId: string): Promise<ICageMatch> {
  const match = await CageMatch.findById(matchId);
  if (!match) throw ApiError.notFound("Cage match not found");
  if (match.status !== "active") throw ApiError.badRequest("This match is already over");

  const isP1 = match.player1.toString() === forfeitingUserId;
  const isP2 = match.player2.toString() === forfeitingUserId;
  if (!isP1 && !isP2) throw ApiError.forbidden("You're not part of this match");

  const winnerSide: "p1" | "p2" = isP1 ? "p2" : "p1";

  // If a leg is currently in progress, close it out too — otherwise its clock
  // and socket room would keep running even after the match itself has ended.
  // It's awarded to the non-forfeiting side, same as a resignation would be.
  const activeLeg = match.legs.find((l) => l.status === "active");
  if (activeLeg?.gameId) {
    const gameId = activeLeg.gameId.toString();
    const liveState = await getLiveState(gameId);
    if (liveState && liveState.status === "active") {
      clearGameTimer(gameId);
      const winnerColor = liveState.whiteId === forfeitingUserId ? "black" : "white";
      const wagerSettlement = await settleWager(
        gameId,
        liveState.whiteId,
        liveState.blackId,
        liveState.wagerTokens,
        winnerColor,
      ).catch((err) => {
        console.error("settleWager failed during cage forfeit:", err);
        return null;
      });
      try {
        getIo().to(`game:${gameId}`).emit("game:over", {
          gameId,
          result: winnerColor,
          reason: "cage_forfeit",
          wagerSettlement,
        });
      } catch {
        // Socket.IO not initialized (e.g. script/test context) — safe to ignore.
      }
      await finalizeGame(gameId, liveState.fen, "finished", winnerColor, "cage_forfeit");
      await deleteLiveState(gameId);
    }
    activeLeg.status = "finished";
    activeLeg.result = winnerSide;
    activeLeg.endReason = "cage_forfeit";
  }

  for (const l of match.legs) {
    if (l.status === "pending") l.status = "skipped";
  }
  match.status = "finished";
  match.matchWinner = winnerSide;
  match.forfeitedBy = forfeitingUserId as any;
  match.endedAt = new Date();
  await match.save();

  await settleWinnerTakesAll(match, match.matchWinner).catch((err) => console.error("settleWinnerTakesAll failed:", err));

  return match;
}

/** Runs onLegFinished and emits the resulting cage:next_leg / cage:match_over
 *  event to both players. Shared by the live socket path (gameSocket.ts) and
 *  the boot/periodic reconciliation sweep (game.service.ts's
 *  reconcileActiveGames) so a leg that gets resolved during server-restart
 *  recovery advances its cage match exactly the same way a leg resolved
 *  live does — instead of silently stalling the match forever. */
export async function advanceCageMatchLeg(
  cageMatchId: string,
  legIndex: number,
  gameResult: "white" | "black" | "draw",
  endReason: string,
): Promise<LegFinishedOutcome | null> {
  try {
    const outcome = await onLegFinished(cageMatchId, legIndex, gameResult, endReason);
    const p1 = outcome.match.player1.toString();
    const p2 = outcome.match.player2.toString();
    const basePayload = {
      matchId: outcome.match.id,
      matchCode: outcome.match.matchCode,
      standings: outcome.standings,
    };
    try {
      const io = getIo();
      if (outcome.matchStatus === "match_over") {
        const payload = { ...basePayload, matchWinner: outcome.matchWinner };
        io.to(`user:${p1}`).emit("cage:match_over", payload);
        io.to(`user:${p2}`).emit("cage:match_over", payload);
      } else if (outcome.nextLeg) {
        const payload = {
          ...basePayload,
          nextLeg: { index: outcome.nextLeg.index, joinCode: outcome.nextLeg.joinCode },
        };
        io.to(`user:${p1}`).emit("cage:next_leg", payload);
        io.to(`user:${p2}`).emit("cage:next_leg", payload);
      }
    } catch {
      // Socket.IO not initialized (e.g. script/test context, or this ran
      // before the server finished booting) — the match state itself is
      // still correctly persisted either way, clients will pick it up next
      // time they fetch/reconnect.
    }
    return outcome;
  } catch (err) {
    console.error("cage match leg progression failed:", err);
    return null;
  }
}

export async function getCageMatchByCode(codeOrId: string) {
  const query = mongoose.isValidObjectId(codeOrId)
    ? { $or: [{ matchCode: codeOrId }, { _id: codeOrId }] }
    : { matchCode: codeOrId };
  const match = await CageMatch.findOne(query)
    .populate("player1", "username")
    .populate("player2", "username")
    .lean();
  if (!match) throw ApiError.notFound("Cage match not found");
  return match;
}

export async function listMyCageMatches(userId: string) {
  return CageMatch.find({ $or: [{ player1: userId }, { player2: userId }] })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("player1", "username")
    .populate("player2", "username")
    .lean();
}
