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

/** Fixed cutoff for switching the clock display into deciseconds, this one
 *  is intentionally NOT time-control-scaled (unlike LOW_TIME threshold
 *  below): the point of showing tenths is purely "the flag is about to
 *  fall", which is the same visual moment regardless of whether this was a
 *  1-minute or 30-minute game. */
const DECISECONDS_DISPLAY_MS = 10_000;

/**
 * "MM:SS" normally; switches to "MM:SS:D" (tenths of a second) once under
 * DECISECONDS_DISPLAY_MS remain, e.g. "05:30" most of the game, "00:07:4"
 * right at the end, so the last few seconds read as smoothly counting
 * down to zero instead of visibly freezing on a whole second for however
 * much of it is left.
 */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalDeciseconds = Math.floor(clamped / 100);
  const minutes = Math.floor(totalDeciseconds / 600);
  const seconds = Math.floor(totalDeciseconds / 10) % 60;
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');
  if (clamped < DECISECONDS_DISPLAY_MS) {
    const deciseconds = totalDeciseconds % 10;
    return `${mm}:${ss}:${deciseconds}`;
  }
  return `${mm}:${ss}`;
}

/**
 * The "you're running low" threshold used for both the red clock styling
 * and the low-time warning sound, scaled to the time control instead of a
 * single flat number, since 10 seconds left means something very different
 * in a 1-minute bullet game vs. a 30-minute classical one. Defined as 5% of
 * the starting time, floored at 5s (so even bullet games get *some*
 * warning) and capped at 60s (so classical games aren't warned a full
 * minute out, before it's actually urgent). `null` (unlimited time control)
 * returns 0, meaning "never low", there's no flag to worry about.
 */
export function computeLowTimeThresholdMs(baseSeconds: number | null): number {
  if (baseSeconds === null || baseSeconds <= 0) return 0;
  const thresholdSeconds = Math.min(60, Math.max(5, baseSeconds * 0.05));
  return thresholdSeconds * 1000;
}

/**
 * How long a player gets to make their first move before it counts against
 * them. Deliberately a flat window rather than scaled to time control, 
 * simpler to reason about and communicate than the old per-time-control
 * scaling, and 25/30s is generous even for bullet while still catching a
 * genuinely absent player quickly. Plain games get the shorter window since
 * an abort there is low-stakes (nothing lost but a restart); cage matches
 * and tournaments get a bit longer since a first-move timeout there costs an
 * actual game in a series, not just a do-over.
 */
export function computeFirstMoveThresholdMs(isSeriesGame: boolean): number {
  return isSeriesGame ? 30_000 : 25_000;
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
  /** Pieces missing from black's side, i.e. captured BY white, shown on
   *  white's panel. */
  capturedByWhite: CapturedPieceCount[];
  /** Pieces missing from white's side, i.e. captured BY black, shown on
   *  black's panel. */
  capturedByBlack: CapturedPieceCount[];
  /** Net, already-cancelled per-type imbalance, e.g. if white has
   *  captured 2 pawns and black has captured 1, this is 1 pawn for white,
   *  not 2. This (not the raw capturedByWhite/Black above) is what a
   *  material-diff display should actually render as piece icons, same
   *  as lichess/chess.com: a pair of same-type captures on both sides
   *  cancels out rather than showing on both trays. */
  netCapturedByWhite: CapturedPieceCount[];
  netCapturedByBlack: CapturedPieceCount[];
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

/** Display order, most valuable first, matches how lichess/chess.com lay
 *  out the captured-pieces tray. */
const MATERIAL_DISPLAY_ORDER: MaterialPieceType[] = ['q', 'r', 'b', 'n', 'p'];

/**
 * Derives per-side captured pieces + point advantage purely from the current
 * FEN's piece counts (starting counts minus what's left on the board), no
 * move-history bookkeeping needed, so it works identically for a live game,
 * a replay scrubbed to any position, or a freshly-loaded spectate.
 *
 * Known simplification (same one lichess/chess.com make): a pawn that's been
 * promoted looks identical, count-wise, to a pawn that's been captured, the
 * board just has one fewer pawn and one extra piece of the promoted type
 * either way. So on the rare game with a promotion, the captured-pieces
 * *icons* can be slightly off (may show a "captured pawn" that was actually
 * promoted, or miss counting the piece it promoted into as unusual). The
 * point-value `advantage` figure is unaffected by this, it's computed
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
  const netCapturedByWhite: CapturedPieceCount[] = [];
  const netCapturedByBlack: CapturedPieceCount[] = [];
  let whiteValue = 0;
  let blackValue = 0;

  for (const type of MATERIAL_DISPLAY_ORDER) {
    whiteValue += whiteCounts[type] * MATERIAL_PIECE_VALUE[type];
    blackValue += blackCounts[type] * MATERIAL_PIECE_VALUE[type];

    const missingFromBlack = MATERIAL_START_COUNTS[type] - blackCounts[type];
    const missingFromWhite = MATERIAL_START_COUNTS[type] - whiteCounts[type];
    if (missingFromBlack > 0) capturedByWhite.push({ type, count: missingFromBlack });
    if (missingFromWhite > 0) capturedByBlack.push({ type, count: missingFromWhite });

    const net = missingFromBlack - missingFromWhite;
    if (net > 0) netCapturedByWhite.push({ type, count: net });
    else if (net < 0) netCapturedByBlack.push({ type, count: -net });
  }

  return {
    capturedByWhite,
    capturedByBlack,
    netCapturedByWhite,
    netCapturedByBlack,
    advantage: whiteValue - blackValue,
  };
}
// =============== END MATERIAL DIFF ================

// ================= PER-MOVE CLOCK RECONSTRUCTION =================
interface ClockReconstructionInput {
  baseSeconds: number | null;
  incrementSeconds: number;
  /** Each move's server timestamp, same `timestampMs` recorded on
   *  IMove server-side. */
  moveTimestampsMs: number[];
  berserk?: { white: boolean; black: boolean };
}

export interface PlyClock {
  /** Remaining time for the side that just moved, immediately after this
   *  move, null for an untimed game. Mirrors what lichess shows next to
   *  each move in the move list. */
  remainingMs: number | null;
  /** How long this move actually took to play, null for the first move
   *  of each side (the clock is "free" until both sides have moved once,
   *  same rule the server enforces; see finalizeMove in
   *  gameState.service.ts), and null for an untimed game. This is what a
   *  "which move did I waste the most time on" view should key off of,
   *  not remainingMs on its own. */
  thinkTimeMs: number | null;
}

/**
 * Reconstructs, for every ply, the mover's remaining clock immediately
 * after that move, client-side, from data already on hand (move
 * timestamps + the game's time control), so replay/history-browsing needs
 * no separate server round trip or persisted per-ply clock log.
 *
 * Deliberately mirrors finalizeMove's server-side accounting exactly:
 *   - the first move of EACH side is free (nothing charged, no increment)
 *, the clock only starts truly running once both sides have moved
 *     once, same as lichess and same as this server enforces live.
 *   - increment is added only alongside a real deduction, never on its
 *     own (so it can't be exploited by, say, aborting before it's live).
 *
 * One necessary approximation: the server also subtracts a small, capped
 * lag-compensation estimate (network round-trip) before charging the
 * clock (see latency.service.ts), that per-move figure isn't persisted,
 * so this reconstruction can't replicate it exactly and will read a few
 * tens of ms slower per move than the authoritative server clock did in
 * the moment. Cosmetic only; doesn't change which move actually cost the
 * most time.
 */
export function reconstructPlyClocks(input: ClockReconstructionInput): PlyClock[] {
  const { baseSeconds, incrementSeconds, moveTimestampsMs, berserk } = input;
  const baseMs = baseSeconds === null ? null : baseSeconds * 1000;
  const incrementMs = incrementSeconds * 1000;

  let whiteRemainingMs = baseMs;
  let blackRemainingMs = baseMs;

  return moveTimestampsMs.map((timestampMs, i) => {
    const isWhite = i % 2 === 0;
    const clockIsLive = i >= 2 && baseMs !== null;

    let thinkTimeMs: number | null = null;
    if (clockIsLive) {
      const prevTimestampMs = moveTimestampsMs[i - 1];
      thinkTimeMs = Math.max(0, timestampMs - prevTimestampMs);
      const increment = (isWhite ? berserk?.white : berserk?.black) ? 0 : incrementMs;
      if (isWhite) {
        whiteRemainingMs = Math.max(0, (whiteRemainingMs ?? 0) - thinkTimeMs) + increment;
      } else {
        blackRemainingMs = Math.max(0, (blackRemainingMs ?? 0) - thinkTimeMs) + increment;
      }
    }

    return {
      remainingMs: isWhite ? whiteRemainingMs : blackRemainingMs,
      thinkTimeMs,
    };
  });
}
// =============== END PER-MOVE CLOCK RECONSTRUCTION ================

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
 * `dests` map actually permits the drag in the first place, chess.js has no
 * concept of Chess960 castling, so it never includes these in `.moves()`.
 * This is purely a UI affordance: offered whenever the king is still on its
 * starting square, regardless of whether castling rights have technically been
 * lost elsewhere (e.g. the rook already moved), the server independently
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
  if (chess.inCheck()) return dests; // can't castle out of check, don't offer it as a hint

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
 * Replays a single recorded move against a scratch `Chess` instance, for
 * rebuilding historical positions (move-list navigation, and the
 * no-stored-fen fallback for finished/aborted games).
 *
 * For a Chess960 game, a castle is recorded server-side as the literal SAN
 * "O-O"/"O-O-O" (see gameState.service.ts), but every 960 game is created
 * with castling rights hard-set to '-' (chess.js has no notion of
 * non-standard castling — see chess960.service.ts), so a plain
 * `chess.move('O-O')` sees "no castling rights available" and throws. That
 * exception used to propagate out of the *entire* replay loop (it's wrapped
 * in one try/catch), silently breaking history navigation for any 960 game
 * that contained a castle anywhere in it, and making the no-fen fallback
 * fall back to the STARTING position instead of the final one.
 *
 * This reimplements the server's manual castle (chess960Castling.ts's
 * attemptCastle) purely to replay a move the server already validated once
 * — no legality checking here, just moving the pieces and updating the FEN
 * the same way. Standard games, and every non-castle 960 move, still go
 * through chess.js's own `.move()` as before.
 */
export function replayMove(
  chess: Chess,
  san: string,
  variant: 'standard' | 'chess960' | undefined,
  initialFen: string,
): void {
  if (variant === 'chess960' && (san === 'O-O' || san === 'O-O-O')) {
    const color = chess.turn(); // 'w' | 'b' — whoever's move this is
    const rank = color === 'w' ? '1' : '8';
    const files = getChess960StartingFiles(initialFen);
    const side: 'kingside' | 'queenside' = san === 'O-O' ? 'kingside' : 'queenside';
    const rookFile = side === 'kingside' ? files.kingsideRookFile : files.queensideRookFile;
    const kingDestFile = side === 'kingside' ? 6 : 2; // g-file / c-file
    const rookDestFile = side === 'kingside' ? 5 : 3; // f-file / d-file
    const sq = (file: number) => `${FILES[file]}${rank}`;

    chess.remove(sq(files.kingFile) as any);
    chess.remove(sq(rookFile) as any);
    chess.put({ type: 'k', color }, sq(kingDestFile) as any);
    chess.put({ type: 'r', color }, sq(rookDestFile) as any);

    // chess.js's remove/put don't advance the turn or move counters
    // themselves, so patch the FEN fields a real .move() would have.
    const parts = chess.fen().split(' ');
    parts[1] = color === 'w' ? 'b' : 'w'; // turn
    parts[2] = '-'; // castling rights (already '-' for every 960 game)
    parts[3] = '-'; // en passant target (a castle never sets one)
    parts[4] = String(Number(parts[4]) + 1); // halfmove clock (not a pawn move/capture)
    if (color === 'b') parts[5] = String(Number(parts[5]) + 1); // fullmove
    chess.load(parts.join(' '));
    return;
  }

  chess.move(san);
}

/**
 * Client-side counterpart to the server's chess960Castling.ts
 * (detectCastlingAttempt + attemptCastle). chess.js has no notion of 960
 * castling, and every 960 game's castling rights are hard-set to '-', so
 * `chess.move({from, to})` for a castling drag (king dropped onto its own
 * rook, or dragged straight to the g/c-file) always just returns null —
 * chess.js doesn't recognize the shape, legal or not. Before this,
 * Game.tsx's optimistic move application silently did nothing for a 960
 * castle: the piece only actually moved once the server's `game:move` echo
 * came back a full round-trip later, which is exactly what showed up as
 * "movement feels laggy/hesitates" specifically on castling in 960 games.
 *
 * This detects the same two drag conventions the server does and applies
 * the castle locally, speculatively — no legality checking (through-check,
 * blocked squares, etc), the server remains the authority and will
 * reject/correct this the normal way (onError reverting to
 * confirmedFenRef) on the rare occasion it guesses wrong.
 *
 * Returns true if (from, to) was treated as a castle and applied to
 * `chess` in place; false if it wasn't a castling shape at all, so the
 * caller should fall through to a normal chess.move() call.
 */
export function applyChess960CastleMove(
  chess: Chess,
  from: string,
  to: string,
  initialFen: string,
): boolean {
  const piece = chess.get(from as any);
  if (!piece || piece.type !== 'k') return false;
  const color = piece.color; // 'w' | 'b'
  const rank = color === 'w' ? '1' : '8';
  if (to[1] !== rank) return false;

  const files = getChess960StartingFiles(initialFen);
  const toFile = FILES.indexOf(to[0]);
  const fromFile = FILES.indexOf(from[0]);

  const targetPiece = chess.get(to as any);
  let side: 'kingside' | 'queenside' | null = null;
  if (targetPiece && targetPiece.type === 'r' && targetPiece.color === color) {
    if (toFile === files.kingsideRookFile) side = 'kingside';
    else if (toFile === files.queensideRookFile) side = 'queenside';
    else return false;
  } else if (fromFile === files.kingFile) {
    if (toFile === 6) side = 'kingside'; // g-file
    else if (toFile === 2) side = 'queenside'; // c-file
  }
  if (!side) return false;

  const rookFile = side === 'kingside' ? files.kingsideRookFile : files.queensideRookFile;
  const kingDestFile = side === 'kingside' ? 6 : 2;
  const rookDestFile = side === 'kingside' ? 5 : 3;
  const sq = (file: number) => `${FILES[file]}${rank}`;

  chess.remove(sq(files.kingFile) as any);
  chess.remove(sq(rookFile) as any);
  chess.put({ type: 'k', color }, sq(kingDestFile) as any);
  chess.put({ type: 'r', color }, sq(rookDestFile) as any);

  const parts = chess.fen().split(' ');
  parts[1] = color === 'w' ? 'b' : 'w';
  parts[2] = '-';
  parts[3] = '-';
  parts[4] = String(Number(parts[4]) + 1);
  if (color === 'b') parts[5] = String(Number(parts[5]) + 1);
  chess.load(parts.join(' '));
  return true;
}

// ================= PREMOVE LOGIC =================
/**
 * Premove destinations for chessground's `premovable.customDests`, confirmed
 * via chessground's actual source (src/board.ts) to be a `Map<Key, Key[]>`,
 * the same shape as `movable.dests`, NOT the flat array some older docs/forks
 * describe.
 *
 * This deliberately does NOT ask chess.js "what's legal here" the way
 * computeDests does for real moves. An earlier version built a hypothetical
 * position with the turn flipped and asked chess.js for legal moves against
 * the CURRENT board, but that means a square still occupied by your own
 * piece can never appear as a destination, since chess.js (correctly) never
 * generates a "capture" of your own piece. That broke the single most common
 * real premove: capturing on a square your own piece currently sits on,
 * anticipating the opponent takes it first (e.g. recapturing on a square
 * after an expected exchange).
 *
 * The fix is to compute premoves the way lichess/chessground actually do:
 * pure geometric piece-movement patterns, completely ignoring what's
 * currently sitting on the board, not just the destination square, but
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
 *  still has the corresponding castling right in the FEN, same speculative
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

// ================= PGN EXPORT =================

export interface PgnMoveEntry {
  moveNumber: number; // ply, 1-based (odd = White, even = Black) — same as MoveLogEntry
  san: string;
}

export interface PgnGameInfo {
  white: string;
  black: string;
  result: "white" | "black" | "draw" | null;
  variant: "standard" | "chess960";
  initialFen: string;
  moves: PgnMoveEntry[];
  /** Game creation date, ISO string or Date. Defaults to now if omitted. */
  date?: string | Date;
  timeControl?: { baseSeconds: number | null; incrementSeconds: number };
  site?: string;
}

/**
 * Builds a standard PGN transcript for a finished game, for the "Copy PGN"
 * export action (see Game.tsx's handleCopyPgn). Built from the game's own
 * `moves` list (SAN + ply number) rather than chess.js's own `.pgn()`
 * output: a Chess960 game's castling move gets to `chess` via a manual
 * `remove/put/load` (see replayMove above), not `.move()`, and chess.js
 * clears its internal move history on `.load()` — so `.pgn()` would come
 * back missing moves, or empty, for any 960 game with a castle in it.
 * Building the text directly from the move list sidesteps that entirely
 * and works the same way for every variant.
 */
export function buildPgn(info: PgnGameInfo): string {
  const resultTag =
    info.result === "white"
      ? "1-0"
      : info.result === "black"
        ? "0-1"
        : info.result === "draw"
          ? "1/2-1/2"
          : "*";

  const date = info.date ? new Date(info.date) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateTag = Number.isNaN(date.getTime())
    ? "????.??.??"
    : `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;

  // PGN header values can't contain a literal `"` — strip rather than
  // escape, a username/site is never going to need one.
  const clean = (s: string) => s.replace(/"/g, "");

  const headers: Array<[string, string]> = [
    ["Event", "Chessr Game"],
    ["Site", clean(info.site ?? "chessr.app")],
    ["Date", dateTag],
    ["Round", "-"],
    ["White", clean(info.white)],
    ["Black", clean(info.black)],
    ["Result", resultTag],
  ];
  if (info.timeControl) {
    const { baseSeconds, incrementSeconds } = info.timeControl;
    headers.push([
      "TimeControl",
      baseSeconds === null ? "-" : `${baseSeconds}+${incrementSeconds}`,
    ]);
  }
  if (info.variant === "chess960") {
    // Standard PGN tags for a non-default starting position — every PGN
    // reader (lichess, chess.com, chess.js itself) needs SetUp+FEN to
    // replay a 960 game correctly, Variant alone isn't enough.
    headers.push(["Variant", "Chess960"]);
    headers.push(["SetUp", "1"]);
    headers.push(["FEN", info.initialFen]);
  }
  const headerText = headers.map(([k, v]) => `[${k} "${v}"]`).join("\n");

  const parts: string[] = [];
  for (const m of info.moves) {
    if (m.moveNumber % 2 === 1) parts.push(`${Math.ceil(m.moveNumber / 2)}.`);
    parts.push(m.san);
  }
  parts.push(resultTag);

  return `${headerText}\n\n${parts.join(" ")}\n`;
}
