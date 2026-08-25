import type { Server, Socket } from 'socket.io';

/**
 * Bare round-trip-time probe for the navbar's connection indicator. Deliberately
 * the simplest thing that works: the client sends its own timestamp and gets
 * it straight back (plus the server's own clock, in case it's ever useful for
 * skew debugging) via a socket.io ack callback, no server-side state, no
 * broadcast, just a request/response the client times locally.
 */
export function registerPingHandlers(_io: Server, socket: Socket) {
  socket.on('ping:check', (clientSentAt: number, ack?: (payload: { clientSentAt: number; serverTime: number }) => void) => {
    if (typeof ack === 'function') {
      ack({ clientSentAt, serverTime: Date.now() });
    }
  });
}
