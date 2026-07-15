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

const sendSchema = z.object({
  toUserId: z.string().refine(mongoose.isValidObjectId),
  baseMinutes: z.number().min(1).max(180).nullable().optional().default(10),
  incrementSeconds: z.number().min(0).max(60).optional().default(0),
});
const respondSchema = z.object({ challengeId: z.string(), accept: z.boolean() });

function emitError(socket: Socket, message: string) {
  socket.emit('challenge:error', { message });
}

// Every handler is wrapped so an unexpected failure (e.g. a transient Redis or
// Mongo hiccup) always reaches the client as `challenge:error` instead of
// disappearing as a silent, unhandled promise rejection.
function safeHandler<T>(
  socket: Socket,
  fn: (payload: T) => Promise<void>,
): (payload: T) => void {
  return (payload: T) => {
    fn(payload).catch((err) => {
      console.error('challenge socket handler failed:', err);
      emitError(socket, 'Something went wrong processing that challenge. Please try again.');
    });
  };
}

export function registerChallengeHandlers(io: Server, socket: Socket) {
  const { userId, username } = socket.data as AuthedSocketData;

  socket.on(
    'challenge:send',
    safeHandler(socket, async (raw) => {
      const parsed = sendSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid challenge payload');
      const { toUserId, baseMinutes, incrementSeconds } = parsed.data;

      if (toUserId === userId) return emitError(socket, "You can't challenge yourself");

      const me = await User.findById(userId).select('friends').lean();
      const isFriend = me?.friends.some((f) => f.toString() === toUserId);
      if (!isFriend) return emitError(socket, 'You can only challenge friends');

      const online = await isUserOnline(toUserId);
      if (!online) return emitError(socket, 'That friend is currently offline');

      const challengeId = nanoid();
      await redis.set(
        challengeKey(challengeId),
        JSON.stringify({ fromId: userId, toId: toUserId, baseMinutes, incrementSeconds }),
        'EX',
        CHALLENGE_TTL_SECONDS,
      );

      io.to(`user:${toUserId}`).emit('challenge:received', {
        challengeId,
        from: { id: userId, username },
        timeControl: { baseMinutes, incrementSeconds },
        expiresInSeconds: CHALLENGE_TTL_SECONDS,
      });

      socket.emit('challenge:sent', { challengeId, toUserId });
    }),
  );

  socket.on(
    'challenge:respond',
    safeHandler(socket, async (raw) => {
      const parsed = respondSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid response payload');
      const { challengeId, accept } = parsed.data;

      const stored = await redis.get(challengeKey(challengeId));
      if (!stored) return emitError(socket, 'This challenge has expired');

      const { fromId, toId, baseMinutes, incrementSeconds } = JSON.parse(stored) as {
        fromId: string;
        toId: string;
        baseMinutes: number | null;
        incrementSeconds: number;
      };
      if (toId !== userId) return emitError(socket, 'This challenge is not addressed to you');

      await redis.del(challengeKey(challengeId));

      if (!accept) {
        io.to(`user:${fromId}`).emit('challenge:declined', { challengeId, by: userId });
        return;
      }

      const [whiteId, blackId] = Math.random() < 0.5 ? [fromId, toId] : [toId, fromId];
      const game = await createDirectGame(
        whiteId,
        blackId,
        { baseMinutes, incrementSeconds },
        challengeId,
      );

      const payload = {
        challengeId,
        gameId: game.id,
        joinCode: game.joinCode,
        white: whiteId,
        black: blackId,
      };
      io.to(`user:${fromId}`).emit('challenge:accepted', payload);
      io.to(`user:${toId}`).emit('challenge:accepted', payload);
    }),
  );

  socket.on(
    'challenge:cancel',
    safeHandler(socket, async (raw) => {
      const schema = z.object({ challengeId: z.string() });
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return;
      const stored = await redis.get(challengeKey(parsed.data.challengeId));
      if (!stored) return;
      const { fromId, toId } = JSON.parse(stored) as { fromId: string; toId: string };
      if (fromId !== userId) return;
      await redis.del(challengeKey(parsed.data.challengeId));
      io.to(`user:${toId}`).emit('challenge:cancelled', { challengeId: parsed.data.challengeId });
    }),
  );
}
