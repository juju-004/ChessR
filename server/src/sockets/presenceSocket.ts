import type { Server, Socket } from 'socket.io';
import { User } from '../models/User.js';
import { registerSocket, unregisterSocket, unwatchTournament } from '../services/presence.service.js';
import { retryArenaPairingsForUser } from '../services/tournament.service.js';
import type { AuthedSocketData } from './socketAuth.js';

export function registerPresenceHandlers(io: Server, socket: Socket) {
  const { userId } = socket.data as AuthedSocketData;

  // Fire-and-forget setup; failures here shouldn't block the connection, but
  // they shouldn't vanish silently either (an unhandled rejection here once
  // made a Redis hiccup look like "presence is just broken" with no trace).
  void (async () => {
    await registerSocket(userId, socket.id);
    // A personal room lets other parts of the app (friend requests, challenges)
    // reach every tab/device a user has open without tracking raw socket ids.
    await socket.join(`user:${userId}`);
    await notifyFriends(io, userId, 'friend:presence', { userId, online: true });
    // Smart pairing (see arenaAvailablePlayers) skips offline players
    // entirely rather than pairing them against someone who isn't there, 
    // this is what picks them back up the instant they're actually back,
    // instead of leaving them waiting for an unrelated game elsewhere to
    // finish first.
    await retryArenaPairingsForUser(userId);
  })().catch((err) => console.error('presence registration failed:', err));

  socket.on('disconnect', () => {
    void (async () => {
      const { wasLast } = await unregisterSocket(socket.id);
      // A closed tab / dropped connection never gets to send the client's
      // normal tournament:unwatch, clean up here instead so this socket
      // doesn't linger as a phantom "watcher" of whatever tournament page
      // it last had open (see unwatchTournament's own doc comment).
      await unwatchTournament(socket.id);
      if (wasLast) {
        await notifyFriends(io, userId, 'friend:presence', { userId, online: false });
      }
    })().catch((err) => console.error('presence teardown failed:', err));
  });
}

async function notifyFriends(io: Server, userId: string, event: string, payload: unknown) {
  const user = await User.findById(userId).select('friends').lean();
  if (!user) return;
  for (const friendId of user.friends) {
    io.to(`user:${friendId.toString()}`).emit(event, payload);
  }
}
