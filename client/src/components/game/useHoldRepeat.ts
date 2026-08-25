import { useCallback, useEffect, useRef } from "react";

/** Press-and-hold auto-repeat for the prev/next move buttons, a single
 *  tap fires `callback` once via onClick as normal; holding past an
 *  initial pause starts firing it again on a timer that shortens each
 *  rep (380ms → floor of 60ms), i.e. it accelerates the longer it's held,
 *  the same feel as a held arrow key. A ref carries the latest `callback`
 *  into the running timer so it keeps calling the freshest version even
 *  though `callback` (handlePrevMove/handleNextMove) closes over state
 *  that changes on every single rep. */
export function useHoldRepeat(callback: () => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const timeoutRef = useRef<number | null>(null);
  const heldRef = useRef(false);

  const stop = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    heldRef.current = false;
    let delay = 380;
    const tick = () => {
      heldRef.current = true;
      callbackRef.current();
      delay = Math.max(60, delay * 0.78);
      timeoutRef.current = window.setTimeout(tick, delay);
    };
    timeoutRef.current = window.setTimeout(tick, delay);
  }, []);

  useEffect(() => stop, [stop]);

  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: () => {
      // A plain tap/click fires this before the 380ms repeat threshold, so
      // heldRef is still false, handle it as a single, normal move. If we
      // *did* end up repeating, the button's already been driven forward
      // by the timer, so the click that follows release would otherwise
      // double up as one extra, unwanted step.
      if (heldRef.current) {
        heldRef.current = false;
        return;
      }
      callbackRef.current();
    },
  };
}
