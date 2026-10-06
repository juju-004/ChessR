// Move-latency diagnostics. Answers "where does the time go when a move is
// played?" by recording, for every move, how long each server stage took,
// and (from a small report each client sends back) how long the player
// actually waited between sending the move and seeing it confirmed.
//
//   client rtt  = server time (read + compute + write + handler overhead)
//               + network both ways + any wait before the handler ran
//   network     = client rtt - server time   (derived, see recordClientMove)
//
// Configure with env MOVE_TIMING_LOG:
//   off      nothing is recorded or logged
//   summary  (default) one summary line a minute + a line per slow move
//   all      additionally one line for every move
// and MOVE_TIMING_SLOW_MS (default 150): a move whose server handling took
// at least this long is logged on its own line in `summary` mode.

import { monitorEventLoopDelay } from 'node:perf_hooks';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';

const MODE = env.MOVE_TIMING_LOG;
const SLOW_MS = env.MOVE_TIMING_SLOW_MS;
const SUMMARY_EVERY_MS = 60_000;
const REDIS_PING_EVERY_MS = 10_000;
const MAX_SAMPLES = 5000; // per series per window, a bound on memory only
const PENDING_TTL_MS = 30_000;

export const moveTimingEnabled = MODE !== 'off';

export interface ServerMoveSample {
  gameId: string;
  moveNumber: number;
  /** Redis GET + JSON.parse of the live state. */
  getMs: number;
  /** Everything between reading the state and writing it (chess.js etc). */
  computeMs: number;
  /** The atomic Lua write (state + move list). */
  writeMs: number;
  /** Whole applyMove call, including conflict retries. */
  applyMs: number;
  /** Handler start until just before the broadcast. */
  handlerMs: number;
  /** Cost of the io.emit() call itself (adapter publish is async, not counted). */
  emitMs: number;
  attempts: number;
  lagCompMs: number;
}

class Series {
  private values: number[] = [];
  push(v: number) {
    if (Number.isFinite(v) && this.values.length < MAX_SAMPLES) this.values.push(v);
  }
  get count() {
    return this.values.length;
  }
  reset() {
    this.values = [];
  }
  /** "p50/p95/max" rounded, or "-" when empty. */
  fmt(): string {
    if (this.values.length === 0) return '-';
    const s = [...this.values].sort((a, b) => a - b);
    const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return `${r(at(0.5))}/${r(at(0.95))}/${r(s[s.length - 1])}`;
  }
}

const r = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);

const win = {
  moves: 0,
  slow: 0,
  get: new Series(),
  compute: new Series(),
  write: new Series(),
  apply: new Series(),
  handler: new Series(),
  emit: new Series(),
  retries: 0,
  clientRtt: new Series(),
  network: new Series(),
  redisPing: new Series(),
  byTransport: new Map<string, number>(),
};

// Server handler time per move, kept briefly so the client's report for the
// same move can be paired with it. Key: `${gameId}:${moveNumber}`.
const pending = new Map<string, { handlerMs: number; at: number }>();

export function recordServerMove(s: ServerMoveSample): void {
  if (!moveTimingEnabled) return;
  win.moves++;
  win.get.push(s.getMs);
  win.compute.push(s.computeMs);
  win.write.push(s.writeMs);
  win.apply.push(s.applyMs);
  win.handler.push(s.handlerMs);
  win.emit.push(s.emitMs);
  if (s.attempts > 1) win.retries++;

  if (pending.size < 5000) pending.set(`${s.gameId}:${s.moveNumber}`, { handlerMs: s.handlerMs, at: Date.now() });

  const slow = s.handlerMs >= SLOW_MS;
  if (slow) win.slow++;
  if (MODE === 'all' || slow) {
    console.log(
      `⏱️  ${slow ? 'SLOW ' : ''}move game=${s.gameId} #${s.moveNumber} ` +
        `handler=${r(s.handlerMs)}ms (get=${r(s.getMs)} compute=${r(s.computeMs)} write=${r(s.writeMs)} ` +
        `emit=${r(s.emitMs)}) attempts=${s.attempts} lagComp=${Math.round(s.lagCompMs)}ms`,
    );
  }
}

/** The mover's own measurement: send -> confirmation received, in the browser. */
export function recordClientMove(
  gameId: string,
  moveNumber: number,
  rttMs: number,
  transport: string,
): void {
  if (!moveTimingEnabled) return;
  if (!Number.isFinite(rttMs) || rttMs < 0 || rttMs > 60_000) return;
  win.clientRtt.push(rttMs);
  const t = transport === 'websocket' || transport === 'polling' ? transport : 'unknown';
  win.byTransport.set(t, (win.byTransport.get(t) ?? 0) + 1);

  const key = `${gameId}:${moveNumber}`;
  const server = pending.get(key);
  let network: number | null = null;
  if (server) {
    pending.delete(key);
    network = Math.max(0, rttMs - server.handlerMs);
    win.network.push(network);
  }
  if (MODE === 'all' || (network !== null && rttMs >= SLOW_MS * 4)) {
    console.log(
      `⏱️  client move game=${gameId} #${moveNumber} rtt=${r(rttMs)}ms transport=${t}` +
        (network !== null ? ` server=${r(server!.handlerMs)}ms network≈${r(network)}ms` : ' (no server pairing)'),
    );
  }
}

let started = false;
const timers: NodeJS.Timeout[] = [];

export function startMoveTimingReporter(): void {
  if (!moveTimingEnabled || started) return;
  started = true;
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();

  // Time a PING on the same shared client the move path uses. With
  // auto-pipelining a move's commands queue behind whatever else is in
  // flight on this connection, so this is the realistic floor for a move's
  // Redis cost, not just the raw network distance to Redis.
  const ping = setInterval(() => {
    const t0 = performance.now();
    redis
      .ping()
      .then(() => win.redisPing.push(performance.now() - t0))
      .catch(() => undefined);
  }, REDIS_PING_EVERY_MS);

  const summary = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of pending) if (now - v.at > PENDING_TTL_MS) pending.delete(k);

    if (win.moves > 0 || win.clientRtt.count > 0) {
      const transports = [...win.byTransport].map(([k, v]) => `${k}=${v}`).join(' ') || '-';
      console.log(
        `⏱️  move-timing last ${SUMMARY_EVERY_MS / 1000}s (p50/p95/max ms) | moves=${win.moves} slow(>=${SLOW_MS}ms)=${win.slow} retries=${win.retries}\n` +
          `    server handler ${win.handler.fmt()}  = get ${win.get.fmt()} + compute ${win.compute.fmt()} + write ${win.write.fmt()}  (emit ${win.emit.fmt()})\n` +
          `    client rtt     ${win.clientRtt.fmt()} (n=${win.clientRtt.count}, transports: ${transports})  network≈ ${win.network.fmt()}\n` +
          `    redis ping     ${win.redisPing.fmt()}   event loop delay p50/p99/max ${r(loop.percentile(50) / 1e6)}/${r(loop.percentile(99) / 1e6)}/${r(loop.max / 1e6)}`,
      );
    }
    win.moves = 0;
    win.slow = 0;
    win.retries = 0;
    for (const k of ['get', 'compute', 'write', 'apply', 'handler', 'emit', 'clientRtt', 'network', 'redisPing'] as const) {
      win[k].reset();
    }
    win.byTransport.clear();
    loop.reset();
  }, SUMMARY_EVERY_MS);

  for (const t of [ping, summary]) {
    t.unref();
    timers.push(t);
  }
}

export function stopMoveTimingReporter(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
  started = false;
}
