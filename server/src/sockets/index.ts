import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env.js';
import { pubClient, subClient } from '../config/redis.js';
import { socketAuthMiddleware } from './socketAuth.js';
import { registerPresenceHandlers } from './presenceSocket.js';
import { registerGameHandlers, registerClockTimeoutHandler } from './gameSocket.js';
import { registerChallengeHandlers } from './challengeSocket.js';
import { registerCageMatchHandlers } from './cageMatchSocket.js';
import { registerTournamentHandlers } from './tournamentSocket.js';
import { registerPingHandlers } from './pingSocket.js';
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
  });

  // Lets Socket.IO fan events out across multiple Node processes/instances,
  // which is required once you run more than one server behind a load balancer.
  io.adapter(createAdapter(pubClient, subClient));

  io.use(socketAuthMiddleware);

  registerClockTimeoutHandler(io);

  io.on('connection', (socket) => {
    registerPresenceHandlers(io, socket);
    registerGameHandlers(io, socket);
    registerChallengeHandlers(io, socket);
    registerCageMatchHandlers(io, socket);
    registerTournamentHandlers(io, socket);
    registerPingHandlers(io, socket);
  });

  setIo(io);
  return io;
}
