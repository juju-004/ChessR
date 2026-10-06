import { customAlphabet } from "nanoid";
import { Game, type IGame } from "../models/Game.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import {
  claimGameEnd,
  initLiveState,
  getLiveState,
  computeTimeoutWinner,
  deleteLiveState,
  getLiveMoves,
  deleteLiveMoves,
  mergeLiveMoves,
  type LiveTimeControl,
} from "./gameState.service.js";
import {
  scheduleGameTimer,
  scheduleFirstMoveTimer,
  hasGameTimer,
  hasFirstMoveTimer,
} from "./clock.service.js";
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
import { notifyGameEnded } from "./latency.service.js";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// A normal game (not a cage match leg, not a tournament pairing) that's sat
// in the idle phase, active, but neither side has made their first move, 
// for this long gets auto-cancelled by the reconciliation sweep below.
// Cage match legs have their own no-show forfeit timer, and tournament
// pairings are intentionally left out of scope here (walking away from a
// bracket game isn't something either safety net should do quietly on a
// player's behalf), so only plain games get this treatment.
const IDLE_PHASE_ABANDON_MS = 5 * 60 * 1000;

// An open game ("waiting", nobody has taken the second seat) that's been
// sitting this long is auto-aborted by sweepStaleWaitingGames below, the
// host's stake (if any) is refunded and it drops off the lobby. Applies to
// private (share-a-code) tables too. Before this existed, nothing ever
// closed a waiting game unless the host cancelled it by hand, so abandoned
// tables piled up in the lobby indefinitely.
export const WAITING_GAME_TTL_MS = 10 * 60 * 1000;

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

/** Socket.IO room everyone with the lobby page open sits in, see
 *  lobbySocket.ts. */
export const LOBBY_ROOM = "lobby:open";

/** Tells everyone watching the lobby the list of open games changed (one was
 *  created, cancelled or accepted), they refetch. Payload-free on purpose:
 *  the HTTP list is the single source of truth. */
const LOBBY_EMIT_MIN_GAP_MS = 500;
let lobbyEmitTimer: ReturnType<typeof setTimeout> | null = null;
let lastLobbyEmitAt = 0;

/** Every lobby viewer refetches the open-games list on this event, so a burst
 *  of creates/accepts used to mean (changes x viewers) HTTP requests. Emits
 *  are now spaced at least LOBBY_EMIT_MIN_GAP_MS apart (a change inside the
 *  gap is covered by one trailing emit), and the list itself is cached
 *  briefly, see listOpenGames. */
function broadcastLobbyChanged(): void {
  openGamesCache = null;
  if (lobbyEmitTimer) return; // a pending emit already covers this change
  const wait = Math.max(0, LOBBY_EMIT_MIN_GAP_MS - (Date.now() - lastLobbyEmitAt));
  lobbyEmitTimer = setTimeout(() => {
    lobbyEmitTimer = null;
    lastLobbyEmitAt = Date.now();
    try {
      getIo().to(LOBBY_ROOM).emit("lobby:changed");
    } catch {
      // Socket.IO not initialized (script/test context), safe to ignore.
    }
  }, wait);
  lobbyEmitTimer.unref?.();
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

  if (!isPrivate) broadcastLobbyChanged();
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
  broadcastLobbyChanged();
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

  // Claim the seat atomically. In a public lobby several people can hit
  // "Accept" on the same listing at once; the status filter here means
  // exactly one of them wins, and everyone else gets their stake straight
  // back instead of being charged for a game they never sat down in.
  const claimed = await Game.findOneAndUpdate(
    { _id: game.id, status: "waiting", black: null },
    {
      $set: {
        black: joiningUserId,
        status: "active",
        startedAt: new Date(),
      },
    },
    { new: true },
  );
  if (!claimed) {
    if (game.wagerTokens > 0) {
      await creditWagerReturn(
        joiningUserId,
        game.id,
        game.wagerTokens,
        "wager_refund",
      );
    }
    throw ApiError.conflict("Someone else just took that game");
  }
  // From here on `game` is the claimed, up-to-date document.
  game.black = claimed.black;
  game.status = claimed.status;
  game.startedAt = claimed.startedAt;

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
  broadcastLobbyChanged();

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

/** Batch form of getActiveGameCodeForUser: ONE query for a whole list of
 *  users (the friends list used to run one query per friend). Same rule as
 *  the single version: a game the viewer is also in is excluded. Returns
 *  userId -> joinCode for whoever is mid-game. */
export async function getActiveGameCodesForUsers(
  userIds: string[],
  viewerId?: string,
): Promise<Map<string, string>> {
  const codes = new Map<string, string>();
  if (userIds.length === 0) return codes;
  const games = await Game.find({
    status: "active",
    $or: [{ white: { $in: userIds } }, { black: { $in: userIds } }],
    ...(viewerId ? { white: { $ne: viewerId }, black: { $ne: viewerId } } : {}),
  })
    .select("joinCode white black")
    .lean();
  const wanted = new Set(userIds);
  for (const g of games) {
    for (const side of [g.white, g.black]) {
      const id = side?.toString();
      if (id && wanted.has(id) && !codes.has(id)) codes.set(id, g.joinCode);
    }
  }
  return codes;
}

// The anonymous list (what GET /games/open serves) is identical for every
// viewer, and every lobby viewer refetches it at the same instant after a
// lobby:changed. Concurrent callers share ONE query, and the result is reused
// for a very short window; any local change clears it immediately.
const OPEN_GAMES_CACHE_TTL_MS = 500;
let openGamesCache: { at: number; promise: Promise<unknown[]> } | null = null;

function queryOpenGames(excludeUserId?: string) {
  return Game.find({
    status: "waiting",
    isPrivate: false,
    ...(excludeUserId ? { white: { $ne: excludeUserId } } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("white", "username avatarGradient rating")
    .lean()
    // .exec() returns a real Promise. Without it this returns a Mongoose Query
    // (a thenable), and every .then/.catch/await on it re-runs the query, so
    // the cache below hit "Query was already executed" and /games/open 500'd.
    .exec();
}

export async function listOpenGames(excludeUserId?: string) {
  if (excludeUserId) return queryOpenGames(excludeUserId);
  const now = Date.now();
  if (openGamesCache && now - openGamesCache.at < OPEN_GAMES_CACHE_TTL_MS) {
    return (await openGamesCache.promise) as Awaited<ReturnType<typeof queryOpenGames>>;
  }
  const promise = queryOpenGames();
  const entry = { at: now, promise: promise as Promise<unknown[]> };
  openGamesCache = entry;
  // A failed query must not be served from cache.
  promise.catch(() => {
    if (openGamesCache === entry) openGamesCache = null;
  });
  return promise;
}

export async function getGameByCode(code: string) {
  const game = await Game.findOne({ joinCode: code.toUpperCase() })
    .populate("white", "username avatarGradient rating")
    .populate("black", "username avatarGradient rating")
    // Just enough of the tournament for the "Back to tournament" link
    // (code), the in-game badge label (name), and — for formats that have
    // one — the live countdown badge (format + arenaEndsAt; arenaMinutes
    // kept too since it's the fallback shown before arenaEndsAt gets set
    // at actual arena start, see Game.tsx's badges list). status is needed
    // so that badge can stop showing once the arena itself has finished —
    // arenaEndsAt is a fixed past timestamp forever after that, so without
    // status the badge has no way to distinguish "still wrapping up" from
    // "long over" and gets stuck reading "Ending…" indefinitely. Deliberately
    // not the whole Tournament doc for every single game fetch.
    .populate("tournamentId", "code name format status arenaMinutes arenaEndsAt berserkAllowed")
    .lean();
  if (!game) throw ApiError.notFound("No game found with that code");
  // A game in progress keeps its moves and current position in Redis, not
  // Mongo, until it ends (see finalizeGame).
  if (game.status === "active") {
    const id = String(game._id);
    const [liveMoves, liveState] = await Promise.all([getLiveMoves(id), getLiveState(id)]);
    if (liveMoves.length > 0) {
      game.moves = mergeLiveMoves(game.moves, liveMoves) as unknown as typeof game.moves;
    }
    if (liveState) game.fen = liveState.fen;
  }
  return game;
}

export async function finalizeGame(
  gameId: string,
  fen: string,
  status: "finished" | "aborted",
  result: "white" | "black" | "draw" | null,
  endReason: string | null,
  finalClock?: { whiteRemainingMs: number | null; blackRemainingMs: number | null },
): Promise<void> {
  // The move list exists only in Redis until now. This one write is the
  // game's single move-list write to Mongo.
  const liveMoves = await getLiveMoves(gameId);
  if (liveMoves.length > 0 && liveMoves[0].moveNumber > 1) {
    // Redis holds only the tail of the list: a game that was under way when
    // per-move Mongo writes were removed, or one whose Redis list was lost
    // part-way. Mongo holds the earlier moves (written per move back then,
    // or by a periodic snapshot), possibly overlapping the live ones. Merge
    // by move number, which is also safe to retry.
    const existing = await Game.findById(gameId).select('moves').lean();
    const merged = mergeLiveMoves(existing?.moves ?? [], liveMoves);
    await Game.updateOne({ _id: gameId }, { $set: { moves: merged } });
  }
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
        ...(liveMoves.length > 0 && liveMoves[0].moveNumber === 1 ? { moves: liveMoves } : {}),
      },
    },
    { select: 'cageMatchId' },
  ).lean();

  // Only now that Mongo has them (an error above leaves the list in Redis
  // for a retry).
  if (liveMoves.length > 0) {
    await deleteLiveMoves(gameId).catch((err) => console.error('deleteLiveMoves failed:', err));
  }

  // Every way a game ends (socket handlers, clock timers, the 60s sweeps)
  // goes through here, so this is the one place that can guarantee the
  // latency heartbeat stops, including endings that never emit game:over
  // and endings that happen on a different server instance.
  notifyGameEnded(gameId);

  // Standalone games only, a cage match leg's spectator chat is scoped to
  // the whole match (see chat.service.ts / chatScopeFor in gameSocket.ts)
  // and only expires once the entire match finishes, that's handled
  // separately in cageMatch.service.ts, not here per-leg.
  if (updated && !updated.cageMatchId) {
    expireChat('game', gameId).catch((err) => console.error('expireChat(game) failed:', err));
    expireChat('game_players', gameId).catch((err) => console.error('expireChat(game_players) failed:', err));
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

type ReconcileLiveState = NonNullable<Awaited<ReturnType<typeof getLiveState>>>;

/** Whether a game that has been sitting in its idle phase (under 2 moves)
 *  for too long should be cancelled. Standalone games only, cage legs and
 *  tournament pairings have their own first-move handling. */
function idlePhaseExpired(
  g: { cageMatchId?: unknown; tournamentId?: unknown; startedAt?: Date | null },
  liveState: ReconcileLiveState,
): boolean {
  return (
    !g.cageMatchId &&
    !g.tournamentId &&
    liveState.moveCount < 2 &&
    !!g.startedAt &&
    Date.now() - g.startedAt.getTime() > IDLE_PHASE_ABANDON_MS
  );
}

// How many live states to read from Redis at once. The client has
// auto-pipelining on, so a chunk goes out as one round trip instead of one
// per game.
const RECONCILE_CHUNK = 25;
const RECONCILE_PAGE = 200;

/**
 * Safety net for games whose in-memory clock timers or live state were lost.
 *
 * `rearmAll` is for boot: the process just started, so every timer is gone
 * and every healthy game needs both timers rebuilt. The periodic 60s run
 * leaves healthy games alone and only re-arms a timer that's actually
 * missing, instead of clearing and rebuilding two timers (and re-reading
 * Redis twice) for every active game every minute. Anything that looks
 * wrong (no live state, idle too long, clock expired) is re-read fresh from
 * Redis right before acting, since the batched read can be a moment old.
 */
export async function reconcileActiveGames(opts: { rearmAll?: boolean } = {}): Promise<{
  resumed: number;
  timedOut: number;
  aborted: number;
  idleCancelled: number;
}> {
  const rearmAll = opts.rearmAll ?? false;
  let resumed = 0;
  let timedOut = 0;
  let aborted = 0;
  let idleCancelled = 0;

  // Paged by _id (index {status, _id}) rather than one find() of every
  // active game: memory and the per-batch Redis fan-out stay bounded however
  // many games are live at once.
  let lastId: unknown = null;
  for (;;) {
    // Only the fields this function actually reads. The default lean() pulled
    // each game's entire moves array (a FEN per move) every minute.
    const activeGames = await Game.find({ status: "active", ...(lastId ? { _id: { $gt: lastId } } : {}) })
      .select("fen white black wagerTokens startedAt cageMatchId legIndex tournamentId roundIndex pairingIndex")
      .sort({ _id: 1 })
      .limit(RECONCILE_PAGE)
      .lean();
    if (activeGames.length === 0) break;
    lastId = activeGames[activeGames.length - 1]._id;

    const prefetched = new Map<string, ReconcileLiveState | null>();
    for (let i = 0; i < activeGames.length; i += RECONCILE_CHUNK) {
      const chunk = activeGames.slice(i, i + RECONCILE_CHUNK);
      const states = await Promise.all(chunk.map((c) => getLiveState(c._id.toString())));
      chunk.forEach((c, idx) => prefetched.set(c._id.toString(), states[idx]));
    }

    for (const g of activeGames) {
      const gameId = g._id.toString();
      let liveState = prefetched.get(gameId) ?? null;
      prefetched.delete(gameId);

      // Fast path: live state exists, not idle-expired, clock not run out.
      if (liveState && !idlePhaseExpired(g, liveState) && !computeTimeoutWinner(liveState)) {
        if (rearmAll) {
          await scheduleGameTimer(gameId);
          await scheduleFirstMoveTimer(gameId);
        } else if (!liveState.paused) {
          // Mirror the conditions scheduleGameTimer / scheduleFirstMoveTimer
          // use to decide whether a timer is needed at all, and only re-arm
          // one that's needed but missing.
          const needsClockTimer = liveState.timeControl.baseMs !== null && liveState.moveCount >= 2;
          const needsFirstMoveTimer = liveState.moveCount < 2;
          if (needsClockTimer && !hasGameTimer(gameId)) await scheduleGameTimer(gameId);
          if (needsFirstMoveTimer && !hasFirstMoveTimer(gameId)) await scheduleFirstMoveTimer(gameId);
        }
        resumed++;
        continue;
      }

      // Something looks wrong: re-read right before acting on it.
      liveState = await getLiveState(gameId);

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
        // Anyone still on the page would otherwise sit on a live-looking
        // board for a game that no longer exists.
        getIo().to(`game:${gameId}`).emit("game:over", { gameId, result: null, reason: "abandoned" });
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

      if (idlePhaseExpired(g, liveState)) {
        await finalizeGame(gameId, liveState.fen, "aborted", null, "idle_timeout", {
          whiteRemainingMs: liveState.whiteRemainingMs,
          blackRemainingMs: liveState.blackRemainingMs,
        });
        await refundWagerBothSides(gameId, liveState.whiteId, liveState.blackId, liveState.wagerTokens).catch(
          (err) => console.error("refundWagerBothSides failed during idle reconciliation:", err),
        );
        await deleteLiveState(gameId);
        getIo().to(`game:${gameId}`).emit("game:over", { gameId, result: null, reason: "idle_timeout" });
        notifyGameEnded(gameId);
        idleCancelled++;
        continue;
      }

      const timeoutWinner = computeTimeoutWinner(liveState);
      if (timeoutWinner) {
        // The in-memory flag-fall timer (possibly on another instance) may be
        // ending this same game right now; only one ender may proceed.
        if (!(await claimGameEnd(gameId))) continue;
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
        getIo().to(`game:${gameId}`).emit("game:over", {
          gameId,
          result: timeoutWinner,
          reason: "timeout",
          whiteRemainingMs: timeoutWinner === "white" ? winnerRemainingMs : loserRemainingMs,
          blackRemainingMs: timeoutWinner === "black" ? winnerRemainingMs : loserRemainingMs,
        });
        await settleWager(
          gameId,
          liveState.whiteId,
          liveState.blackId,
          liveState.wagerTokens,
          timeoutWinner,
        ).catch((err) =>
          console.error("settleWager failed during reconciliation:", err),
        );
        // Awaited (not fire-and-forget) so the rating change is already in
        // place when the tournament pairing below copies ratings over.
        await applyRatingForGame(gameId, liveState.whiteId, liveState.blackId, timeoutWinner).catch((err) =>
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


    if (activeGames.length < RECONCILE_PAGE) break;
  }

  return { resumed, timedOut, aborted, idleCancelled };
}

/**
 * Auto-aborts open games nobody joined within WAITING_GAME_TTL_MS. Runs on
 * the same 60s sweep as reconcileActiveGames (see index.ts).
 *
 * Each game is claimed with an atomic findOneAndUpdate filtered on
 * status: 'waiting' + black: null, so if someone joins (or the host cancels)
 * at the same instant, exactly one side wins and the refund below can never
 * fire for a game that actually started. Only standalone open games are
 * touched: cage-match legs and tournament pairings are created already
 * 'active' via createDirectGame and never sit in 'waiting'.
 */
export async function sweepStaleWaitingGames(): Promise<{ aborted: number }> {
  const cutoff = new Date(Date.now() - WAITING_GAME_TTL_MS);
  const stale = await Game.find({
    status: "waiting",
    black: null,
    createdAt: { $lte: cutoff },
  })
    .select("_id white wagerTokens isPrivate")
    // Bounded per tick; any backlog is cleared over the next ticks.
    .limit(200)
    .lean();

  let aborted = 0;
  let publicChanged = false;
  for (const g of stale) {
    const gameId = g._id.toString();
    const claimed = await Game.findOneAndUpdate(
      { _id: g._id, status: "waiting", black: null },
      { $set: { status: "aborted", endReason: "cancelled", endedAt: new Date() } },
      { new: true },
    );
    if (!claimed) continue; // joined or cancelled in the meantime

    if (g.wagerTokens > 0) {
      await creditWagerReturn(g.white.toString(), gameId, g.wagerTokens, "wager_refund").catch(
        (err) => console.error("creditWagerReturn failed for stale waiting game:", err),
      );
    }
    // Host may still be sitting on the game page; same payload the idle
    // abort sends so their board flips to "aborted" instead of hanging.
    getIo().to(`game:${gameId}`).emit("game:over", { gameId, result: null, reason: "idle_timeout" });
    notifyGameEnded(gameId);
    if (!g.isPrivate) publicChanged = true;
    aborted++;
  }
  if (publicChanged) broadcastLobbyChanged();
  return { aborted };
}

// An aborted game (nobody played it out — cancelled while waiting, or
// abandoned/idle-timed-out with under 2 moves) has no game history worth
// keeping, same reasoning as sweepCancelledTournaments for a cancelled
// tournament. 24h, not sweepCancelledTournaments' 10 minutes, since
// there's more reason here to leave a short window for a player to look
// back at what just happened (e.g. "wait, why did that get aborted?")
// before it's gone for good.
const ABORTED_GAME_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes standalone aborted games older than the retention window. Scoped
 * to `status: 'aborted'` with `Game.status` leading the existing
 * {status, createdAt} index, so this is an index-scan filtered by a plain
 * equality + range, not a collection scan — cheap enough to run on every
 * tick of the same periodic sweep reconcileActiveGames already runs on
 * (see index.ts), rather than needing its own once-a-day schedule.
 *
 * Deliberately excludes any game that's a cage match leg or tournament
 * pairing: CageMatch.legs[].gameId and Tournament.pairings[].gameId both
 * reference the game by id (see those models), and deleting it out from
 * under a pairing/leg would leave that slot in the match/tournament's
 * history pointing at nothing. Those still age out on their own, just via
 * the cage match / tournament's own lifecycle instead of this sweep. A
 * wagered aborted game's stake has always already been refunded by the
 * time status flips to 'aborted' (finalizeGame's callers all pair the two),
 * so nothing financial is left unsettled by deleting it — Transaction docs
 * do keep a `game` ref for the refund, which this leaves dangling, but
 * that only costs the refund's own "view game" deep link, nothing about
 * the transaction record (amount, type, timestamp) itself.
 */
export async function sweepAbortedGames(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - ABORTED_GAME_RETENTION_MS);
  const result = await Game.deleteMany({
    status: "aborted",
    cageMatchId: { $exists: false },
    tournamentId: { $exists: false },
    // Also catches an aborted game from before endedAt existed on the
    // schema (backfilled as null/missing) — same reasoning as
    // sweepCancelledTournaments' cancelledAt fallback, no reason to let
    // those sit around forever just because we don't know exactly when
    // they ended.
    $or: [{ endedAt: { $lte: cutoff } }, { endedAt: null }],
  });
  return { deleted: result.deletedCount ?? 0 };
}
