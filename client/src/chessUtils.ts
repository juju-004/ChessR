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

export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Whether the side to move is currently in check. */
export function isInCheck(chess: Chess): boolean {
  return chess.inCheck();
}

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

/**
 * Premove destinations for chessground's `premovable.customDests` — confirmed
 * via chessground's actual source (src/board.ts) to be a `Map<Key, Key[]>`,
 * the same shape as `movable.dests`, NOT the flat array some older docs/forks
 * describe. Premoves are inherently speculative — chess.js can only tell us
 * legal moves for the side whose turn it actually is, so we build a
 * hypothetical position with the turn flipped to the premover's color and ask
 * "what would be legal if it were my turn right now". This ignores whether the
 * opponent's upcoming move would leave the premover in check — that's the same
 * approximation lichess itself uses; chessground re-validates the armed premove
 * against the real position the moment the turn actually comes around, and
 * silently cancels it if it's no longer legal.
 */
export function computePremoveDests(chess: Chess, color: 'white' | 'black'): Map<string, string[]> {
  try {
    const parts = chess.fen().split(' ');
    parts[1] = color === 'white' ? 'w' : 'b';
    const hypothetical = new Chess(parts.join(' '));
    return computeDests(hypothetical);
  } catch {
    return new Map();
  }
}
