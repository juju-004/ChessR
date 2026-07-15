import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import mongoose from 'mongoose';
import { nanoid } from 'nanoid';
import { redis } from '../config/redis.js';
import { User } from '../models/User.js';
import { createDirectGame } from '../services/game.service.js';
import { isUserOnline } from '../services/presence.service.js';
import type { AuthedSocketData } from './socketAuth.js';

const CHALLENGE_TTL_SECONDS = 60;
const challengeKey = (id: string) => `challenge:${id}`;

const sendSchema = z.object({ toUserId: z.string().refine(mongoose.isValidObjectId) });
const respondSchema = z.object({ challengeId: z.string(), accept: z.boolean() });

function emitError(socket: Socket, message: string) {
  socket.emit('challenge:error', { message });
}

export function registerChallengeHandlers(io: Server, socket: Socket) {
  const { userId, username } = socket.data as AuthedSocketData;

  socket.on('challenge:send', async (raw) => {
    const parsed = sendSchema.safeParse(raw);
    if (!parsed.success) return emitError(socket, 'Invalid challenge payload');
    const { toUserId } = parsed.data;

    if (toUserId === userId) return emitError(socket, "You can't challenge yourself");

    const me = await User.findById(userId).select('friends').lean();
    const isFriend = me?.friends.some((f) => f.toString() === toUserId);
    if (!isFriend) return emitError(socket, 'You can only challenge friends');

    const online = await isUserOnline(toUserId);
    if (!online) return emitError(socket, 'That friend is currently offline');

    const challengeId = nanoid();
    await redis.set(
      challengeKey(challengeId),
      JSON.stringify({ fromId: userId, toId: toUserId }),
      'EX',
      CHALLENGE_TTL_SECONDS,
    );

    io.to(`user:${toUserId}`).emit('challenge:received', {
      challengeId,
      from: { id: userId, username },
      expiresInSeconds: CHALLENGE_TTL_SECONDS,
    });

    socket.emit('challenge:sent', { challengeId, toUserId });
  });

  socket.on('challenge:respond', async (raw) => {
    const parsed = respondSchema.safeParse(raw);
    if (!parsed.success) return emitError(socket, 'Invalid response payload');
    const { challengeId, accept } = parsed.data;

    const raw2 = await redis.get(challengeKey(challengeId));
    if (!raw2) return emitError(socket, 'This challenge has expired');

    const { fromId, toId } = JSON.parse(raw2) as { fromId: string; toId: string };
    if (toId !== userId) return emitError(socket, 'This challenge is not addressed to you');

    await redis.del(challengeKey(challengeId));

    if (!accept) {
      io.to(`user:${fromId}`).emit('challenge:declined', { challengeId, by: userId });
      return;
    }

    // Randomize colors for fairness.
    const [whiteId, blackId] = Math.random() < 0.5 ? [fromId, toId] : [toId, fromId];
    const game = await createDirectGame(whiteId, blackId, challengeId);

    const payload = { challengeId, gameId: game.id, white: whiteId, black: blackId };
    io.to(`user:${fromId}`).emit('challenge:accepted', payload);
    io.to(`user:${toId}`).emit('challenge:accepted', payload);
  });

  socket.on('challenge:cancel', async (raw) => {
    const schema = z.object({ challengeId: z.string() });
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return;
    const raw2 = await redis.get(challengeKey(parsed.data.challengeId));
    if (!raw2) return;
    const { fromId, toId } = JSON.parse(raw2) as { fromId: string; toId: string };
    if (fromId !== userId) return;
    await redis.del(challengeKey(parsed.data.challengeId));
    io.to(`user:${toId}`).emit('challenge:cancelled', { challengeId: parsed.data.challengeId });
  });
}
