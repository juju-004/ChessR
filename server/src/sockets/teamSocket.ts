import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Team } from '../models/Team.js';
import { addChatMessage, getChatHistory, isChatRateLimited, isRepeatMessage } from '../services/chat.service.js';
import { assertNotRestricted } from '../services/suspension.service.js';
import { teamRoom } from '../services/team.service.js';
import type { AuthedSocketData } from './socketAuth.js';

const idSchema = z.object({ teamId: z.string().refine(mongoose.isValidObjectId) });
const chatSchema = idSchema.extend({
  message: z.string().trim().min(1).max(300),
  replyToId: z.string().max(32).optional(),
});

function emitError(socket: Socket, message: string) {
  socket.emit('team:error', { message });
}

function safeHandler<T>(socket: Socket, fn: (payload: T) => Promise<void>): (payload: T) => void {
  return (payload: T) => {
    fn(payload).catch((err) => {
      console.error('team socket handler failed:', err);
      emitError(socket, err instanceof Error ? err.message : 'Something went wrong with team chat');
    });
  };
}

const isMember = async (teamId: string, userId: string) =>
  !!(await Team.exists({ _id: teamId, 'members.user': userId }));

/** Team chat room. Membership is checked on watch AND on every send, so a
 *  removed member can't keep posting even if their socket outlived the
 *  removal (team.service's removeUserFromTeamRoom also drops them from the
 *  room right away). */
export function registerTeamHandlers(io: Server, socket: Socket) {
  const { userId } = socket.data as AuthedSocketData;

  socket.on(
    'team:watch',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = idSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const { teamId } = parsed.data;
      if (!(await isMember(teamId, userId))) return emitError(socket, 'Only team members can open team chat');
      await socket.join(teamRoom(teamId));
      socket.emit('team:chat_history', { teamId, history: await getChatHistory('team', teamId) });
    }),
  );

  socket.on(
    'team:unwatch',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = idSchema.safeParse(raw);
      if (!parsed.success) return;
      await socket.leave(teamRoom(parsed.data.teamId));
    }),
  );

  socket.on(
    'team:chat_send',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = chatSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid chat payload');
      const { teamId, message, replyToId } = parsed.data;

      if (!socket.rooms.has(teamRoom(teamId)) || !(await isMember(teamId, userId))) {
        return emitError(socket, 'Only team members can chat here');
      }

      try {
        await assertNotRestricted(userId);
      } catch (err) {
        return emitError(socket, err instanceof Error ? err.message : 'Chat is currently restricted for your account');
      }
      if (await isChatRateLimited(userId)) {
        return emitError(socket, "You're sending messages too fast, slow down a little");
      }
      if (await isRepeatMessage(userId, message)) {
        return emitError(socket, 'You already sent that, try saying something new');
      }

      let replyTo: { id: string; username: string; message: string } | null = null;
      if (replyToId) {
        const original = (await getChatHistory('team', teamId)).find((m) => m.id === replyToId);
        if (original) replyTo = { id: original.id, username: original.username, message: original.message };
      }

      const me = await User.findById(userId).select('username avatarGradient').lean();
      if (!me) return emitError(socket, 'User not found');

      const saved = await addChatMessage('team', teamId, {
        username: me.username,
        avatarGradient: me.avatarGradient ?? null,
        message,
        replyTo,
      });
      io.to(teamRoom(teamId)).emit('team:chat_message', { teamId, ...saved });
    }),
  );
}
