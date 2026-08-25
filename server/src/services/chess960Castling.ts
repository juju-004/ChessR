import type { Chess } from 'chess.js';

/**
 * Hand-rolled Chess960 castling, chess.js has no support for it at all (long
 * standing, unresolved upstream limitation), so this implements the FIDE 960
 * castling rules directly against chess.js's board-manipulation primitives
 * (which DO exist and are solid: .get/.put/.remove/.isAttacked/.inCheck).
 *
 * FIDE 960 castling rules, generalized from standard chess:
 *  - Kingside (O-O): king ends on the g-file, its rook ends on the f-file.
 *  - Queenside (O-O-O): king ends on the c-file, its rook ends on the d-file.
 *  - Neither the king nor that specific rook may have moved before.
 *  - The king may not currently be in check.
 *  - Every square the king passes through (inclusive of start and end) must
 *    not be attacked by the opponent.
 *  - Every square either piece needs to pass through must be empty, except
 *    for the king and rook's own current squares (which may legitimately
 *    "pass over" each other in some 960 setups).
 */

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function fileIndex(square: string): number {
  return FILES.indexOf(square[0]);
}

export interface StartingFiles {
  kingFile: number;
  queensideRookFile: number; // lower file index
  kingsideRookFile: number; // higher file index
}

/** Parses the starting back rank once to find where the king and rooks began.
 *  White and black are always mirrored in a 960 setup, so one computation
 *  covers both colors. */
export function getStartingFiles(initialFen: string): StartingFiles {
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

export interface CastlingRookState {
  kingside: boolean;
  queenside: boolean;
}
export interface CastlingRightsState {
  whiteKingMoved: boolean;
  blackKingMoved: boolean;
  whiteRookMoved: CastlingRookState;
  blackRookMoved: CastlingRookState;
}

export function initialCastlingRights(): CastlingRightsState {
  return {
    whiteKingMoved: false,
    blackKingMoved: false,
    whiteRookMoved: { kingside: false, queenside: false },
    blackRookMoved: { kingside: false, queenside: false },
  };
}

/**
 * Detects whether a proposed (from, to) represents a castling attempt.
 * Supports both conventions: dragging the king onto its own rook (the
 * unambiguous UCI-style encoding used by python-chess/chessops/lichess
 * internally), and dragging the king directly to its final g/c-file square
 * (the intuitive "how it looks in standard chess" attempt).
 */
export function detectCastlingAttempt(
  chess: Chess,
  from: string,
  to: string,
  color: 'white' | 'black',
  files: StartingFiles,
): 'kingside' | 'queenside' | null {
  const cgColor = color === 'white' ? 'w' : 'b';
  const piece = chess.get(from as any);
  if (!piece || piece.type !== 'k' || piece.color !== cgColor) return null;

  const rank = color === 'white' ? '1' : '8';
  if (to[1] !== rank) return null;
  const toFile = fileIndex(to);

  const targetPiece = chess.get(to as any);
  if (targetPiece?.type === 'r' && targetPiece.color === cgColor) {
    if (toFile === files.kingsideRookFile) return 'kingside';
    if (toFile === files.queensideRookFile) return 'queenside';
    return null;
  }

  if (fileIndex(from) === files.kingFile) {
    if (toFile === 6) return 'kingside'; // g-file
    if (toFile === 2) return 'queenside'; // c-file
  }

  return null;
}

export interface CastleResult {
  success: boolean;
  reason?: string;
  resultFen?: string;
  kingFrom?: string;
  kingTo?: string;
  rookFrom?: string;
  rookTo?: string;
}

/** Validates and, if legal, executes a Chess960 castle directly on `chess`'s
 *  board state. Returns the resulting FEN for the caller to load into a fresh
 *  Chess instance (this function leaves `chess` itself in a transitional,
 *  not-fully-corrected state, piece positions are right, but turn/clock
 *  fields are not; see resultFen). */
export function attemptCastle(
  chess: Chess,
  color: 'white' | 'black',
  side: 'kingside' | 'queenside',
  files: StartingFiles,
  rights: CastlingRightsState,
): CastleResult {
  const cgColor = color === 'white' ? 'w' : 'b';
  const rank = color === 'white' ? 1 : 8;

  const kingMoved = color === 'white' ? rights.whiteKingMoved : rights.blackKingMoved;
  const rookMoved = color === 'white' ? rights.whiteRookMoved : rights.blackRookMoved;
  if (kingMoved) return { success: false, reason: 'The king has already moved' };
  if (rookMoved[side]) return { success: false, reason: 'That rook has already moved' };
  if (chess.inCheck()) return { success: false, reason: "Can't castle while in check" };

  const kingFile = files.kingFile;
  const rookFile = side === 'kingside' ? files.kingsideRookFile : files.queensideRookFile;
  const kingDestFile = side === 'kingside' ? 6 : 2; // g or c
  const rookDestFile = side === 'kingside' ? 5 : 3; // f or d

  const sq = (file: number) => `${FILES[file]}${rank}`;
  const kingSquare = sq(kingFile);
  const rookSquare = sq(rookFile);
  const kingDest = sq(kingDestFile);
  const rookDest = sq(rookDestFile);

  // Every square either piece travels through must be empty, except the two
  // squares the king/rook themselves currently occupy.
  const travelFiles = new Set<number>();
  const [kLo, kHi] = [Math.min(kingFile, kingDestFile), Math.max(kingFile, kingDestFile)];
  for (let f = kLo; f <= kHi; f++) travelFiles.add(f);
  const [rLo, rHi] = [Math.min(rookFile, rookDestFile), Math.max(rookFile, rookDestFile)];
  for (let f = rLo; f <= rHi; f++) travelFiles.add(f);
  travelFiles.delete(kingFile);
  travelFiles.delete(rookFile);
  for (const f of travelFiles) {
    if (chess.get(sq(f) as any)) return { success: false, reason: 'A piece is in the way' };
  }

  // The king may not pass through or land on an attacked square (the rook's
  // path is not subject to this rule).
  const opponent = cgColor === 'w' ? 'b' : 'w';
  for (let f = kLo; f <= kHi; f++) {
    if (chess.isAttacked(sq(f) as any, opponent as any)) {
      return { success: false, reason: 'Cannot castle through or into check' };
    }
  }

  chess.remove(kingSquare as any);
  chess.remove(rookSquare as any);
  chess.put({ type: 'k', color: cgColor as any }, kingDest as any);
  chess.put({ type: 'r', color: cgColor as any }, rookDest as any);

  const parts = chess.fen().split(' ');
  parts[1] = cgColor === 'w' ? 'b' : 'w'; // flip turn
  parts[2] = '-'; // castling rights tracked separately by us; avoid an inconsistent field
  parts[3] = '-'; // castling never creates an en passant target
  parts[4] = String(Number(parts[4]) + 1); // halfmove clock, not a pawn move or capture
  if (cgColor === 'b') parts[5] = String(Number(parts[5]) + 1); // fullmove increments after black

  return {
    success: true,
    resultFen: parts.join(' '),
    kingFrom: kingSquare,
    kingTo: kingDest,
    rookFrom: rookSquare,
    rookTo: rookDest,
  };
}

/** Call after every successfully applied move (castling or not) to keep the
 *  "has this piece ever moved" tracking correct, this is what prevents,
 *  e.g., a king that moved away and back from castling again. */
export function updateCastlingRights(
  rights: CastlingRightsState,
  color: 'white' | 'black',
  pieceType: string,
  fromSquare: string,
  files: StartingFiles,
): CastlingRightsState {
  const rank = color === 'white' ? '1' : '8';
  if (fromSquare[1] !== rank) return rights;

  const next: CastlingRightsState = {
    whiteKingMoved: rights.whiteKingMoved,
    blackKingMoved: rights.blackKingMoved,
    whiteRookMoved: { ...rights.whiteRookMoved },
    blackRookMoved: { ...rights.blackRookMoved },
  };

  const fromFile = fileIndex(fromSquare);
  if (pieceType === 'k' && fromFile === files.kingFile) {
    if (color === 'white') next.whiteKingMoved = true;
    else next.blackKingMoved = true;
  } else if (pieceType === 'r') {
    const rookState = color === 'white' ? next.whiteRookMoved : next.blackRookMoved;
    if (fromFile === files.kingsideRookFile) rookState.kingside = true;
    else if (fromFile === files.queensideRookFile) rookState.queenside = true;
  }

  return next;
}
