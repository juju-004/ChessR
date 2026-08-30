import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useMyActiveGame } from "../contexts/MyActiveGameContext.js";

/**
 * Returns a ref, not a boolean, deliberately: this is meant to be read
 * inside a socket event handler (e.g. challenge:received), and putting
 * the boolean itself in a dependency array would tear down and
 * re-subscribe that socket listener on every navigation. Read
 * `ref.current` at the moment the event actually arrives instead.
 */
export function useOnOwnGamePageRef() {
  const location = useLocation();
  const { joinCode } = useMyActiveGame();
  const ref = useRef(false);
  useEffect(() => {
    ref.current = !!joinCode && location.pathname === `/game/${joinCode}`;
  }, [location.pathname, joinCode]);
  return ref;
}
