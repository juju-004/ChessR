import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from './AuthContext.js';
import { getAuthSnapshot } from '../api/authStore.js';
import { tryRestoreSession } from '../api/auth.js';

const SocketContext = createContext<Socket | null>(null);

/** 'reconnecting' = the socket had been connected and dropped (a first
 *  connect that is still in flight is just 'connecting'). Kept in its own
 *  context so a status flip doesn't re-render everything that only needs the
 *  socket itself. */
export type SocketStatus = 'connecting' | 'connected' | 'reconnecting';
const SocketStatusContext = createContext<SocketStatus>('connecting');

export function SocketProvider({ children }: { children: ReactNode }) {
  const { isAuthed, accessToken } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const everConnectedRef = useRef(false);

  useEffect(() => {
    if (!isAuthed) {
      (socketRef.current as (Socket & { __cleanup?: () => void }) | null)?.__cleanup?.();
      socketRef.current?.disconnect();
      socketRef.current = null;
      everConnectedRef.current = false;
      setSocket(null);
      setStatus('connecting');
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

    s.on('connect', () => {
      everConnectedRef.current = true;
      setStatus('connected');
    });
    s.on('disconnect', (reason: string) => {
      setStatus('reconnecting');
      // socket.io only retries on its own for transport drops. When the
      // server closed the connection on purpose it never does, so retry here.
      if (reason === 'io server disconnect') s.connect();
    });
    s.on('connect_error', () => {
      setStatus(everConnectedRef.current ? 'reconnecting' : 'connecting');
    });

    // Phones freeze background sockets. Don't wait out the backoff timer when
    // the tab comes back or the network returns: try straight away.
    const retryNow = () => {
      if (!s.connected && document.visibilityState !== 'hidden') s.connect();
    };
    window.addEventListener('online', retryNow);
    document.addEventListener('visibilitychange', retryNow);
    (s as Socket & { __cleanup?: () => void }).__cleanup = () => {
      window.removeEventListener('online', retryNow);
      document.removeEventListener('visibilitychange', retryNow);
    };

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

  return (
    <SocketContext.Provider value={socket}>
      <SocketStatusContext.Provider value={status}>{children}</SocketStatusContext.Provider>
    </SocketContext.Provider>
  );
}

/** Connection state, for UI that should react to a dropped connection. */
export function useSocketStatus(): SocketStatus {
  return useContext(SocketStatusContext);
}

/** Returns the current socket, or null while it's still connecting / user is signed out. */
export function useSocket(): Socket | null {
  return useContext(SocketContext);
}
