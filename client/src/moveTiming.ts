// Client half of the move-latency diagnostics (server half:
// server/src/services/moveTiming.service.ts).
//
// For every move THIS player makes, measures how long it took from handing
// the move to the socket until the server's confirmation came back, i.e. the
// real wait the player experienced (the board itself already moved
// optimistically). That number is reported to the server, which pairs it with
// its own per-stage timings to split the wait into server time vs network.
//
// See it in the browser:
//   - console lines appear in dev builds, or after
//       localStorage.setItem("chessr:moveTiming", "1")   (then reload)
//   - chessrMoveStats() in the console prints the last 100 moves' summary
//   - window.__chessrMoveTimings holds the raw samples

import type { Socket } from "socket.io-client";

interface Sample {
  at: number;
  gameId: string;
  moveNumber: number;
  rttMs: number;
  serverMs: number | null;
  networkMs: number | null;
  transport: string;
}

const MAX_SAMPLES = 100;
const samples: Sample[] = [];
let sentAt: number | null = null;

function verbose(): boolean {
  try {
    return (
      import.meta.env.DEV || localStorage.getItem("chessr:moveTiming") === "1"
    );
  } catch {
    return false;
  }
}

/** Call right before emitting a move. */
export function markMoveSent(): void {
  sentAt = performance.now();
}

/** The move was rejected / never confirmed: forget the pending measurement. */
export function clearMoveSent(): void {
  sentAt = null;
}

/** Elapsed ms since the pending move was sent, consuming it. Null when none is
 *  pending (e.g. this confirmation is the opponent's move). */
export function takeMoveRtt(): number | null {
  if (sentAt === null) return null;
  const rtt = performance.now() - sentAt;
  sentAt = null;
  return rtt;
}

export function reportMoveTiming(
  socket: Socket,
  gameId: string,
  moveNumber: number,
  rttMs: number,
  serverMs: unknown,
): void {
  const server = typeof serverMs === "number" ? serverMs : null;
  const transport = socket.io?.engine?.transport?.name ?? "unknown";
  const sample: Sample = {
    at: Date.now(),
    gameId,
    moveNumber,
    rttMs: Math.round(rttMs * 10) / 10,
    serverMs: server,
    networkMs: server === null ? null : Math.max(0, Math.round((rttMs - server) * 10) / 10),
    transport,
  };
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.shift();

  if (verbose()) {
    console.log(
      `[move-timing] #${moveNumber} rtt=${sample.rttMs}ms` +
        (server !== null ? ` server=${server}ms network≈${sample.networkMs}ms` : "") +
        ` transport=${transport}`,
    );
  }

  socket.emit("game:move_timing", {
    gameId,
    moveNumber,
    rttMs: sample.rttMs,
    transport,
  });
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function stats(): string {
  if (samples.length === 0) return "No moves measured yet.";
  const rtt = samples.map((s) => s.rttMs);
  const net = samples.map((s) => s.networkMs).filter((n): n is number => n !== null);
  const srv = samples.map((s) => s.serverMs).filter((n): n is number => n !== null);
  const f = (v: number[]) =>
    v.length ? `${pct(v, 0.5)}/${pct(v, 0.95)}/${Math.max(...v)}` : "-";
  return (
    `last ${samples.length} moves (p50/p95/max ms)\n` +
    `  your wait (rtt): ${f(rtt)}\n` +
    `  server part:     ${f(srv)}\n` +
    `  network part:    ${f(net)}\n` +
    `  transport:       ${[...new Set(samples.map((s) => s.transport))].join(", ")}`
  );
}

declare global {
  interface Window {
    __chessrMoveTimings?: Sample[];
    chessrMoveStats?: () => void;
  }
}

if (typeof window !== "undefined") {
  window.__chessrMoveTimings = samples;
  window.chessrMoveStats = () => console.log(stats());
}
