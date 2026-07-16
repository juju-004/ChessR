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

    const s = io('/', {
      auth: { token: accessToken },
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    s.on('connect_error', async (err: Error) => {
      // Access token likely expired between page load and socket connect — refresh once and retry.
      if (err.message === 'AUTH_INVALID' || err.message === 'AUTH_REQUIRED') {
        const ok = await tryRestoreSession();
        if (ok) {
          s.auth = { token: getAuthSnapshot().accessToken };
          s.connect();
        }
      }
    });

    socketRef.current = s;
    setSocket(s);
    // Deliberately not disconnecting in a cleanup here — the `!isAuthed` branch
    // above is what tears the socket down (on logout), not effect re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

/** Returns the current socket, or null while it's still connecting / user is signed out. */
export function useSocket(): Socket | null {
  return useContext(SocketContext);
}
