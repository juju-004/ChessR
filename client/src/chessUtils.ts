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

/**
 * Premove destinations. Premoves are inherently speculative — chess.js can only
 * tell us legal moves for the side whose turn it actually is, so we build a
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

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/** Returns the square of the king currently in check, or undefined if nobody is. */
export function findCheckSquare(chess: Chess): string | undefined {
  if (!chess.inCheck()) return undefined;
  const color = chess.turn(); // the side to move is the one in check
  const board = chess.board(); // board[0] = rank 8 ... board[7] = rank 1, files a-h left to right
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f];
      if (cell && cell.type === 'k' && cell.color === color) {
        return `${FILES[f]}${8 - r}`;
      }
    }
  }
  return undefined;
}
