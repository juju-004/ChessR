/**
 * Thin promise wrapper around the Stockfish.js web worker (the
 * "lite single-threaded" build, served from /stockfish/ in client/public).
 *
 * That build needs no special headers (no SharedArrayBuffer / cross-origin
 * isolation), so it works on Vercel and in every browser Chessr already
 * supports. It talks UCI over postMessage.
 *
 * Every score this module hands back is from WHITE's point of view (UCI
 * reports from the side to move's view, which is confusing to carry around),
 * so nothing outside this file ever has to think about whose turn it was.
 */

export interface EvalLine {
  /** Centipawns from white's view. Mate scores are folded in as +/-(10000 - |mate|). */
  cpWhite: number;
  /** Moves to mate from white's view (positive = white mates), else null. */
  mate: number | null;
  /** Principal variation in UCI long algebraic (e2e4, e7e8q, ...). */
  pv: string[];
}

export interface PositionEval {
  fen: string;
  /** Best line first. Up to MULTI_PV entries (fewer when few legal moves). */
  lines: EvalLine[];
}

export const MULTI_PV = 2;

const ENGINE_URL = "/stockfish/stockfish-19-lite-single.js";

interface Pending {
  resolve: (lines: EvalLine[]) => void;
  reject: (err: Error) => void;
  sideToMove: "w" | "b";
  byPv: Map<number, EvalLine>;
}

const INFO_RE =
  /^info .*?\bdepth (\d+) .*?\bmultipv (\d+) .*?\bscore (cp|mate) (-?\d+).*?\bpv (.+)$/;

export class StockfishEngine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private pending: Pending | null = null;
  private waiters: Array<(line: string) => void> = [];

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private onLine = (line: string) => {
    // One-shot waiters (uciok / readyok) first.
    if (this.waiters.length) {
      const w = this.waiters.shift()!;
      w(line);
    }
    const p = this.pending;
    if (!p) return;

    if (line.startsWith("info ")) {
      const m = INFO_RE.exec(line);
      if (!m) return;
      const multipv = Number(m[2]);
      const kind = m[3];
      const raw = Number(m[4]);
      const pv = m[5].trim().split(/\s+/);
      // UCI scores are relative to the side to move; flip for black.
      const sign = p.sideToMove === "w" ? 1 : -1;
      let cpWhite: number;
      let mate: number | null = null;
      if (kind === "mate") {
        mate = raw * sign;
        cpWhite = Math.sign(mate) * (10000 - Math.min(Math.abs(mate), 999));
      } else {
        cpWhite = raw * sign;
      }
      // Later info lines are deeper, so just overwrite per multipv slot.
      p.byPv.set(multipv, { cpWhite, mate, pv });
    } else if (line.startsWith("bestmove")) {
      this.pending = null;
      const lines = [...p.byPv.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, l]) => l);
      p.resolve(lines);
    }
  };

  /** Resolves once the next line satisfies `test`. */
  private waitFor(test: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      const handler = (line: string) => {
        if (test(line)) resolve();
        else this.waiters.push(handler);
      };
      this.waiters.push(handler);
    });
  }

  init(chess960 = false): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const worker = new Worker(ENGINE_URL);
      this.worker = worker;
      worker.onmessage = (ev: MessageEvent) => {
        const data = typeof ev.data === "string" ? ev.data : String(ev.data);
        for (const line of data.split("\n")) {
          if (line) this.onLine(line.trim());
        }
      };
      worker.onerror = () => {
        this.pending?.reject(new Error("Engine failed to load"));
        this.pending = null;
      };
      const uciOk = this.waitFor((l) => l === "uciok");
      this.send("uci");
      await uciOk;
      this.send(`setoption name MultiPV value ${MULTI_PV}`);
      this.send("setoption name Hash value 16");
      if (chess960) this.send("setoption name UCI_Chess960 value true");
      const readyOk = this.waitFor((l) => l === "readyok");
      this.send("isready");
      await readyOk;
    })();
    return this.ready;
  }

  async analyse(fen: string, depth: number): Promise<EvalLine[]> {
    await this.init();
    if (this.pending) throw new Error("Engine is busy");
    const sideToMove = (fen.split(" ")[1] === "b" ? "b" : "w") as "w" | "b";
    return new Promise<EvalLine[]>((resolve, reject) => {
      this.pending = { resolve, reject, sideToMove, byPv: new Map() };
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
    });
  }

  destroy() {
    if (this.pending) {
      this.pending.reject(new Error("Engine stopped"));
      this.pending = null;
    }
    this.waiters = [];
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}
