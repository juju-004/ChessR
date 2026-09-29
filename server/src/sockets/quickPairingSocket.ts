import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type { AuthedSocketData } from './socketAuth.js';
import {
  QUICK_PAIRING_SEGMENTS,
  joinQuickPairingQueue,
  leaveQuickPairingQueue,
  getQuickPairingLobbyCounts,
  runQuickPairingPass,
} from '../services/quickPairing.service.js';

export const QUICK_PAIRING_LOBBY_ROOM = 'quickpairing:lobby';

const joinSchema = z.object({
  segmentId: z.enum(QUICK_PAIRING_SEGMENTS.map((s) => s.id) as [string, ...string[]]),
});

function emitError(socket: Socket, message: string) {
  socket.emit('quickPairing:error', { message });
}

function safeHandler<T>(socket: Socket, fn: (payload: T) => Promise<void>): (payload: T) => void {
  return (payload: T) => {
    fn(payload).catch((err) => {
      console.error('quick pairing socket handler failed:', err);
      emitError(socket, err instanceof Error ? err.message : 'Something went wrong with quick pairing');
    });
  };
}

/** Pushes the current per-lobby queue sizes to everyone with the quick
 *  pairing page open. Cheap (4 ZCARDs, tiny payload), called after
 *  anything that changes a queue: join, leave, a match being made, and
 *  the periodic pass in index.ts. */
export async function broadcastLobbyCounts(io: Server): Promise<void> {
  const counts = await getQuickPairingLobbyCounts();
  io.to(QUICK_PAIRING_LOBBY_ROOM).emit('quickPairing:counts', { counts });
}

export function registerQuickPairingHandlers(io: Server, socket: Socket) {
  const { userId } = socket.data as AuthedSocketData;

  // Opening the page: subscribe to live counts and get the current
  // snapshot immediately (no waiting for the next broadcast).
  socket.on(
    'quickPairing:watch',
    safeHandler(socket, async () => {
      await socket.join(QUICK_PAIRING_LOBBY_ROOM);
      const counts = await getQuickPairingLobbyCounts();
      socket.emit('quickPairing:counts', { counts });
    }),
  );

  socket.on(
    'quickPairing:unwatch',
    safeHandler(socket, async () => {
      await socket.leave(QUICK_PAIRING_LOBBY_ROOM);
    }),
  );

  socket.on(
    'quickPairing:join',
    safeHandler(socket, async (payload: unknown) => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) return emitError(socket, 'Pick a lobby to join');

      const segment = await joinQuickPairingQueue(userId, parsed.data.segmentId);
      // Personal room so every tab of this user shows the searching state.
      io.to(`user:${userId}`).emit('quickPairing:joined', { segmentId: segment.id });
      // Instant-match attempt so a ready opponent doesn't wait for the
      // next interval tick.
      await runQuickPairingPass(segment.id);
      await broadcastLobbyCounts(io);
    }),
  );

  socket.on(
    'quickPairing:leave',
    safeHandler(socket, async () => {
      await leaveQuickPairingQueue(userId);
      io.to(`user:${userId}`).emit('quickPairing:left');
      await broadcastLobbyCounts(io);
    }),
  );
}
