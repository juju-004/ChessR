import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from './AuthContext.js';
import { getAuthSnapshot } from '../api/authStore.js';
import { tryRestoreSession } from '../api/auth.js';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { isAuthed, accessToken } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!isAuthed) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
      return;
    }
    if (socketRef.current) return; // already connected for this session

    // Same story as API_BASE in api/http.ts: '/' only reaches the backend
    // locally because of the Vite dev proxy. In production there's no proxy,
    // so this needs the real backend URL, set VITE_SOCKET_URL.
    const s = io(import.meta.env.VITE_SOCKET_URL ?? '/', {
      auth: { token: accessToken },
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    s.on('connect_error', async (err: Error) => {
      // Access token likely expired between page load and socket connect, refresh once and retry.
      if (err.message === 'AUTH_INVALID' || err.message === 'AUTH_REQUIRED') {
        const ok = await tryRestoreSession();
        if (ok) {
          s.auth = { token: getAuthSnapshot().accessToken };
          s.connect();
        }
      }
    });

    // Echoes straight back whatever timestamp the server sent, this is
    // what feeds the server's own move-clock lag compensation estimate (see
    // latencySocket.ts / latency.service.ts server-side). Deliberately just
    // a bounce-back with no client-side timing logic of its own, so there's
    // nothing here for a client to fudge in its own favor.
    s.on('latency:ping', (serverSentAt: number) => {
      s.emit('latency:pong', serverSentAt);
    });

    socketRef.current = s;
    setSocket(s);
    // Deliberately not disconnecting in a cleanup here, the `!isAuthed` branch
    // above is what tears the socket down (on logout), not effect re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

/** Returns the current socket, or null while it's still connecting / user is signed out. */
export function useSocket(): Socket | null {
  return useContext(SocketContext);
}
