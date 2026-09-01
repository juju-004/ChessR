import { customAlphabet } from "nanoid";
import { Game, type IGame } from "../models/Game.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import {
  initLiveState,
  getLiveState,
  computeTimeoutWinner,
  deleteLiveState,
  type LiveTimeControl,
} from "./gameState.service.js";
import { scheduleGameTimer, scheduleFirstMoveTimer } from "./clock.service.js";
import { getIo } from "../sockets/io.js";
import { generateChess960Fen } from "./chess960.service.js";
import { debitWagerStake, creditWagerReturn, computeRake, recordRake } from "./wallet.service.js";
import { expireChat } from "./chat.service.js";
import { applyRatingForGame } from "./rating.service.js";
import { runAutoCheatCheck } from "./anticheat.service.js";
// NOTE: cageMatch.service.ts imports several functions from this same file
// (createDirectGame, finalizeGame, settleWager), so this is a deliberate
// circular import. It's safe here because every cross-reference on both
// sides is a hoisted `function` export only ever called at runtime (inside
// request/reconciliation handlers), never evaluated at module-load time, 
// so there's no temporal-dead-zone issue either direction.
import { advanceCageMatchLeg } from "./cageMatch.service.js";
// Same deliberate circular-import pattern as advanceCageMatchLeg above.
import { advanceTournamentIfPairing } from "./tournament.service.js";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// A normal game (not a cage match leg, not a tournament pairing) that's sat
// in the idle phase, active, but neither side has made their first move, 
// for this long gets auto-cancelled by the reconciliation sweep below.
// Cage match legs have their own no-show forfeit timer, and tournament
// pairings are intentionally left out of scope here (walking away from a
// bracket game isn't something either safety net should do quietly on a
// player's behalf), so only plain games get this treatment.
const IDLE_PHASE_ABANDON_MS = 5 * 60 * 1000;

// Safety limit, a user can't be tied up in more than this many games at
// once. Counts anything they're a player in that's still 'waiting' (their
// own open table) or 'active' (in progress), including cage-match legs and
// tournament pairings.
//
// Deliberately NOT enforced inside createDirectGame itself, since that
// function is also how cage matches and tournaments advance a player into
// their next scheduled game, those must never be blocked by this. Instead
// every user-initiated entry point (createOpenGame, joinOpenGame, challenge
// acceptance, rematch acceptance) calls assertUnderActiveGameLimit
// explicitly before creating anything.
export const MAX_ACTIVE_GAMES_PER_USER = 1;

// Centralized so the grammar (singular "game" vs plural "games") stays
// correct regardless of what MAX_ACTIVE_GAMES_PER_USER is set to, and so
// every call site (open game create/join, direct challenge, cage match
// invite, rematch, ...) reads as one consistent message instead of each
// one hand-rolling its own copy of this string.
export function activeGameLimitMessage(action: string): string {
  return MAX_ACTIVE_GAMES_PER_USER === 1
    ? `You already have an active game. Finish or cancel it before ${action}.`
    : `You can only have ${MAX_ACTIVE_GAMES_PER_USER} active games at once. Finish or cancel one before ${action}.`;
}

export async function countActiveGamesForUser(userId: string): Promise<number> {
  return Game.countDocuments({
    status: { $in: ["waiting", "active"] },
    $or: [{ white: userId }, { black: userId }],
  });
}

export async function assertUnderActiveGameLimit(userId: string): Promise<void> {
  const count = await countActiveGamesForUser(userId);
  if (count >= MAX_ACTIVE_GAMES_PER_USER) {
    throw ApiError.conflict(activeGameLimitMessage("starting another"));
  }
}

const generateCode = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);

async function uniqueJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const existing = await Game.exists({ joinCode: code });
    if (!existing) return code;
  }
  throw ApiError.internal(
    "Could not generate a unique game code, please retry",
  );
}

export interface TimeControlInput {
  baseMinutes: number | null;
  incrementSeconds: number;
}

function toLiveTimeControl(input: TimeControlInput): LiveTimeControl {
  return {
    baseMs: input.baseMinutes === null ? null : input.baseMinutes * 60_000,
    incrementMs: input.incrementSeconds * 1000,
  };
}

export async function createOpenGame(
  hostUserId: string,
  timeControl: TimeControlInput,
  variant: "standard" | "chess960" = "standard",
  isPrivate = false,
  wagerTokens = 0,
): Promise<IGame> {
  await assertUnderActiveGameLimit(hostUserId);

  const joinCode = await uniqueJoinCode();
  const startingFen =
    variant === "chess960" ? generateChess960Fen() : STARTING_FEN;

  // Host's stake is locked up front, the moment the table is opened, not at
  // join time, so a wagered game can never be sitting open with a stake the
  // host doesn't actually have. It's refunded via cancelOpenGame if nobody
  // joins.
  const game = await Game.create({
    joinCode,
    variant,
    white: hostUserId,
    black: null,
    status: "waiting",
    fen: startingFen,
    initialFen: startingFen,
    isPrivate,
    wagerTokens,
    timeControl: {
      baseSeconds:
        timeControl.baseMinutes === null ? null : timeControl.baseMinutes * 60,
      incrementSeconds: timeControl.incrementSeconds,
    },
  });

  if (wagerTokens > 0) {
    try {
      await debitWagerStake(hostUserId, game.id, wagerTokens);
    } catch (err) {
      await Game.deleteOne({ _id: game.id });
      throw err;
    }
  }

  return game;
}

/** Lets the host back out of a game nobody has joined yet, refunding their
 *  stake. Once someone has joined the game is 'active' and this no longer
 *  applies, game:abort (only available with zero moves played) is the
 *  equivalent for that stage. */
export async function cancelOpenGame(gameId: string, hostUserId: string): Promise<void> {
  const game = await Game.findById(gameId);
  if (!game) throw ApiError.notFound("Game not found");
  if (game.white.toString() !== hostUserId) throw ApiError.forbidden("Not your game");
  if (game.status !== "waiting") throw ApiError.conflict("Game can no longer be cancelled");

  game.status = "aborted";
  game.endReason = "cancelled";
  game.endedAt = new Date();
  await game.save();

  if (game.wagerTokens > 0) {
    await creditWagerReturn(hostUserId, game.id, game.wagerTokens, "wager_refund");
  }
}

/** Joins an open game and starts it immediately. Also notifies anyone already
 *  sitting in the game's socket room (i.e. the creator, waiting) that the game
 *  is live now, without this, the creator's board stays stuck in "waiting"
 *  view-only mode until they manually reload. */
export async function joinOpenGame(
  gameId: string,
  joiningUserId: string,
): Promise<IGame> {
  const game = await Game.findById(gameId);
  if (!game) throw ApiError.notFound("Game not found");
  if (game.status !== "waiting")
    throw ApiError.conflict("Game is not open to join");
  if (game.white.toString() === joiningUserId) {
    throw ApiError.badRequest("You can't join your own game");
  }
  await assertUnderActiveGameLimit(joiningUserId);

  // Match the host's stake before anything else changes, if the joiner
  // can't cover it, the game stays exactly as it was (still waiting, host's
  // stake untouched) rather than half-starting.
  if (game.wagerTokens > 0) {
    await debitWagerStake(joiningUserId, game.id, game.wagerTokens);
  }

  game.black = joiningUserId as any;
  game.status = "active";
  game.startedAt = new Date();
  await game.save();

  const liveTc = toLiveTimeControl({
    baseMinutes:
      game.timeControl.baseSeconds === null
        ? null
        : game.timeControl.baseSeconds / 60,
    incrementSeconds: game.timeControl.incrementSeconds,
  });
  await initLiveState(
    game.id,
    game.white.toString(),
    (game.black || "").toString(),
    liveTc,
    game.initialFen,
    game.variant,
    game.wagerTokens,
  );
  await scheduleGameTimer(game.id);
  await scheduleFirstMoveTimer(game.id);

  try {
    getIo().to(`game:${game.id}`).emit("game:state_changed");
  } catch {
    // Socket.IO not initialized (e.g. in a script/test context), safe to ignore.
  }

  return game;
}

export async function createDirectGame(
  whiteId: string,
  blackId: string,
  timeControl: TimeControlInput,
  challengeId?: string,
  variant: "standard" | "chess960" = "standard",
  wagerTokens = 0,
  cageLeg?: { cageMatchId: string; legIndex: number },
  tournamentPairing?: { tournamentId: string; roundIndex: number; pairingIndex: number },
): Promise<IGame> {
  const joinCode = await uniqueJoinCode();
  const startingFen =
    variant === "chess960" ? generateChess960Fen() : STARTING_FEN;
  const game = await Game.create({
    joinCode,
    variant,
    white: whiteId,
    black: blackId,
    status: "active",
    fen: startingFen,
    initialFen: startingFen,
    isPrivate: true,
    startedAt: new Date(),
    challengeId,
    wagerTokens,
    ...(cageLeg
      ? { cageMatchId: cageLeg.cageMatchId, legIndex: cageLeg.legIndex }
      : {}),
    ...(tournamentPairing
      ? {
          tournamentId: tournamentPairing.tournamentId,
          roundIndex: tournamentPairing.roundIndex,
          pairingIndex: tournamentPairing.pairingIndex,
        }
      : {}),
    timeControl: {
      baseSeconds:
        timeControl.baseMinutes === null ? null : timeControl.baseMinutes * 60,
      incrementSeconds: timeControl.incrementSeconds,
    },
  });

  // Both sides stake at the moment the game is actually created (i.e. right
  // after a challenge is accepted, or a rematch confirmed), not earlier,
  // since a pending challenge/rematch offer can simply expire or be declined.
  if (wagerTokens > 0) {
    try {
      await debitWagerStake(whiteId, game.id, wagerTokens);
      try {
        await debitWagerStake(blackId, game.id, wagerTokens);
      } catch (err) {
        // Black couldn't cover it, put White's stake back rather than
        // leaving them charged for a game that's about to be torn down.
        await creditWagerReturn(whiteId, game.id, wagerTokens, "wager_refund");
        throw err;
      }
    } catch (err) {
      await Game.deleteOne({ _id: game.id });
      throw err;
    }
  }

  const liveTc = toLiveTimeControl(timeControl);
  await initLiveState(
    game.id,
    whiteId,
    blackId,
    liveTc,
    game.initialFen,
    game.variant,
    wagerTokens,
  );
  await scheduleGameTimer(game.id);
  await scheduleFirstMoveTimer(game.id);

  return game;
}

/** Every game, waiting or active, the given user is currently seated in,
 *  across friends and strangers alike. Powers the "your games" switcher in
 *  the navbar, which needs to work regardless of who the opponent is. */
export async function listMyActiveGames(userId: string) {
  return Game.find({
    status: { $in: ["waiting", "active"] },
    $or: [{ white: userId }, { black: userId }],
  })
    .sort({ startedAt: -1, createdAt: -1 })
    .limit(50)
    .populate("white", "username avatarGradient")
    .populate("black", "username avatarGradient")
    .lean();
}

export async function listFriendsActiveGames(userId: string) {
  const user = await User.findById(userId).select("friends").lean();
  const friendIds = user?.friends ?? [];
  if (friendIds.length === 0) return [];

  return Game.find({
    status: "active",
    $or: [{ white: { $in: friendIds } }, { black: { $in: friendIds } }],
    // A game the viewer is themself playing in isn't "a friend currently
    // playing" from their own point of view, it's just their own game, and
    // showing it here (with a "Watch" link back into their own live game)
    // was the actual bug being fixed. Exclude it regardless of which side
    // of the board the viewer is on.
    white: { $ne: userId },
    black: { $ne: userId },
  })
    .sort({ startedAt: -1 })
    .limit(50)
    .populate("white", "username avatarGradient")
    .populate("black", "username avatarGradient")
    .lean();
}

/** Used by the Friends list and Profile page to swap a "Challenge"/"Add
 *  friend" button for a "Watch" link when that person is mid-game. Returns
 *  just the join code (cheap projection) or null if they're not playing.
 *  `viewerId`, when given, excludes a game the viewer is themselves also a
 *  participant in — otherwise looking at your own live opponent's profile
 *  mid-game offered a "Watch" link to the very game you're already
 *  playing, which is exactly backwards (you're not spectating it, you're
 *  in it). */
export async function getActiveGameCodeForUser(userId: string, viewerId?: string): Promise<string | null> {
  const game = await Game.findOne({
    status: "active",
    $or: [{ white: userId }, { black: userId }],
    ...(viewerId ? { white: { $ne: viewerId }, black: { $ne: viewerId } } : {}),
  })
    .select("joinCode")
    .lean();
  return game?.joinCode ?? null;
}

export async function listOpenGames(excludeUserId?: string) {
  return Game.find({
    status: "waiting",
    isPrivate: false,
    ...(excludeUserId ? { white: { $ne: excludeUserId } } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("white", "username avatarGradient")
    .lean();
}

export async function getGameByCode(code: string) {
  const game = await Game.findOne({ joinCode: code.toUpperCase() })
    .populate("white", "username avatarGradient rating ratedGamesPlayed")
    .populate("black", "username avatarGradient rating ratedGamesPlayed")
    // Just the join code, enough for a "Back to tournament" link without
    // pulling the whole Tournament doc down for every single game fetch.
    // code (for the "Back to tournament" link) and name (shown on the
    // in-game tournament badge instead of a generic "Tournament game" label).
    .populate("tournamentId", "code name")
    .lean();
  if (!game) throw ApiError.notFound("No game found with that code");
  return game;
}

export async function appendMove(
  gameId: string,
  move: {
    san: string;
    from: string;
    to: string;
    promotion?: string;
    fenAfter: string;
    moveNumber: number;
    /** Pass the exact timestamp used for the live game:move broadcast
     *  (see gameSocket.ts) so the persisted record and what clients saw
     *  in real time agree, instead of drifting by whatever gap sits
     *  between the broadcast and this DB write landing. Defaults to
     *  "now" for any other caller that doesn't have one handy. */
    timestampMs?: number;
  },
): Promise<void> {
  const { timestampMs, ...rest } = move;
  await Game.updateOne(
    { _id: gameId },
    {
      $push: { moves: { ...rest, timestampMs: timestampMs ?? Date.now() } },
      $set: { fen: move.fenAfter },
    },
  );
}

export async function finalizeGame(
  gameId: string,
  fen: string,
  status: "finished" | "aborted",
  result: "white" | "black" | "draw" | null,
  endReason: string | null,
  finalClock?: { whiteRemainingMs: number | null; blackRemainingMs: number | null },
): Promise<void> {
  const updated = await Game.findByIdAndUpdate(
    gameId,
    {
      $set: {
        fen,
        status,
        result,
        endReason,
        endedAt: new Date(),
        // Optional and defaulted to null rather than required: some call
        // sites (older code paths, or ones that only have the FEN handy)
        // don't have a LiveGameState to read a clock from, better to
        // persist a known-absent clock than to force every call site to
        // thread one through just to satisfy the signature.
        whiteRemainingMs: finalClock?.whiteRemainingMs ?? null,
        blackRemainingMs: finalClock?.blackRemainingMs ?? null,
      },
    },
    { select: 'cageMatchId' },
  ).lean();

  // Standalone games only, a cage match leg's spectator chat is scoped to
  // the whole match (see chat.service.ts / chatScopeFor in gameSocket.ts)
  // and only expires once the entire match finishes, that's handled
  // separately in cageMatch.service.ts, not here per-leg.
  if (updated && !updated.cageMatchId) {
    expireChat('game', gameId).catch((err) => console.error('expireChat(game) failed:', err));
  }

  // Fire-and-forget, off every real ending (decisive or drawn; aborted/
  // no-result games have nothing for the heuristic to look at). Runs here
  // rather than at each individual call site so both the normal
  // game:over path (gameSocket.ts) and the disconnect-timeout
  // reconciliation path above both get covered from one place.
  if (status === 'finished' && result !== null) {
    runAutoCheatCheck(gameId).catch((err) => console.error('runAutoCheatCheck failed:', err));
  }
}

/**
 * Sweeps every game marked 'active' in Mongo and makes sure it actually has a
 * live, correctly-scheduled timer behind it. This exists because the per-game
 * clock timer lives in process memory (see clock.service.ts), a server
 * restart wipes every scheduled timeout silently, leaving the game stuck as
 * "active" forever with nothing left to ever resolve it. Call this once on
 * boot (to recover from the restart that just happened) and periodically
 * (as a general safety net against anything else that could leave a timer
 * un-scheduled).
 */
export interface WagerSettlement {
  wagerTokens: number;
  potTokens: number;
  winnerId: string | null; // null for a draw (both refunded) or an unwagered game
  rakeTokens: number; // platform's cut, 0 for a draw (nothing to rake, it's a refund)
  payoutTokens: number; // what the winner actually received (potTokens - rakeTokens); 0 for a draw
}

/**
 * Pays out (or refunds) a game's R token wager exactly once. Guarded by an
 * atomic flip of wagerSettled, if two callers race (e.g. the live socket
 * flow and a reconciliation sweep after a restart both try to settle the same
 * game), only the first one to flip the flag actually moves any tokens.
 * A no-op (returns null) for unwagered games, since there's nothing to settle.
 */
export async function settleWager(
  gameId: string,
  whiteId: string,
  blackId: string,
  wagerTokens: number,
  result: "white" | "black" | "draw",
): Promise<WagerSettlement | null> {
  if (wagerTokens <= 0) return null;

  const claimed = await Game.findOneAndUpdate(
    { _id: gameId, wagerSettled: false },
    { $set: { wagerSettled: true } },
  );
  if (!claimed) return null; // already settled by someone else, or game not found

  const potTokens = wagerTokens * 2;

  if (result === "draw") {
    await Promise.all([
      creditWagerReturn(whiteId, gameId, wagerTokens, "wager_refund"),
      creditWagerReturn(blackId, gameId, wagerTokens, "wager_refund"),
    ]);
    return { wagerTokens, potTokens, winnerId: null, rakeTokens: 0, payoutTokens: 0 };
  }

  // Rake comes off the pot before the winner is paid, see wallet.service.ts's
  // computeRake for the split, RAKE_PERCENT in .env for the rate.
  const { rakeTokens, netTokens } = computeRake(potTokens);
  const winnerId = result === "white" ? whiteId : blackId;
  await creditWagerReturn(winnerId, gameId, netTokens, "wager_payout");
  await recordRake("game", gameId, rakeTokens, potTokens);
  return { wagerTokens, potTokens, winnerId, rakeTokens, payoutTokens: netTokens };
}

/** Refunds both players' stakes for a game that's being torn down before it
 *  produced a real result (e.g. aborted with zero moves played). Uses the
 *  same wagerSettled guard as settleWager so it can never double-refund. */
export async function refundWagerBothSides(
  gameId: string,
  whiteId: string,
  blackId: string,
  wagerTokens: number,
): Promise<void> {
  if (wagerTokens <= 0) return;

  const claimed = await Game.findOneAndUpdate(
    { _id: gameId, wagerSettled: false },
    { $set: { wagerSettled: true } },
  );
  if (!claimed) return;

  await Promise.all([
    creditWagerReturn(whiteId, gameId, wagerTokens, "wager_refund"),
    creditWagerReturn(blackId, gameId, wagerTokens, "wager_refund"),
  ]);
}

export async function reconcileActiveGames(): Promise<{
  resumed: number;
  timedOut: number;
  aborted: number;
  idleCancelled: number;
}> {
  const activeGames = await Game.find({ status: "active" }).lean();
  let resumed = 0;
  let timedOut = 0;
  let aborted = 0;
  let idleCancelled = 0;

  for (const g of activeGames) {
    const gameId = g._id.toString();
    const liveState = await getLiveState(gameId);

    if (!liveState) {
      // No live state to resume from (Redis TTL expired, or it was never
      // properly initialized), there's nothing safe to do but close it out
      // rather than leave it stuck as "active" indefinitely. Since neither
      // side did anything wrong here, refund both stakes rather than
      // treating it as a loss for either player.
      await finalizeGame(gameId, g.fen, "aborted", null, "abandoned");
      await refundWagerBothSides(gameId, g.white.toString(), (g.black ?? "").toString(), g.wagerTokens).catch(
        (err) => console.error("refundWagerBothSides failed during reconciliation:", err),
      );
      if (g.cageMatchId && g.legIndex !== undefined) {
        // Same treatment as a live no-moves abort: no real winner to report,
        // so it's scored as a draw for this leg rather than stalling the
        // whole cage match indefinitely.
        await advanceCageMatchLeg(g.cageMatchId.toString(), g.legIndex, "draw", "abandoned", gameId);
      }
      if (g.tournamentId && g.roundIndex !== undefined && g.pairingIndex !== undefined) {
        await advanceTournamentIfPairing(
          g.tournamentId.toString(),
          g.roundIndex,
          g.pairingIndex,
          "draw",
          "abandoned",
        );
      }
      aborted++;
      continue;
    }

    if (
      !g.cageMatchId &&
      !g.tournamentId &&
      liveState.moveCount < 2 &&
      g.startedAt &&
      Date.now() - g.startedAt.getTime() > IDLE_PHASE_ABANDON_MS
    ) {
      await finalizeGame(gameId, liveState.fen, "aborted", null, "idle_timeout", {
        whiteRemainingMs: liveState.whiteRemainingMs,
        blackRemainingMs: liveState.blackRemainingMs,
      });
      await refundWagerBothSides(gameId, liveState.whiteId, liveState.blackId, liveState.wagerTokens).catch(
        (err) => console.error("refundWagerBothSides failed during idle reconciliation:", err),
      );
      await deleteLiveState(gameId);
      getIo().to(`game:${gameId}`).emit("game:over", { gameId, result: null, reason: "idle_timeout" });
      idleCancelled++;
      continue;
    }

    const timeoutWinner = computeTimeoutWinner(liveState);
    if (timeoutWinner) {
      // The side that timed out is whichever one WASN'T the winner, their
      // clock is what hit zero, so that's what gets persisted; the other
      // side's clock wasn't running and keeps whatever liveState already
      // has for it.
      const loserRemainingMs = 0;
      const winnerRemainingMs =
        timeoutWinner === "white" ? liveState.whiteRemainingMs : liveState.blackRemainingMs;
      await finalizeGame(gameId, liveState.fen, "finished", timeoutWinner, "timeout", {
        whiteRemainingMs: timeoutWinner === "white" ? winnerRemainingMs : loserRemainingMs,
        blackRemainingMs: timeoutWinner === "black" ? winnerRemainingMs : loserRemainingMs,
      });
      await deleteLiveState(gameId);
      await settleWager(
        gameId,
        liveState.whiteId,
        liveState.blackId,
        liveState.wagerTokens,
        timeoutWinner,
      ).catch((err) =>
        console.error("settleWager failed during reconciliation:", err),
      );
      applyRatingForGame(gameId, liveState.whiteId, liveState.blackId, timeoutWinner).catch((err) =>
        console.error("applyRatingForGame failed during reconciliation:", err),
      );
      if (g.cageMatchId && g.legIndex !== undefined) {
        await advanceCageMatchLeg(g.cageMatchId.toString(), g.legIndex, timeoutWinner, "timeout", gameId);
      }
      if (g.tournamentId && g.roundIndex !== undefined && g.pairingIndex !== undefined) {
        await advanceTournamentIfPairing(
          g.tournamentId.toString(),
          g.roundIndex,
          g.pairingIndex,
          timeoutWinner,
          "timeout",
        );
      }
      timedOut++;
      continue;
    }

    await scheduleGameTimer(gameId);
    await scheduleFirstMoveTimer(gameId);
    resumed++;
  }

  return { resumed, timedOut, aborted, idleCancelled };
}
