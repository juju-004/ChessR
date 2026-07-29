import { Chess } from 'chess.js';

export function computeDests(chess: Chess): Map<string, string[]> {
  const dests = new Map<string, string[]>();
  const moves = chess.moves({ verbose: true });
  for (const m of moves) {
    const arr = dests.get(m.from) ?? [];
    arr.push(m.to);
    dests.set(m.from, arr);
  }
  return dests;
}

export function needsPromotion(chess: Chess, from: string, to: string): boolean {
  const moves = chess.moves({ square: from as any, verbose: true });
  return moves.some((m) => m.to === to && m.promotion);
}

export function turnColor(chess: Chess): 'white' | 'black' {
  return chess.turn() === 'w' ? 'white' : 'black';
}

/**
 * Always renders as MM:SS:D (minutes : seconds : tenths-of-a-second), e.g.
 * "05:30:0" or, right at the buzzer, "00:00:0" — previously this only showed
 * minutes:seconds and (via Math.floor on whole seconds) visually got stuck
 * on "0:01" for the better part of a second before the flag actually fell,
 * making it look like the clock never really reached zero. Carrying the
 * deciseconds through at all times fixes that and matches what's asked for.
 */
export function formatClock(ms: number, _precise = false): string {
  const clamped = Math.max(0, ms);
  const totalDeciseconds = Math.floor(clamped / 100);
  const minutes = Math.floor(totalDeciseconds / 600);
  const seconds = Math.floor(totalDeciseconds / 10) % 60;
  const deciseconds = totalDeciseconds % 10;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${deciseconds}`;
}

/** Whether the side to move is currently in check. */
export function isInCheck(chess: Chess): boolean {
  return chess.inCheck();
}

// ================= MATERIAL DIFF =================
type MaterialPieceType = 'p' | 'n' | 'b' | 'r' | 'q';

export interface CapturedPieceCount {
  type: MaterialPieceType;
  count: number;
}

export interface MaterialDiff {
  /** Pieces missing from black's side, i.e. captured BY white — shown on
   *  white's panel. */
  capturedByWhite: CapturedPieceCount[];
  /** Pieces missing from white's side, i.e. captured BY black — shown on
   *  black's panel. */
  capturedByBlack: CapturedPieceCount[];
  /** Standard point value of white's remaining pieces minus black's.
   *  Positive → white is ahead by that many points, negative → black is. */
  advantage: number;
}

const MATERIAL_START_COUNTS: Record<MaterialPieceType, number> = {
  q: 1,
  r: 2,
  b: 2,
  n: 2,
  p: 8,
};

const MATERIAL_PIECE_VALUE: Record<MaterialPieceType, number> = {
  q: 9,
  r: 5,
  b: 3,
  n: 3,
  p: 1,
};

/** Display order — most valuable first, matches how lichess/chess.com lay
 *  out the captured-pieces tray. */
const MATERIAL_DISPLAY_ORDER: MaterialPieceType[] = ['q', 'r', 'b', 'n', 'p'];

/**
 * Derives per-side captured pieces + point advantage purely from the current
 * FEN's piece counts (starting counts minus what's left on the board) — no
 * move-history bookkeeping needed, so it works identically for a live game,
 * a replay scrubbed to any position, or a freshly-loaded spectate.
 *
 * Known simplification (same one lichess/chess.com make): a pawn that's been
 * promoted looks identical, count-wise, to a pawn that's been captured — the
 * board just has one fewer pawn and one extra piece of the promoted type
 * either way. So on the rare game with a promotion, the captured-pieces
 * *icons* can be slightly off (may show a "captured pawn" that was actually
 * promoted, or miss counting the piece it promoted into as unusual). The
 * point-value `advantage` figure is unaffected by this — it's computed
 * directly from what's actually on the board, not by tallying captures.
 */
export function computeMaterialDiff(fen: string): MaterialDiff {
  const boardPart = fen.split(' ')[0];
  const whiteCounts: Record<MaterialPieceType, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  const blackCounts: Record<MaterialPieceType, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };

  for (const ch of boardPart) {
    if (ch === '/' || (ch >= '1' && ch <= '8')) continue;
    const lower = ch.toLowerCase() as MaterialPieceType | 'k';
    if (lower === 'k' || !(lower in whiteCounts)) continue;
    if (ch === lower) blackCounts[lower]++;
    else whiteCounts[lower]++;
  }

  const capturedByWhite: CapturedPieceCount[] = [];
  const capturedByBlack: CapturedPieceCount[] = [];
  let whiteValue = 0;
  let blackValue = 0;

  for (const type of MATERIAL_DISPLAY_ORDER) {
    whiteValue += whiteCounts[type] * MATERIAL_PIECE_VALUE[type];
    blackValue += blackCounts[type] * MATERIAL_PIECE_VALUE[type];

    const missingFromBlack = MATERIAL_START_COUNTS[type] - blackCounts[type];
    const missingFromWhite = MATERIAL_START_COUNTS[type] - whiteCounts[type];
    if (missingFromBlack > 0) capturedByWhite.push({ type, count: missingFromBlack });
    if (missingFromWhite > 0) capturedByBlack.push({ type, count: missingFromWhite });
  }

  return { capturedByWhite, capturedByBlack, advantage: whiteValue - blackValue };
}
// =============== END MATERIAL DIFF ================

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

interface Chess960StartingFiles {
  kingFile: number;
  queensideRookFile: number;
  kingsideRookFile: number;
}

function getChess960StartingFiles(initialFen: string): Chess960StartingFiles {
  const backRank = initialFen.split(' ')[0].split('/')[0];
  let kingFile = -1;
  const rookFiles: number[] = [];
  for (let i = 0; i < backRank.length; i++) {
    const c = backRank[i].toLowerCase();
    if (c === 'k') kingFile = i;
    if (c === 'r') rookFiles.push(i);
  }
  rookFiles.sort((a, b) => a - b);
  return { kingFile, queensideRookFile: rookFiles[0], kingsideRookFile: rookFiles[1] };
}

/**
 * Adds Chess960 castling as extra destinations for the king, so chessground's
 * `dests` map actually permits the drag in the first place — chess.js has no
 * concept of Chess960 castling, so it never includes these in `.moves()`.
 * This is purely a UI affordance: offered whenever the king is still on its
 * starting square, regardless of whether castling rights have technically been
 * lost elsewhere (e.g. the rook already moved) — the server independently
 * enforces full legality and will reject an illegal attempt with a clear
 * error, consistent with how every other move in this app works.
 *
 * Supports both input conventions: dragging the king onto its own rook (the
 * unambiguous convention used by python-chess/chessops/lichess internally),
 * and dragging the king directly to its final g/c-file square.
 */
export function addChess960CastlingDests(
  dests: Map<string, string[]>,
  chess: Chess,
  initialFen: string,
): Map<string, string[]> {
  const color = chess.turn(); // 'w' | 'b'
  const rank = color === 'w' ? '1' : '8';
  const files = getChess960StartingFiles(initialFen);
  const kingSquare = `${FILES[files.kingFile]}${rank}`;

  const king = chess.get(kingSquare as any);
  if (!king || king.type !== 'k' || king.color !== color) return dests; // king already moved off its start square
  if (chess.inCheck()) return dests; // can't castle out of check — don't offer it as a hint

  const extra: string[] = [];
  for (const rookFile of [files.queensideRookFile, files.kingsideRookFile]) {
    const rookSquare = `${FILES[rookFile]}${rank}`;
    const rook = chess.get(rookSquare as any);
    if (rook && rook.type === 'r' && rook.color === color) extra.push(rookSquare);
  }
  extra.push(`g${rank}`, `c${rank}`);

  if (extra.length > 0) {
    const existing = dests.get(kingSquare) ?? [];
    dests.set(kingSquare, [...new Set([...existing, ...extra])]);
  }
  return dests;
}

// ================= PREMOVE LOGIC =================
/**
 * Premove destinations for chessground's `premovable.customDests` — confirmed
 * via chessground's actual source (src/board.ts) to be a `Map<Key, Key[]>`,
 * the same shape as `movable.dests`, NOT the flat array some older docs/forks
 * describe.
 *
 * This deliberately does NOT ask chess.js "what's legal here" the way
 * computeDests does for real moves. An earlier version built a hypothetical
 * position with the turn flipped and asked chess.js for legal moves against
 * the CURRENT board — but that means a square still occupied by your own
 * piece can never appear as a destination, since chess.js (correctly) never
 * generates a "capture" of your own piece. That broke the single most common
 * real premove: capturing on a square your own piece currently sits on,
 * anticipating the opponent takes it first (e.g. recapturing on a square
 * after an expected exchange).
 *
 * The fix is to compute premoves the way lichess/chessground actually do:
 * pure geometric piece-movement patterns, completely ignoring what's
 * currently sitting on the board — not just the destination square, but
 * every square along a sliding piece's path too, since any of those pieces
 * (friend or foe) might also have moved on by the time the premove fires.
 * This deliberately overshoots real legality; that's fine, because
 * chessground re-validates the armed premove against the REAL position (via
 * movable.dests) the instant the turn actually comes around, and silently
 * cancels it if it's no longer legal. Same tradeoff lichess makes.
 */
export function computePremoveDests(chess: Chess, color: 'white' | 'black'): Map<string, string[]> {
  try {
    const board = chess.board(); // 8 ranks (8th → 1st), 8 files (a → h) each
    const dests = new Map<string, string[]>();
    const fenColor = color === 'white' ? 'w' : 'b';
    const castleTargets = castlingPremoveTargets(chess, color);

    const diff = (a: number, b: number) => Math.abs(a - b);
    const reachable: Record<string, (x1: number, y1: number, x2: number, y2: number) => boolean> = {
      p: (x1, y1, x2, y2) =>
        diff(x1, x2) < 2 &&
        (color === 'white'
          ? y2 === y1 + 1 || (y1 === 2 && y2 === 4 && x1 === x2)
          : y2 === y1 - 1 || (y1 === 7 && y2 === 5 && x1 === x2)),
      n: (x1, y1, x2, y2) => {
        const xd = diff(x1, x2);
        const yd = diff(y1, y2);
        return (xd === 1 && yd === 2) || (xd === 2 && yd === 1);
      },
      b: (x1, y1, x2, y2) => diff(x1, x2) === diff(y1, y2) && diff(x1, x2) > 0,
      r: (x1, y1, x2, y2) => (x1 === x2 || y1 === y2) && !(x1 === x2 && y1 === y2),
      q: (x1, y1, x2, y2) =>
        (diff(x1, x2) === diff(y1, y2) && diff(x1, x2) > 0) ||
        ((x1 === x2 || y1 === y2) && !(x1 === x2 && y1 === y2)),
      k: (x1, y1, x2, y2) => diff(x1, x2) <= 1 && diff(y1, y2) <= 1 && !(x1 === x2 && y1 === y2),
    };

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = board[r][f];
        if (!piece || piece.color !== fenColor) continue;
        const x1 = f + 1;
        const y1 = 8 - r;
        const from = FILES[f] + y1;
        const fn = reachable[piece.type];
        const targets: string[] = [];

        for (let tr = 0; tr < 8; tr++) {
          for (let tf = 0; tf < 8; tf++) {
            const x2 = tf + 1;
            const y2 = 8 - tr;
            if (fn(x1, y1, x2, y2)) targets.push(FILES[tf] + y2);
          }
        }

        if (piece.type === 'k') {
          for (const t of castleTargets) if (!targets.includes(t)) targets.push(t);
        }

        if (targets.length > 0) dests.set(from, targets);
      }
    }

    return dests;
  } catch {
    return new Map();
  }
}

/** Castling premove targets (g1/c1 or g8/c8), offered whenever that color
 *  still has the corresponding castling right in the FEN — same speculative
 *  spirit as the rest of premove: we don't check whether the path is
 *  currently clear, only whether castling hasn't already been forfeited. */
function castlingPremoveTargets(chess: Chess, color: 'white' | 'black'): string[] {
  const rights = chess.fen().split(' ')[2] ?? '-';
  const targets: string[] = [];
  if (color === 'white') {
    if (rights.includes('K')) targets.push('g1');
    if (rights.includes('Q')) targets.push('c1');
  } else {
    if (rights.includes('k')) targets.push('g8');
    if (rights.includes('q')) targets.push('c8');
  }
  return targets;
}
// =============== END PREMOVE LOGIC ================
