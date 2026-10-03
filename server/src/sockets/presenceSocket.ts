import type { Server, Socket } from 'socket.io';
import { User } from '../models/User.js';
import { registerSocket, unregisterSocket, unwatchTournament } from '../services/presence.service.js';
import { retryArenaPairingsForUser } from '../services/tournament.service.js';
import { broadcastWatchers } from './tournamentSocket.js';
import { broadcastLobbyCounts } from './quickPairingSocket.js';
import { leaveQuickPairingQueue } from '../services/quickPairing.service.js';
import type { AuthedSocketData } from './socketAuth.js';

export function registerPresenceHandlers(io: Server, socket: Socket) {
  const { userId } = socket.data as AuthedSocketData;

  // Fire-and-forget setup; failures here shouldn't block the connection, but
  // they shouldn't vanish silently either (an unhandled rejection here once
  // made a Redis hiccup look like "presence is just broken" with no trace).
  void (async () => {
    const cameOnline = await registerSocket(userId, socket.id);
    // A personal room lets other parts of the app (friend requests, challenges)
    // reach every tab/device a user has open without tracking raw socket ids.
    await socket.join(`user:${userId}`);
    // Only the first socket is news to friends. Extra tabs/devices used to
    // each cost a friends lookup plus one emit per friend for nothing.
    if (cameOnline) await notifyFriends(io, userId, 'friend:presence', { userId, online: true });
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
      const unwatchedTournamentId = await unwatchTournament(socket.id);
      if (unwatchedTournamentId) {
        await broadcastWatchers(io, unwatchedTournamentId);
      }
      if (wasLast) {
        // Nobody's left to be matched: drop them from any quick-pairing lobby
        // so they can't be paired into a game they'll never see.
        const left = await leaveQuickPairingQueue(userId);
        if (left) await broadcastLobbyCounts(io);
        await notifyFriends(io, userId, 'friend:presence', { userId, online: false });
      }
    })().catch((err) => console.error('presence teardown failed:', err));
  });
}

async function notifyFriends(io: Server, userId: string, event: string, payload: unknown) {
  const user = await User.findById(userId).select('friends').lean();
  if (!user) return;
  if (user.friends.length === 0) return;
  // One emit addressed to every friend's room: a single adapter publish
  // instead of one per friend.
  io.to(user.friends.map((friendId) => `user:${friendId.toString()}`)).emit(event, payload);
}
