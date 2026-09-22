import type { Server, Socket } from 'socket.io';
import { startLatencyHeartbeat, stopLatencyHeartbeat, recordLatencySample } from '../services/latency.service.js';

/**
 * Server-initiated latency probe, distinct from pingSocket.ts's `ping:check`
 * (which is client-initiated and purely for the navbar's connection
 * indicator, with no server-side memory of the result). This one exists so
 * the server has its own trustworthy measurement to use for move-clock lag
 * compensation — see latency.service.ts and finalizeMove in
 * gameState.service.ts for why that matters, especially for premoves.
 */
export function registerLatencyHandlers(_io: Server, socket: Socket) {
  startLatencyHeartbeat(() => socket.emit('latency:ping', Date.now()), socket.id);

  socket.on('latency:pong', (serverSentAt: number) => {
    if (typeof serverSentAt !== 'number') return;
    recordLatencySample(socket.id, Date.now() - serverSentAt);
  });

  socket.on('disconnect', () => {
    stopLatencyHeartbeat(socket.id);
  });
}
