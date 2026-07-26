import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Game } from '../models/Game.js';
import {
  applyMove,
  endGame,
  getLiveState,
  deleteLiveState,
  GameTimeoutError,
  BerserkNotAllowedError,
} from '../services/gameState.service.js';
import {
  appendMove,
  finalizeGame,
  createDirectGame,
  settleWager,
  refundWagerBothSides,
} from '../services/game.service.js';
import { advanceCageMatchLeg, handleLegMoveForNoShow } from '../services/cageMatch.service.js';
import { advanceTournamentIfPairing, berserkInTournamentGame } from '../services/tournament.service.js';
import { scheduleGameTimer, clearGameTimer, setTimeoutHandler } from '../services/clock.service.js';
import type { AuthedSocketData } from './socketAuth.js';

const gameRoom = (gameId: string) => `game:${gameId}`;
const spectatorRoom = (gameId: string) => `game:${gameId}:spectators`;

const joinSchema = z.object({ gameId: z.string().refine(mongoose.isValidObjectId) });
const moveSchema = z.object({
  gameId: z.string().refine(mongoose.isValidObjectId),
  from: z.string().length(2),
  to: z.string().length(2),
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
});
const gameIdSchema = z.object({ gameId: z.string().refine(mongoose.isValidObjectId) });
const claimSchema = z.object({
  gameId: z.string().refine(mongoose.isValidObjectId),
  claim: z.enum(['win', 'draw']),
});
const rematchOfferSchema = z.object({ gameId: z.string().refine(mongoose.isValidObjectId) });
const rematchRespondSchema = z.object({
  gameId: z.string().refine(mongoose.isValidObjectId),
  accept: z.boolean(),
});
const abortSchema = z.object({ gameId: z.string().refine(mongoose.isValidObjectId) });
const berserkSchema = z.object({ gameId: z.string().refine(mongoose.isValidObjectId) });
const chatSchema = z.object({
  gameId: z.string().refine(mongoose.isValidObjectId),
  message: z.string().trim().min(1).max(300),
});

function emitError(socket: Socket, message: string) {
  socket.emit('game:error', { message });
}

function safeHandler<T>(socket: Socket, fn: (payload: T) => Promise<void>) {
  return (payload: T) => {
    fn(payload).catch((err) => {
      console.error('game socket handler failed:', err);
      emitError(socket, err instanceof Error ? err.message : 'Something went wrong');
    });
  };
}

async function endGameAndBroadcast(
  io: Server,
  gameId: string,
  result: 'white' | 'black' | 'draw',
  endReason: string,
) {
  clearGameTimer(gameId);
  clearPendingDisconnect(gameId);
  const finalState = await endGame(gameId, result, endReason);

  // Wager settlement is quick and only happens once per finished game (not on
  // the hot move-broadcast path), so it's worth awaiting it to include
  // directly in the game:over payload rather than making clients re-fetch
  // their wallet balance to see the payout land.
  const wagerSettlement = await settleWager(
    gameId,
    finalState.whiteId,
    finalState.blackId,
    finalState.wagerTokens,
    result,
  ).catch((err) => {
    console.error('settleWager failed:', err);
    return null;
  });

  io.to(gameRoom(gameId)).emit('game:over', {
    gameId,
    result,
    reason: endReason,
    wagerSettlement,
  });
  finalizeGame(gameId, finalState.fen, 'finished', result, endReason).catch((err) =>
    console.error('finalizeGame failed:', err),
  );
  deleteLiveState(gameId).catch((err) => console.error('deleteLiveState failed:', err));

  await advanceCageMatchIfLeg(gameId, result, endReason);
  await advanceTournamentIfPairingLeg(gameId, result, endReason);
}

// If a game is one leg of a cage match, advance the series: either the next
// leg starts automatically, or the whole match concludes (including any
// winner-takes-all payout). Looked up fresh from Mongo rather than threaded
// through every call site, since the overwhelming majority of games have
// nothing to do with a cage match. A no-moves abort has no real winner, so
// it's reported as a draw for leg-scoring purposes — the per-leg wager (if
// any) is still refunded rather than paid out, via refundWagerBothSides.
async function advanceCageMatchIfLeg(
  gameId: string,
  result: 'white' | 'black' | 'draw',
  endReason: string,
) {
  const gameDoc = await Game.findById(gameId).select('cageMatchId legIndex').lean();
  if (!gameDoc?.cageMatchId || gameDoc.legIndex === undefined) return;
  await advanceCageMatchLeg(gameDoc.cageMatchId.toString(), gameDoc.legIndex, result, endReason);
}

// Mirror of advanceCageMatchIfLeg, but for tournament pairings — a game tagged
// with tournamentId/roundIndex/pairingIndex advances that pairing's round the
// same way a cage leg advances its match.
async function advanceTournamentIfPairingLeg(
  gameId: string,
  result: 'white' | 'black' | 'draw',
  endReason: string,
) {
  const gameDoc = await Game.findById(gameId).select('tournamentId roundIndex pairingIndex').lean();
  if (!gameDoc?.tournamentId || gameDoc.roundIndex === undefined || gameDoc.pairingIndex === undefined) return;
  await advanceTournamentIfPairing(
    gameDoc.tournamentId.toString(),
    gameDoc.roundIndex,
    gameDoc.pairingIndex,
    result,
    endReason,
  );
}

export function registerClockTimeoutHandler(io: Server) {
  setTimeoutHandler(async (gameId, winner) => {
    await endGameAndBroadcast(io, gameId, winner, 'timeout');
  });
}

// --- Disconnect / reconnect grace period -----------------------------------
//
// If a player's socket drops mid-game, we don't want to end the game instantly
// (page refreshes and flaky wifi happen). Instead: wait a short debounce period
// to rule out a quick refresh, then start a longer grace period during which the
// disconnected player can still come back. Only after the grace period expires
// can the opponent actively claim a win or draw — nothing resolves automatically.
const DISCONNECT_DEBOUNCE_MS = 3000;
const DISCONNECT_GRACE_MS = 60_000;

interface PendingDisconnect {
  disconnectedUserId: string;
  expiresAt: number;
}
const pendingDisconnects = new Map<string, PendingDisconnect>();

function clearPendingDisconnect(gameId: string) {
  pendingDisconnects.delete(gameId);
}

// --- Rematches ---------------------------------------------------------------
// Keyed by the *original* game's id. A rematch offer expires if not answered —
// there's no point letting a stale offer linger once one side has moved on.
const REMATCH_OFFER_TTL_MS = 30_000;
const pendingRematches = new Map<string, { fromUserId: string; expiresAt: number }>();

// --- Move rate limiting -------------------------------------------------------
// Cheap defense against a scripted client flooding moves. The threshold is
// deliberately low — even the fastest legitimate bullet/premove play rarely
// produces two distinct move submissions under ~60ms apart, since each one
// requires a real network round trip.
const MIN_MS_BETWEEN_MOVES = 60;
const lastMoveAtBySocket = new Map<string, number>();

function isMoveRateLimited(socketId: string): boolean {
  const now = Date.now();
  const last = lastMoveAtBySocket.get(socketId);
  lastMoveAtBySocket.set(socketId, now);
  return last !== undefined && now - last < MIN_MS_BETWEEN_MOVES;
}

async function userStillInRoom(io: Server, gameId: string, userId: string): Promise<boolean> {
  const sockets = await io.in(gameRoom(gameId)).fetchSockets();
  return sockets.some((s) => (s.data as AuthedSocketData).userId === userId);
}

async function handlePotentialDisconnect(io: Server, gameId: string, userId: string) {
  const state = await getLiveState(gameId);
  if (!state || state.status !== 'active') return;
  const isPlayer = state.whiteId === userId || state.blackId === userId;
  if (!isPlayer) return; // spectators leaving is a non-event

  setTimeout(async () => {
    try {
      const stillThere = await userStillInRoom(io, gameId, userId);
      if (stillThere) return; // reconnected within the debounce window

      const freshState = await getLiveState(gameId);
      if (!freshState || freshState.status !== 'active') return;

      const expiresAt = Date.now() + DISCONNECT_GRACE_MS;
      pendingDisconnects.set(gameId, { disconnectedUserId: userId, expiresAt });
      io.to(gameRoom(gameId)).emit('game:opponent_disconnected', {
        userId,
        graceMs: DISCONNECT_GRACE_MS,
      });

      setTimeout(async () => {
        // Only fire if nothing has changed this in the meantime (reconnect, resign, etc.)
        const pending = pendingDisconnects.get(gameId);
        if (!pending || pending.disconnectedUserId !== userId) return;
        const stillGone = !(await userStillInRoom(io, gameId, userId));
        if (!stillGone) return;
        io.to(gameRoom(gameId)).emit('game:claim_available', { userId });
      }, DISCONNECT_GRACE_MS);
    } catch (err) {
      console.error('disconnect-grace handling failed:', err);
    }
  }, DISCONNECT_DEBOUNCE_MS);
}

export function registerGameHandlers(io: Server, socket: Socket) {
  const { userId } = socket.data as AuthedSocketData;

  socket.on(
    'game:join',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = joinSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid join payload');
      const { gameId } = parsed.data;

      const game = await Game.findById(gameId).lean();
      if (!game) return emitError(socket, 'Game not found');

      const isWhite = game.white.toString() === userId;
      const isBlack = game.black?.toString() === userId;
      const role: 'white' | 'black' | 'spectator' = isWhite ? 'white' : isBlack ? 'black' : 'spectator';

      await socket.join(gameRoom(gameId));
      if (role === 'spectator') {
        // Kept separate from the main game room so spectator chat traffic
        // never reaches the players — they don't get a chat UI at all, and
        // this means they never even receive the events for one.
        await socket.join(spectatorRoom(gameId));
      }

      // Reconnecting clears any pending "opponent disconnected" state for this game.
      const pending = pendingDisconnects.get(gameId);
      if (pending && pending.disconnectedUserId === userId) {
        clearPendingDisconnect(gameId);
        io.to(gameRoom(gameId)).emit('game:opponent_reconnected', { userId });
      }

      const liveState = await getLiveState(gameId);

      // Snapshot of who's actually connected right now — combined with the
      // opponent_connected/disconnected/reconnected events for live updates,
      // this is what drives the connection dot next to each player's name.
      const roomSockets = await io.in(gameRoom(gameId)).fetchSockets();
      const connectedUserIds = new Set(roomSockets.map((s) => (s.data as AuthedSocketData).userId));
      const whiteConnected = connectedUserIds.has(game.white.toString());
      const blackConnected = game.black ? connectedUserIds.has(game.black.toString()) : false;

      // Cheap self-healing measure: (re)scheduling on every join/reconnect
      // means the timer recovers on its own the moment anyone next touches
      // the game, rather than only being set at creation and after moves —
      // which left a window where a lost timer (process restart, etc.) would
      // sit silently until someone tried to move.
      if (liveState?.status === 'active') {
        scheduleGameTimer(gameId).catch((err) => console.error('scheduleGameTimer on join failed:', err));
      }

      socket.emit('game:sync', {
        gameId,
        joinCode: game.joinCode,
        variant: game.variant,
        initialFen: game.initialFen,
        role,
        fen: liveState?.fen ?? game.fen,
        status: liveState?.status ?? game.status,
        result: liveState?.result ?? game.result,
        endReason: liveState?.endReason ?? game.endReason,
        white: game.white,
        black: game.black,
        whiteConnected,
        blackConnected,
        moves: game.moves,
        timeControl: game.timeControl,
        wagerTokens: game.wagerTokens,
        cageMatchId: game.cageMatchId ?? null,
        legIndex: game.legIndex ?? null,
        tournamentId: game.tournamentId ?? null,
        roundIndex: game.roundIndex ?? null,
        pairingIndex: game.pairingIndex ?? null,
        berserk: liveState
          ? { white: liveState.whiteBerserk, black: liveState.blackBerserk }
          : (game.berserk ?? { white: false, black: false }),
        paused: liveState?.paused ?? false,
        whiteRemainingMs:
          liveState?.whiteRemainingMs ?? (game.timeControl.baseSeconds ? game.timeControl.baseSeconds * 1000 : null),
        blackRemainingMs:
          liveState?.blackRemainingMs ?? (game.timeControl.baseSeconds ? game.timeControl.baseSeconds * 1000 : null),
        turnStartedAtMs: liveState?.turnStartedAtMs ?? Date.now(),
      });

      if (role !== 'spectator') {
        socket.to(gameRoom(gameId)).emit('game:opponent_connected', { userId });
      }

      if (game.tournamentId) {
        await socket.join(`tournament:${game.tournamentId.toString()}`);
      }
    }),
  );

  socket.on(
    'game:move',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = moveSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid move payload');
      if (isMoveRateLimited(socket.id)) return emitError(socket, 'Please slow down');
      const { gameId, from, to, promotion } = parsed.data;

      try {
        const result = await applyMove(gameId, userId, { from, to, promotion });

        // A move landing clears the no-show grace window it just satisfied —
        // and if this was White's first move, re-arms a fresh one for
        // Black's first reply. Harmless no-op for any game that was never a
        // cage match leg, or that's already past both first moves. Not
        // awaited so it can't slow down how fast the opponent sees the move.
        handleLegMoveForNoShow(gameId, result.moveNumber).catch((err) =>
          console.error('handleLegMoveForNoShow failed:', err),
        );

        // Broadcast first — Mongo persistence is for history/reconnect sync, it
        // doesn't need to gate how fast the opponent sees the move land.
        io.to(gameRoom(gameId)).emit('game:move', {
          gameId,
          san: result.san,
          from: result.from,
          to: result.to,
          promotion: result.promotion,
          fen: result.fenAfter,
          moveNumber: result.moveNumber,
          whiteRemainingMs: result.whiteRemainingMs,
          blackRemainingMs: result.blackRemainingMs,
          turnStartedAtMs: Date.now(),
        });

        appendMove(gameId, {
          san: result.san,
          from: result.from,
          to: result.to,
          promotion: result.promotion,
          fenAfter: result.fenAfter,
          moveNumber: result.moveNumber,
        }).catch((err) => console.error('appendMove failed:', err));

        if (result.isGameOver) {
          await endGameAndBroadcast(io, gameId, result.result!, result.endReason!);
        } else {
          scheduleGameTimer(gameId).catch((err) => console.error('scheduleGameTimer failed:', err));
        }
      } catch (err) {
        if (err instanceof GameTimeoutError) {
          await endGameAndBroadcast(io, gameId, err.winner, 'timeout');
          return;
        }
        emitError(socket, err instanceof Error ? err.message : 'Move rejected');
      }
    }),
  );

  socket.on(
    'game:resign',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = gameIdSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const { gameId } = parsed.data;

      const state = await getLiveState(gameId);
      if (!state) return emitError(socket, 'Game is not active');

      const winner = state.whiteId === userId ? 'black' : state.blackId === userId ? 'white' : null;
      if (!winner) return emitError(socket, 'You are not a player in this game');

      await endGameAndBroadcast(io, gameId, winner, 'resignation');
    }),
  );

  socket.on(
    'game:berserk',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = berserkSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const { gameId } = parsed.data;

      try {
        const side = await berserkInTournamentGame(gameId, userId);
        const state = await getLiveState(gameId);
        io.to(gameRoom(gameId)).emit('game:berserked', {
          gameId,
          side,
          whiteRemainingMs: state?.whiteRemainingMs ?? null,
          blackRemainingMs: state?.blackRemainingMs ?? null,
        });
      } catch (err) {
        if (err instanceof BerserkNotAllowedError) {
          emitError(socket, err.message);
          return;
        }
        throw err;
      }
    }),
  );

  socket.on(
    'game:offer_draw',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = gameIdSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      socket.to(gameRoom(parsed.data.gameId)).emit('game:draw_offered', { by: userId });
    }),
  );

  socket.on(
    'game:respond_draw',
    safeHandler(socket, async (raw: unknown) => {
      const schema = gameIdSchema.extend({ accept: z.boolean() });
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const { gameId, accept } = parsed.data;

      if (!accept) {
        socket.to(gameRoom(gameId)).emit('game:draw_declined', { by: userId });
        return;
      }

      const state = await getLiveState(gameId);
      if (!state) return emitError(socket, 'Game is not active');

      await endGameAndBroadcast(io, gameId, 'draw', 'draw_agreement');
    }),
  );

  // Claiming a win/draw after the opponent has been gone longer than the grace period.
  socket.on(
    'game:claim_disconnect',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = claimSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const { gameId, claim } = parsed.data;

      const pending = pendingDisconnects.get(gameId);
      if (!pending) return emitError(socket, 'There is no disconnect to claim right now');
      if (Date.now() < pending.expiresAt) {
        return emitError(socket, 'The grace period has not finished yet');
      }

      const state = await getLiveState(gameId);
      if (!state) return emitError(socket, 'Game is not active');

      const isOpponent =
        (state.whiteId === userId && state.blackId === pending.disconnectedUserId) ||
        (state.blackId === userId && state.whiteId === pending.disconnectedUserId);
      if (!isOpponent) return emitError(socket, 'You are not eligible to claim this game');

      const result = claim === 'draw' ? 'draw' : state.whiteId === userId ? 'white' : 'black';
      await endGameAndBroadcast(io, gameId, result, 'abandoned');
    }),
  );

  socket.on(
    'game:rematch_offer',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = rematchOfferSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const { gameId } = parsed.data;

      const game = await Game.findById(gameId).lean();
      if (!game) return emitError(socket, 'Game not found');
      if (game.status !== 'finished') return emitError(socket, 'Game has not finished yet');

      const isWhite = game.white.toString() === userId;
      const isBlack = game.black?.toString() === userId;
      if (!isWhite && !isBlack) return emitError(socket, 'You were not a player in this game');

      const opponentId = isWhite ? game.black?.toString() : game.white.toString();
      if (!opponentId) return emitError(socket, 'No opponent to rematch');

      pendingRematches.set(gameId, { fromUserId: userId, expiresAt: Date.now() + REMATCH_OFFER_TTL_MS });

      io.to(`user:${opponentId}`).emit('game:rematch_offered', { gameId, from: userId });
      setTimeout(() => {
        const pending = pendingRematches.get(gameId);
        if (pending && pending.fromUserId === userId) pendingRematches.delete(gameId);
      }, REMATCH_OFFER_TTL_MS);
    }),
  );

  socket.on(
    'game:rematch_respond',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = rematchRespondSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const { gameId, accept } = parsed.data;

      const pending = pendingRematches.get(gameId);
      if (!pending) return emitError(socket, 'That rematch offer has expired');

      const game = await Game.findById(gameId).lean();
      if (!game) return emitError(socket, 'Original game not found');

      const isWhite = game.white.toString() === userId;
      const isBlack = game.black?.toString() === userId;
      if (!isWhite && !isBlack) return emitError(socket, 'You were not a player in this game');
      if (pending.fromUserId === userId) return emitError(socket, "You can't respond to your own offer");

      pendingRematches.delete(gameId);

      if (!accept) {
        io.to(`user:${pending.fromUserId}`).emit('game:rematch_declined', { gameId });
        return;
      }

      // Swap colors for the rematch — standard etiquette, and it means the same
      // player isn't stuck playing white (or black) twice in a row.
      const newWhite = isWhite ? game.black!.toString() : game.white.toString();
      const newBlack = isWhite ? game.white.toString() : game.black!.toString();

      let newGame;
      try {
        newGame = await createDirectGame(
          newWhite,
          newBlack,
          {
            baseMinutes: game.timeControl.baseSeconds === null ? null : game.timeControl.baseSeconds / 60,
            incrementSeconds: game.timeControl.incrementSeconds,
          },
          undefined,
          game.variant,
          game.wagerTokens,
        );
      } catch (err) {
        // Same wager as the original game — if either side can no longer
        // cover it, no tokens move and both players just hear why.
        const message = err instanceof Error ? err.message : 'Could not start the rematch';
        emitError(socket, message);
        io.to(`user:${pending.fromUserId}`).emit('game:error', { message });
        return;
      }

      const payload = { gameId: newGame.id, joinCode: newGame.joinCode, wagerTokens: newGame.wagerTokens };
      io.to(`user:${game.white.toString()}`).emit('game:rematch_accepted', payload);
      io.to(`user:${game.black!.toString()}`).emit('game:rematch_accepted', payload);
    }),
  );

  // Lets either player back out cleanly before the game has really started —
  // deliberately separate from resign: no winner is recorded, and it never
  // shows up in either player's W/L/D stats or game history (those only count
  // status: 'finished' games).
  socket.on(
    'game:abort',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = abortSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const { gameId } = parsed.data;

      const state = await getLiveState(gameId);
      if (!state) return emitError(socket, 'Game is not active');
      if (state.whiteId !== userId && state.blackId !== userId) {
        return emitError(socket, 'You are not a player in this game');
      }
      if (state.moveCount >= 2) {
        return emitError(socket, 'This game can no longer be aborted — both sides have moved');
      }

      clearGameTimer(gameId);
      clearPendingDisconnect(gameId);
      await finalizeGame(gameId, state.fen, 'aborted', null, 'aborted_no_moves');
      await refundWagerBothSides(gameId, state.whiteId, state.blackId, state.wagerTokens).catch((err) =>
        console.error('refundWagerBothSides failed:', err),
      );
      await deleteLiveState(gameId);

      io.to(gameRoom(gameId)).emit('game:over', { gameId, result: null, reason: 'aborted_no_moves' });

      await advanceCageMatchIfLeg(gameId, 'draw', 'aborted_no_moves');
    }),
  );

  // Deliberately spectator-only, and never persisted anywhere (no Mongo, no
  // Redis) — purely a live relay through Socket.IO. Refresh the page and the
  // history is gone, by design.
  socket.on(
    'spectator_chat:send',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = chatSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid chat payload');
      const { gameId, message } = parsed.data;

      if (!socket.rooms.has(spectatorRoom(gameId))) {
        return emitError(socket, 'Only spectators can use this chat');
      }

      const { username } = socket.data as AuthedSocketData;
      io.to(spectatorRoom(gameId)).emit('spectator_chat:message', {
        username,
        message,
        at: Date.now(),
      });
    }),
  );

  socket.on('disconnecting', () => {
    lastMoveAtBySocket.delete(socket.id);
    const rooms = Array.from(socket.rooms).filter((r) => r.startsWith('game:'));
    for (const room of rooms) {
      const gameId = room.slice('game:'.length);
      handlePotentialDisconnect(io, gameId, userId).catch((err) =>
        console.error('handlePotentialDisconnect failed:', err),
      );
    }
  });
}
