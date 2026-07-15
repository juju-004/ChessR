import { io, type Socket } from 'socket.io-client';
import { authState } from './state.js';

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (socket?.connected) return socket;

  socket = io('/', {
    auth: { token: authState.accessToken },
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });

  socket.on('connect_error', async (err) => {
    // Access token likely expired between page load and socket connect — refresh and retry once.
    if (err.message === 'AUTH_INVALID' || err.message === 'AUTH_REQUIRED') {
      const { tryRestoreSession } = await import('./api/auth.js');
      const ok = await tryRestoreSession();
      if (ok && socket) {
        socket.auth = { token: authState.accessToken };
        socket.connect();
      }
    }
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
