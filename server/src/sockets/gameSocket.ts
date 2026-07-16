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
} from '../services/gameState.service.js';
import { appendMove, finalizeGame } from '../services/game.service.js';
import { scheduleGameTimer, clearGameTimer, setTimeoutHandler } from '../services/clock.service.js';
import type { AuthedSocketData } from './socketAuth.js';

const gameRoom = (gameId: string) => `game:${gameId}`;

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
  // Broadcast immediately — persistence to Mongo doesn't need to gate the UI update.
  io.to(gameRoom(gameId)).emit('game:over', { gameId, result, reason: endReason });
  finalizeGame(gameId, finalState.fen, 'finished', result, endReason).catch((err) =>
    console.error('finalizeGame failed:', err),
  );
  deleteLiveState(gameId).catch((err) => console.error('deleteLiveState failed:', err));
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

      // Reconnecting clears any pending "opponent disconnected" state for this game.
      const pending = pendingDisconnects.get(gameId);
      if (pending && pending.disconnectedUserId === userId) {
        clearPendingDisconnect(gameId);
        io.to(gameRoom(gameId)).emit('game:opponent_reconnected', { userId });
      }

      const liveState = await getLiveState(gameId);
      socket.emit('game:sync', {
        gameId,
        joinCode: game.joinCode,
        role,
        fen: liveState?.fen ?? game.fen,
        status: liveState?.status ?? game.status,
        white: game.white,
        black: game.black,
        moves: game.moves,
        timeControl: game.timeControl,
        whiteRemainingMs:
          liveState?.whiteRemainingMs ?? (game.timeControl.baseSeconds ? game.timeControl.baseSeconds * 1000 : null),
        blackRemainingMs:
          liveState?.blackRemainingMs ?? (game.timeControl.baseSeconds ? game.timeControl.baseSeconds * 1000 : null),
        turnStartedAtMs: liveState?.turnStartedAtMs ?? Date.now(),
      });

      if (role !== 'spectator') {
        socket.to(gameRoom(gameId)).emit('game:opponent_connected', { userId });
      }
    }),
  );

  socket.on(
    'game:move',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = moveSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid move payload');
      const { gameId, from, to, promotion } = parsed.data;

      try {
        const result = await applyMove(gameId, userId, { from, to, promotion });

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

  socket.on('disconnecting', () => {
    const rooms = Array.from(socket.rooms).filter((r) => r.startsWith('game:'));
    for (const room of rooms) {
      const gameId = room.slice('game:'.length);
      handlePotentialDisconnect(io, gameId, userId).catch((err) =>
        console.error('handlePotentialDisconnect failed:', err),
      );
    }
  });
}
