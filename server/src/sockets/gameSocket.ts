import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Game } from '../models/Game.js';
import {
  applyMove,
  endGame,
  getLiveState,
  deleteLiveState,
} from '../services/gameState.service.js';
import { appendMove, finalizeGame } from '../services/game.service.js';
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

export function registerGameHandlers(io: Server, socket: Socket) {
  const { userId } = socket.data as AuthedSocketData;

  socket.on('game:join', async (raw) => {
    const parsed = joinSchema.safeParse(raw);
    if (!parsed.success) return emitError(socket, 'Invalid join payload');
    const { gameId } = parsed.data;

    const game = await Game.findById(gameId).lean();
    if (!game) return emitError(socket, 'Game not found');

    const isPlayer =
      game.white.toString() === userId || game.black?.toString() === userId;
    if (!isPlayer) return emitError(socket, 'You are not a player in this game');

    await socket.join(gameRoom(gameId));

    const liveState = await getLiveState(gameId);
    socket.emit('game:sync', {
      gameId,
      fen: liveState?.fen ?? game.fen,
      status: liveState?.status ?? game.status,
      white: game.white,
      black: game.black,
      moves: game.moves,
    });

    socket.to(gameRoom(gameId)).emit('game:opponent_connected', { userId });
  });

  socket.on('game:move', async (raw) => {
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
      });

      if (result.isGameOver) {
        await finalizeGame(gameId, result.fenAfter, 'finished', result.result, result.endReason);
        await deleteLiveState(gameId);
        io.to(gameRoom(gameId)).emit('game:over', {
          gameId,
          result: result.result,
          reason: result.endReason,
        });
      }
    } catch (err) {
      emitError(socket, err instanceof Error ? err.message : 'Move rejected');
    }
  });

  socket.on('game:resign', async (raw) => {
    const parsed = gameIdSchema.safeParse(raw);
    if (!parsed.success) return emitError(socket, 'Invalid payload');
    const { gameId } = parsed.data;

    const state = await getLiveState(gameId);
    if (!state) return emitError(socket, 'Game is not active');

    const winner = state.whiteId === userId ? 'black' : state.blackId === userId ? 'white' : null;
    if (!winner) return emitError(socket, 'You are not a player in this game');

    const finalState = await endGame(gameId, winner, 'resignation');
    await finalizeGame(gameId, finalState.fen, 'finished', winner, 'resignation');
    await deleteLiveState(gameId);

    io.to(gameRoom(gameId)).emit('game:over', { gameId, result: winner, reason: 'resignation' });
  });

  socket.on('game:offer_draw', async (raw) => {
    const parsed = gameIdSchema.safeParse(raw);
    if (!parsed.success) return emitError(socket, 'Invalid payload');
    socket.to(gameRoom(parsed.data.gameId)).emit('game:draw_offered', { by: userId });
  });

  socket.on('game:respond_draw', async (raw) => {
    const schema = gameIdSchema.extend({ accept: z.boolean() });
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return emitError(socket, 'Invalid payload');
    const { gameId, accept } = parsed.data;

    if (!accept) {
      return socket.to(gameRoom(gameId)).emit('game:draw_declined', { by: userId });
    }

    const state = await getLiveState(gameId);
    if (!state) return emitError(socket, 'Game is not active');

    const finalState = await endGame(gameId, 'draw', 'draw_agreement');
    await finalizeGame(gameId, finalState.fen, 'finished', 'draw', 'draw_agreement');
    await deleteLiveState(gameId);

    io.to(gameRoom(gameId)).emit('game:over', { gameId, result: 'draw', reason: 'draw_agreement' });
  });
}
