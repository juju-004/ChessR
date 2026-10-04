// Several socket events are surfaced twice: once app-wide by GlobalListeners
// (a toast) and once by the page that triggered the action (an inline status
// message, or its own toast), so the user saw the same rejection two times.
//
// A page that shows its own message for an event "claims" it while mounted,
// and GlobalListeners skips its toast for any claimed event. Claims are
// counted, so two mounted pages can't release each other's.
const claims = new Map<string, number>();

/** Call from an effect; call the returned function in its cleanup. */
export function claimToast(event: string): () => void {
  claims.set(event, (claims.get(event) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (claims.get(event) ?? 1) - 1;
    if (next <= 0) claims.delete(event);
    else claims.set(event, next);
  };
}

export function isToastClaimed(event: string): boolean {
  return (claims.get(event) ?? 0) > 0;
}
