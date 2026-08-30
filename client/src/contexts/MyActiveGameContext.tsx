import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext.js";
import { listMyActiveGames } from "../api/games.js";

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

  // Seeds from the server once on login/refresh, covers a page reload (or
  // opening the app fresh) landing anywhere other than the game page
  // itself, where GameSocket's game:join wouldn't otherwise get a chance
  // to report the game back up. Everything after this point (a new game
  // starting, the current one ending) updates via setActiveGame /
  // clearActiveGame instead, called from GlobalListeners (challenge/cage/
  // rematch/tournament pairing acceptance) and Game.tsx (the source of
  // truth once the user is actually on a game page, including both
  // picking up a game this fetch might have missed and noticing when it
  // ends).
  useEffect(() => {
    if (!isAuthed) {
      setJoinCode(null);
      return;
    }
    listMyActiveGames()
      .then(({ games }) => setJoinCode(games[0]?.joinCode ?? null))
      .catch(() => {
        /* Not critical, worst case the return-to-game icon just doesn't
           show up until the user's next game-starting action sets it. */
      });
  }, [isAuthed]);

  const setActiveGame = useCallback((code: string) => setJoinCode(code), []);
  const clearActiveGame = useCallback((code: string) => {
    if (joinCodeRef.current === code) setJoinCode(null);
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
