import { Chess } from 'chess.js';

/** The pure puzzle rules behind puzzle races: no database, no sockets, so it
 *  can be tested on its own. See Puzzle.ts for the move-list format. */

export interface PuzzleLine {
  fen: string;
  /** UCI. moves[0] is the opponent's opening move, then solver / reply pairs. */
  moves: string[];
}

export interface UciMove {
  from: string;
  to: string;
  promotion?: string;
}

export interface PuzzleViewData {
  fen: string;
  firstMove: UciMove | null;
  lastMove: [string, string] | null;
  orientation: 'white' | 'black';
}

export const uciToMove = (uci: string): UciMove => ({
  from: uci.slice(0, 2),
  to: uci.slice(2, 4),
  ...(uci.length > 4 ? { promotion: uci[4] } : {}),
});

/** The position after the first `count` moves of the line. */
function replay(pz: PuzzleLine, count: number): Chess {
  const chess = new Chess(pz.fen);
  for (let i = 0; i < count; i++) chess.move(uciToMove(pz.moves[i]));
  return chess;
}

/** What a player sees for `pz` when the next move they must find is
 *  `moves[moveIdx]` (1 = a fresh puzzle). */
export function describePuzzle(pz: PuzzleLine, moveIdx: number): PuzzleViewData {
  // The solver is the side NOT to move in the starting FEN (the opponent's
  // opening move is played first).
  const orientation = new Chess(pz.fen).turn() === 'w' ? 'black' : 'white';

  if (moveIdx <= 1) {
    return { fen: pz.fen, firstMove: uciToMove(pz.moves[0]), lastMove: null, orientation };
  }
  const last = pz.moves[moveIdx - 1];
  return {
    fen: replay(pz, moveIdx).fen(),
    firstMove: null,
    lastMove: [last.slice(0, 2), last.slice(2, 4)],
    orientation,
  };
}

export type MoveEvaluation =
  | { kind: 'illegal' }
  | { kind: 'wrong' }
  | { kind: 'correct'; puzzleDone: false; reply: UciMove }
  | { kind: 'correct'; puzzleDone: true };

/** Judges the solver's move at `moveIdx`. Correct = the line's own move OR any
 *  move that checkmates (a position can have more than one mate). */
export function evaluateMove(pz: PuzzleLine, moveIdx: number, input: UciMove): MoveEvaluation {
  const chess = replay(pz, moveIdx);

  let played;
  try {
    played = chess.move({ from: input.from, to: input.to, promotion: input.promotion });
  } catch {
    return { kind: 'illegal' };
  }
  const uci = played.from + played.to + (played.promotion ?? '');

  const mates = chess.isCheckmate();
  if (uci !== pz.moves[moveIdx] && !mates) return { kind: 'wrong' };

  if (mates || moveIdx >= pz.moves.length - 1) return { kind: 'correct', puzzleDone: true };
  return { kind: 'correct', puzzleDone: false, reply: uciToMove(pz.moves[moveIdx + 1]) };
}
