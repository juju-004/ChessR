import { io, type Socket } from 'socket.io-client';
import { authState } from './state.js';

let socket: Socket | null = null;

export function connectSocket(): Socket {
  // Return the existing socket whether or not it has *finished* connecting yet —
  // socket.io-client queues emits and reconnects automatically. Recreating the
  // socket here on every call (the previous bug) meant that any two calls made
  // before the first handshake completed produced two live sockets, and event
  // listeners attached via the second call would land on a different object than
  // the one other pages later got back — so some listeners silently never fired.
  if (socket) return socket;

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
