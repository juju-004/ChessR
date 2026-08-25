/**
 * Chess960 (Fischer Random) starting position generator.
 *
 * IMPORTANT CAVEAT: chess.js, which does all move validation in this app, 
 * does not support Chess960 castling (long-standing open upstream issue,
 * unresolved as of their own roadmap). Castling rights are therefore set to
 * none ('-') for these games rather than a misleading "KQkq" that chess.js
 * couldn't correctly act on for non-standard rook files anyway. Practically:
 * Chess960 games play out normally, but neither side can castle.
 */

function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function generateChess960BackRank(): string {
  const squares: (string | null)[] = new Array(8).fill(null);

  const darkFiles = [0, 2, 4, 6]; // a, c, e, g
  const lightFiles = [1, 3, 5, 7]; // b, d, f, h

  // Bishops on opposite-colored squares.
  squares[darkFiles[randomInt(darkFiles.length)]] = 'b';
  squares[lightFiles[randomInt(lightFiles.length)]] = 'b';

  const emptyIndices = () => squares.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);

  // Queen on any remaining square.
  let empty = emptyIndices();
  squares[empty[randomInt(empty.length)]] = 'q';

  // Two knights on any remaining squares.
  empty = emptyIndices();
  squares[empty[randomInt(empty.length)]] = 'n';
  empty = emptyIndices();
  squares[empty[randomInt(empty.length)]] = 'n';

  // Remaining 3 squares, left to right, are always Rook / King / Rook, 
  // this is what guarantees the king ends up between the two rooks.
  empty = emptyIndices().sort((a, b) => a - b);
  squares[empty[0]] = 'r';
  squares[empty[1]] = 'k';
  squares[empty[2]] = 'r';

  return squares.join('');
}

export function generateChess960Fen(): string {
  const backRank = generateChess960BackRank();
  return `${backRank}/pppppppp/8/8/8/8/PPPPPPPP/${backRank.toUpperCase()} w - - 0 1`;
}
