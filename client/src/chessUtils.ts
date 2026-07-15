import { Chess } from 'chess.js';

/**
 * Builds the `movable.dests` map chessground needs to know which squares are
 * draggable. This mirrors the standard lichess pattern: dests only exist for the
 * side whose turn it is, so pieces of the side NOT to move simply can't be picked
 * up — no separate "is it my turn" gate needed on the chessground config itself.
 */
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
