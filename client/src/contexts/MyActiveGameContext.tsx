import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext.js";
import { useSocket } from "./SocketContext.js";
import { useNotify } from "./NotificationContext.js";
import { listMyActiveGames } from "../api/games.js";

/** Don't re-check the server more than once per this window, connect,
 *  online and tab-visible tend to all fire together when a phone wakes up. */
const RESYNC_MIN_GAP_MS = 2000;

interface MyActiveGameContextValue {
  /** Join code of the user's one active/waiting game, or null if they
   *  don't have one right now. */
  joinCode: string | null;
  setActiveGame: (joinCode: string) => void;
  /** Only clears if `joinCode` matches what's currently stored, so a
   *  stale "this game just ended" signal (e.g. arriving after the user
   *  has already started a new game some other way) can't clobber a
   *  newer, still-current game. */
  clearActiveGame: (joinCode: string) => void;
}

const MyActiveGameContext = createContext<MyActiveGameContextValue | null>(null);

export function MyActiveGameProvider({ children }: { children: ReactNode }) {
  const { isAuthed } = useAuth();
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const joinCodeRef = useRef(joinCode);
  joinCodeRef.current = joinCode;

  const socket = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const { notify } = useNotify();
  // Held in refs so syncFromServer keeps a stable identity: notify /
  // navigate can change between renders, and a changing identity would
  // re-run the seed effect below and refetch on every one of those.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Bumped by every set/clear. A server fetch that started before one of
  // those and lands after it is stale (the event is newer than the fetch),
  // so it's dropped instead of overwriting the fresher answer.
  const versionRef = useRef(0);
  const seededRef = useRef(false);
  const lastSyncAtRef = useRef(0);

  // The server is the source of truth for "do I have a game right now".
  // Socket events (tournament:pairing_ready, challenge:accepted, ...) are
  // just the fast path: if the connection drops at the wrong moment the
  // event is simply never delivered, and nothing else would ever tell this
  // client about the game, the icon stayed missing until a manual refresh.
  // So on every sign the connection is back (socket reconnect, browser
  // back online, tab visible again) this re-asks the server.
  //
  // `announce` is for those re-checks (not the first load): if a game shows
  // up that we didn't know about, the person missed the event that would
  // normally have pulled them in, so surface the same "play it now" toast
  // instead of only quietly lighting up the icon.
  const syncFromServer = useCallback(
    (announce: boolean) => {
      const startedAtVersion = versionRef.current;
      return listMyActiveGames()
        .then(({ games }) => {
          if (versionRef.current !== startedAtVersion) return;
          const next = games[0]?.joinCode ?? null;
          const prev = joinCodeRef.current;
          if (next === prev) return;
          setJoinCode(next);
          if (announce && next && pathRef.current !== `/game/${next}`) {
            notifyRef.current(
              "Your game is ready.",
              [{ label: "Play it now", onClick: () => navigateRef.current(`/game/${next}`) }],
              20_000,
            );
          }
        })
        .catch(() => {
          /* Not critical, the next reconnect / focus tries again. */
        });
    },
    [],
  );

  useEffect(() => {
    if (!isAuthed) {
      seededRef.current = false;
      setJoinCode(null);
      return;
    }
    syncFromServer(false).finally(() => {
      seededRef.current = true;
    });
  }, [isAuthed, syncFromServer]);

  useEffect(() => {
    if (!isAuthed) return;

    function resync() {
      // The first load is handled by the seed above.
      if (!seededRef.current) return;
      const now = Date.now();
      if (now - lastSyncAtRef.current < RESYNC_MIN_GAP_MS) return;
      lastSyncAtRef.current = now;
      syncFromServer(true);
    }
    function onVisible() {
      if (document.visibilityState === "visible") resync();
    }

    socket?.on("connect", resync);
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      socket?.off("connect", resync);
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isAuthed, socket, syncFromServer]);

  const setActiveGame = useCallback((code: string) => {
    versionRef.current++;
    setJoinCode(code);
  }, []);
  const clearActiveGame = useCallback((code: string) => {
    if (joinCodeRef.current === code) {
      versionRef.current++;
      setJoinCode(null);
    }
  }, []);

  return (
    <MyActiveGameContext.Provider value={{ joinCode, setActiveGame, clearActiveGame }}>
      {children}
    </MyActiveGameContext.Provider>
  );
}

export function useMyActiveGame(): MyActiveGameContextValue {
  const ctx = useContext(MyActiveGameContext);
  if (!ctx) throw new Error("useMyActiveGame must be used within MyActiveGameProvider");
  return ctx;
}
