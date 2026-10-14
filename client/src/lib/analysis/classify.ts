import { Chess } from "chess.js";
import type { EvalLine, PositionEval } from "./engine.js";

export type MoveClass =
  | "brilliant"
  | "great"
  | "best"
  | "book"
  | "good"
  | "bad"
  | "miss"
  | "blunder";

export const MOVE_CLASSES: MoveClass[] = [
  "brilliant",
  "great",
  "best",
  "book",
  "good",
  "bad",
  "miss",
  "blunder",
];

/* ------------------------------------------------------------------ *
 * Tuning knobs. All thresholds are in "win-percentage points" (0-100),
 * not raw centipawns, so a 1-pawn slip while already winning big doesn't
 * get punished the same as one in an equal position.
 * ------------------------------------------------------------------ */

/** Moves that lose at least this much win% are blunders. */
export const BLUNDER_LOSS = 20;
/** Loss in [MISS_LOSS, BLUNDER_LOSS) is a bad move: you weakened your own position. */
export const MISS_LOSS = 8;
/**
 * A "miss" is different from a "bad" move: it's failing to punish the
 * opponent. It needs the opponent's previous move to have lost at least
 * MISS_LOSS win% (an error or blunder), you to be doing well because of it
 * (MISS_MIN_BEFORE), and your own reply to throw a big chunk of that away
 * (at least MISS_LOSS). If your reply drops you into a lost position
 * (below MISS_MIN_AFTER) it's a plain blunder instead.
 */
const MISS_MIN_BEFORE = 50;
const MISS_MIN_AFTER = 40;
/** Max loss for a non-top move to still count as "best" (engine-equal). */
const BEST_TOLERANCE = 0.5;
/** Max loss for a move to be eligible for Brilliant. */
const BRILLIANT_TOLERANCE = 1.5;
/**
 * Great is an only-move that actually decides something. All of these must
 * hold: it is the engine's top move, the 2nd-best option is at least
 * GREAT_GAP worse, that 2nd-best leaves you no better than GREAT_ALT_MAX
 * (so the alternatives throw away an edge or the game, rather than just
 * trading a big edge for a slightly smaller one), the position wasn't
 * already decided, and it isn't a plain recapture.
 */
const GREAT_GAP = 20;
const GREAT_ALT_MAX = 50;
const ALREADY_WON = 90;
/** Brilliant needs you to give up at least this much material (3 = a piece)... */
const SACRIFICE_MATERIAL = 3;
/** ...without ending up worse than this, and without already crushing before. */
const BRILLIANT_MIN_AFTER = 45;
const BRILLIANT_MAX_BEFORE = 90;

/** Lichess' cp -> win% curve. */
export function winPercentWhite(cpWhite: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cpWhite)) - 1);
}

function winPercentFor(line: EvalLine, color: "w" | "b"): number {
  const w = winPercentWhite(line.cpWhite);
  return color === "w" ? w : 100 - w;
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function materialBalance(chess: Chess, color: "w" | "b"): number {
  let mine = 0;
  let theirs = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq) continue;
      const v = PIECE_VALUE[sq.type] ?? 0;
      if (sq.color === color) mine += v;
      else theirs += v;
    }
  }
  return mine - theirs;
}

/**
 * Material swing for `mover` after playing `playedFen -> pv`, measured only
 * once the engine's own line has finished a full exchange (an even number of
 * plies after the move). Looking just one reply deep would flag every plain
 * trade (knight takes pawn, pawn takes knight) as a sacrifice.
 */
function sacrificedMaterial(
  beforeFen: string,
  afterEval: PositionEval,
  mover: "w" | "b",
): number {
  try {
    const before = new Chess(beforeFen);
    const baseline = materialBalance(before, mover);
    const pv = afterEval.lines[0]?.pv ?? [];
    // pv[0] is the opponent's reply, pv[1] the mover's answer, and so on.
    const plies = Math.min(pv.length, 4);
    const usable = plies - (plies % 2);
    if (usable < 2) return 0;
    const chess = new Chess(afterEval.fen);
    for (let i = 0; i < usable; i++) {
      const uci = pv[i];
      chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
    }
    return baseline - materialBalance(chess, mover);
  } catch {
    // Unplayable pv (e.g. a chess960 castle spelled differently): no verdict.
    return 0;
  }
}

export interface ClassifyContext {
  /** The position this move produced is in the opening book. */
  isBook?: boolean;
  /** Destination square of the opponent's previous move, to spot recaptures. */
  prevTo?: string;
  /** Win% the opponent gave up with their previous move (see `moveLoss`).
   *  Undefined for the first move of the game. */
  prevLoss?: number;
}

/**
 * Win% the side to move in `before` gave up by playing the move that led to
 * `after`, compared to the engine's best move. Same maths as classifyMove.
 */
export function moveLoss(before: PositionEval, after: PositionEval): number {
  const best = before.lines[0];
  const afterBest = after.lines[0];
  if (!best || !afterBest) return 0;
  const mover: "w" | "b" = before.fen.split(" ")[1] === "b" ? "b" : "w";
  return Math.max(0, winPercentFor(best, mover) - winPercentFor(afterBest, mover));
}

function isRecapture(beforeFen: string, played: { from: string; to: string; promotion?: string }, prevTo?: string): boolean {
  if (!prevTo || played.to !== prevTo) return false;
  try {
    const m = new Chess(beforeFen).move({
      from: played.from,
      to: played.to,
      promotion: played.promotion,
    });
    return !!m.captured;
  } catch {
    return false;
  }
}

export interface MoveClassification {
  cls: MoveClass;
  /** Win% the mover gave up compared to the engine's best move. */
  loss: number;
  /** Best move in UCI, so the UI can say "best was Qh5". */
  bestUci: string | null;
  playedWasBest: boolean;
}

/**
 * Classify the move that took position `ply` to position `ply + 1`.
 * Needs the evals of both positions (the engine's view before and after).
 */
export function classifyMove(
  before: PositionEval,
  after: PositionEval,
  played: { from: string; to: string; promotion?: string },
  ctx: ClassifyContext = {},
): MoveClassification | null {
  const best = before.lines[0];
  const afterBest = after.lines[0];
  if (!best || !afterBest) return null;

  const mover: "w" | "b" = before.fen.split(" ")[1] === "b" ? "b" : "w";
  const beforeWp = winPercentFor(best, mover);
  const afterWp = winPercentFor(afterBest, mover);
  const loss = Math.max(0, beforeWp - afterWp);

  const playedUci = `${played.from}${played.to}${played.promotion ?? ""}`;
  const bestUci = best.pv[0] ?? null;
  const playedWasBest = bestUci === playedUci;

  const done = (cls: MoveClass): MoveClassification => ({
    cls,
    loss,
    bestUci,
    playedWasBest,
  });

  // A known opening position is book, whatever the engine thinks of it.
  if (ctx.isBook) return done("book");

  // Miss: the opponent just erred, you were doing well because of it, and
  // you let most of that go without actually landing in a lost position.
  const opponentErred = (ctx.prevLoss ?? 0) >= MISS_LOSS;
  if (
    loss >= MISS_LOSS &&
    opponentErred &&
    beforeWp >= MISS_MIN_BEFORE &&
    afterWp >= MISS_MIN_AFTER
  ) {
    return done("miss");
  }
  if (loss >= BLUNDER_LOSS) return done("blunder");
  if (loss >= MISS_LOSS) return done("bad");

  if (playedWasBest || loss <= BRILLIANT_TOLERANCE) {
    // Brilliant: a real material sacrifice that doesn't actually cost you
    // the game, in a position that wasn't already won.
    if (
      afterWp >= BRILLIANT_MIN_AFTER &&
      beforeWp <= BRILLIANT_MAX_BEFORE &&
      sacrificedMaterial(before.fen, after, mover) >= SACRIFICE_MATERIAL
    ) {
      return done("brilliant");
    }
    // Great: the one move that holds (or wins) it, and not just a recapture.
    const second = before.lines[1];
    if (playedWasBest && second && beforeWp < ALREADY_WON) {
      const secondWp = winPercentFor(second, mover);
      if (
        beforeWp - secondWp >= GREAT_GAP &&
        secondWp <= GREAT_ALT_MAX &&
        !isRecapture(before.fen, played, ctx.prevTo)
      ) {
        return done("great");
      }
    }
  }
  if (playedWasBest || loss <= BEST_TOLERANCE) return done("best");
  return done("good");
}

/** Evaluation of a finished game position without asking the engine. */
export function terminalEval(fen: string): PositionEval | null {
  try {
    const chess = new Chess(fen);
    if (chess.isCheckmate()) {
      // Side to move is mated, so the other side is winning.
      const whiteWins = chess.turn() === "b";
      return {
        fen,
        lines: [{ cpWhite: whiteWins ? 10000 : -10000, mate: 0, pv: [] }],
      };
    }
    if (chess.isDraw() || chess.isStalemate()) {
      return { fen, lines: [{ cpWhite: 0, mate: null, pv: [] }] };
    }
  } catch {
    /* fall through to the engine */
  }
  return null;
}

/** "+0.3", "-1.2", "M3", "-M5" for the eval bar / header. */
export function formatEval(line: EvalLine | undefined): string {
  if (!line) return "0.0";
  if (line.mate !== null) {
    if (line.mate === 0) return line.cpWhite > 0 ? "1-0" : "0-1";
    return `${line.mate < 0 ? "-" : ""}M${Math.abs(line.mate)}`;
  }
  const pawns = line.cpWhite / 100;
  const s = Math.abs(pawns).toFixed(1);
  return pawns > 0 ? `+${s}` : pawns < 0 ? `-${s}` : "0.0";
}

/**
 * Per-move accuracy (0-100) from the win% the move gave up, using Lichess'
 * published curve. Book moves count as perfect: nobody should lose accuracy
 * for playing known theory.
 */
export function moveAccuracy(c: MoveClassification): number {
  if (c.cls === "book") return 100;
  const acc = 103.1668 * Math.exp(-0.04354 * c.loss) - 3.1669;
  return Math.min(100, Math.max(0, acc));
}

/**
 * One side's accuracy for the game: the average of the arithmetic mean and
 * the harmonic mean of its move accuracies. The harmonic half is what makes
 * a single blunder drag the number down instead of hiding in the average.
 */
export function sideAccuracy(classes: MoveClassification[]): number | null {
  if (classes.length === 0) return null;
  const accs = classes.map(moveAccuracy);
  const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
  const harmonic = accs.length / accs.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return (mean + harmonic) / 2;
}
