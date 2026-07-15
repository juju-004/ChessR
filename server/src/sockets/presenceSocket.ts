import type { Server, Socket } from 'socket.io';
import { User } from '../models/User.js';
import { registerSocket, unregisterSocket } from '../services/presence.service.js';
import type { AuthedSocketData } from './socketAuth.js';

export function registerPresenceHandlers(io: Server, socket: Socket) {
  const { userId } = socket.data as AuthedSocketData;

  // Fire-and-forget setup; failures here shouldn't block the connection.
  void (async () => {
    await registerSocket(userId, socket.id);
    // A personal room lets other parts of the app (friend requests, challenges)
    // reach every tab/device a user has open without tracking raw socket ids.
    await socket.join(`user:${userId}`);
    await notifyFriends(io, userId, 'friend:presence', { userId, online: true });
  })();

  socket.on('disconnect', () => {
    void (async () => {
      const { wasLast } = await unregisterSocket(socket.id);
      if (wasLast) {
        await notifyFriends(io, userId, 'friend:presence', { userId, online: false });
      }
    })();
  });
}

async function notifyFriends(io: Server, userId: string, event: string, payload: unknown) {
  const user = await User.findById(userId).select('friends').lean();
  if (!user) return;
  for (const friendId of user.friends) {
    io.to(`user:${friendId.toString()}`).emit(event, payload);
  }
}
