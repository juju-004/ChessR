import type { Server, Socket } from 'socket.io';
import { stopLatencyHeartbeat, recordLatencySample } from '../services/latency.service.js';

/**
 * Server-initiated latency probe, distinct from pingSocket.ts's `ping:check`
 * (which is client-initiated and purely for the navbar's connection
 * indicator, with no server-side memory of the result). This one exists so
 * the server has its own trustworthy measurement to use for move-clock lag
 * compensation, see latency.service.ts and finalizeMove in
 * gameState.service.ts for why that matters, especially for premoves.
 *
 * The heartbeat is NOT started on connect any more (that was a timer plus a
 * ping and a pong every 2s for every connected socket, in a game or not).
 * gameSocket.ts starts it when a player joins a live game and stops it when
 * they leave or the game ends, see retainLatencyHeartbeat. This file only
 * handles the pong replies and the disconnect cleanup.
 */
export function registerLatencyHandlers(_io: Server, socket: Socket) {
  socket.on('latency:pong', (serverSentAt: number) => {
    if (typeof serverSentAt !== 'number') return;
    recordLatencySample(socket.id, Date.now() - serverSentAt);
  });

  socket.on('disconnect', () => {
    stopLatencyHeartbeat(socket.id);
  });
}
