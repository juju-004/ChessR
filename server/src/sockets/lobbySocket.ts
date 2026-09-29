import type { Server, Socket } from 'socket.io';
import { LOBBY_ROOM } from '../services/game.service.js';

/** The open-games lobby page subscribes here to hear when the list changes
 *  (see broadcastLobbyChanged in game.service.ts). The event carries no
 *  data, the client just refetches GET /games/open. */
export function registerLobbyHandlers(_io: Server, socket: Socket) {
  socket.on('lobby:watch', () => {
    void socket.join(LOBBY_ROOM);
  });
  socket.on('lobby:unwatch', () => {
    void socket.leave(LOBBY_ROOM);
  });
}
