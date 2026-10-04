import type { Socket } from 'socket.io';

// Only moves and chat were rate limited, so any client could hammer game:join,
// tournament:watch, challenge or lobby events, each of which does Mongo and/or
// Redis work, as fast as it could write to the socket. This is one cheap,
// in-process cap on every incoming event of a socket. Limits are generous
// (a normal page load sends a dozen events at once) and only a client that
// keeps going gets cut off.
const WINDOW_MS = 5_000;
const MAX_EVENTS_PER_WINDOW = 60;
const DISCONNECT_AFTER_BAD_WINDOWS = 6;
// The server's own latency heartbeat answers (one every 2s per socket) are
// cheap, in-memory only, and must never be dropped.
const EXEMPT_EVENTS = new Set(['latency:pong']);

export function installSocketFloodGuard(socket: Socket): void {
  let windowStart = Date.now();
  let count = 0;
  let badWindows = 0;
  let warnedThisWindow = false;

  socket.use(([event], next) => {
    if (typeof event === 'string' && EXEMPT_EVENTS.has(event)) return next();

    const now = Date.now();
    if (now - windowStart >= WINDOW_MS) {
      // A window that went over the cap counts against the socket; a clean
      // one forgives it, so a brief burst never accumulates into a kick.
      badWindows = count > MAX_EVENTS_PER_WINDOW ? badWindows + 1 : 0;
      windowStart = now;
      count = 0;
      warnedThisWindow = false;
    }
    count++;
    if (count <= MAX_EVENTS_PER_WINDOW) return next();

    // Over the cap: the event is dropped without running its handler.
    if (!warnedThisWindow) {
      warnedThisWindow = true;
      socket.emit('rate_limited', { retryAfterMs: WINDOW_MS - (now - windowStart) });
    }
    if (badWindows + 1 >= DISCONNECT_AFTER_BAD_WINDOWS) socket.disconnect(true);
    // Not calling next() drops the event; no error is raised, so a flooding
    // client can't use error replies to generate more work.
  });
}
