import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env.js';
import { pubClient, subClient } from '../config/redis.js';
import { socketAuthMiddleware } from './socketAuth.js';
import { registerPresenceHandlers } from './presenceSocket.js';
import { registerGameHandlers, registerClockTimeoutHandler, registerFirstMoveTimeoutHandler } from './gameSocket.js';
import { registerChallengeHandlers } from './challengeSocket.js';
import { registerCageMatchHandlers } from './cageMatchSocket.js';
import { registerTournamentHandlers } from './tournamentSocket.js';
import { registerPingHandlers } from './pingSocket.js';
import { registerLatencyHandlers } from './latencySocket.js';
import { setIo } from './io.js';

export function initSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    },
    // Reasonable defaults for production; tune based on observed traffic.
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e5, // 100KB — this app never needs large payloads
    // engine.io defaults this to enabled, which negotiates permessage-deflate
    // on every websocket connection and then runs zlib compress/decompress
    // on every single frame. That trade only pays off for large, repetitive
    // payloads — every message this server sends (a move, a clock tick, a
    // ping) is a tiny, already-compact JSON object well under 1KB, so the
    // per-message CPU cost of compressing/decompressing is pure added
    // latency on the hottest path in the app (game:move) with no bandwidth
    // win to show for it. Off entirely, every server instance.
    perMessageDeflate: false,
  });

  // Lets Socket.IO fan events out across multiple Node processes/instances,
  // which is required once you run more than one server behind a load balancer.
  io.adapter(createAdapter(pubClient, subClient));

  io.use(socketAuthMiddleware);

  registerClockTimeoutHandler(io);
  registerFirstMoveTimeoutHandler(io);

  io.on('connection', (socket) => {
    registerPresenceHandlers(io, socket);
    registerGameHandlers(io, socket);
    registerChallengeHandlers(io, socket);
    registerCageMatchHandlers(io, socket);
    registerTournamentHandlers(io, socket);
    registerPingHandlers(io, socket);
    registerLatencyHandlers(io, socket);
  });

  setIo(io);
  return io;
}
