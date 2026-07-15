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

function emitError(socket: Socket, message: string) {
  socket.emit('game:error', { message });
}

// Wrap every handler so an unexpected failure surfaces to the client instead of
// vanishing as a silent unhandled promise rejection (this is what made the friend
// challenge flow look "broken" before Redis was actually reachable).
function safeHandler<T>(socket: Socket, fn: (payload: T) => Promise<void>) {
  return (payload: T) => {
    fn(payload).catch((err) => {
      console.error('game socket handler failed:', err);
      emitError(socket, err instanceof Error ? err.message : 'Something went wrong');
    });
  };
}

/** Called once at server startup — wires the clock service's timeout callback to
 *  the same finalize+broadcast logic used everywhere else a game ends. */
export function registerClockTimeoutHandler(io: Server) {
  setTimeoutHandler(async (gameId, winner) => {
    clearGameTimer(gameId);
    const finalState = await endGame(gameId, winner, 'timeout');
    await finalizeGame(gameId, finalState.fen, 'finished', winner, 'timeout');
    await deleteLiveState(gameId);
    io.to(gameRoom(gameId)).emit('game:over', { gameId, result: winner, reason: 'timeout' });
  });
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
        whiteRemainingMs: liveState?.whiteRemainingMs ?? (game.timeControl.baseSeconds ? game.timeControl.baseSeconds * 1000 : null),
        blackRemainingMs: liveState?.blackRemainingMs ?? (game.timeControl.baseSeconds ? game.timeControl.baseSeconds * 1000 : null),
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

        await appendMove(gameId, {
          san: result.san,
          from: result.from,
          to: result.to,
          promotion: result.promotion,
          fenAfter: result.fenAfter,
          moveNumber: result.moveNumber,
        });

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

        if (result.isGameOver) {
          clearGameTimer(gameId);
          await finalizeGame(gameId, result.fenAfter, 'finished', result.result, result.endReason);
          await deleteLiveState(gameId);
          io.to(gameRoom(gameId)).emit('game:over', {
            gameId,
            result: result.result,
            reason: result.endReason,
          });
        } else {
          await scheduleGameTimer(gameId);
        }
      } catch (err) {
        if (err instanceof GameTimeoutError) {
          clearGameTimer(gameId);
          const finalState = await endGame(gameId, err.winner, 'timeout');
          await finalizeGame(gameId, finalState.fen, 'finished', err.winner, 'timeout');
          await deleteLiveState(gameId);
          io.to(gameRoom(gameId)).emit('game:over', {
            gameId,
            result: err.winner,
            reason: 'timeout',
          });
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

      clearGameTimer(gameId);
      const finalState = await endGame(gameId, winner, 'resignation');
      await finalizeGame(gameId, finalState.fen, 'finished', winner, 'resignation');
      await deleteLiveState(gameId);

      io.to(gameRoom(gameId)).emit('game:over', { gameId, result: winner, reason: 'resignation' });
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

      clearGameTimer(gameId);
      const finalState = await endGame(gameId, 'draw', 'draw_agreement');
      await finalizeGame(gameId, finalState.fen, 'finished', 'draw', 'draw_agreement');
      await deleteLiveState(gameId);

      io.to(gameRoom(gameId)).emit('game:over', { gameId, result: 'draw', reason: 'draw_agreement' });
    }),
  );
}
