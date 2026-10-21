/**
 * Crazyhouse rules engine, layered on top of chess.js.
 *
 * Shared verbatim between the server (server/src/services/crazyhouse.ts) and
 * the client (client/src/crazyhouse.ts): keep the two files identical.
 *
 * chess.js knows nothing about pockets or drops, so a Crazyhouse position is
 * stored as an *extended FEN* (the same convention Lichess uses):
 *
 *   rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[Qp] w KQkq - 0 1
 *
 *  - `[...]` after the piece placement is the pockets: uppercase letters are
 *    White's pocket, lowercase are Black's.
 *  - `~` after a piece marks one that was promoted from a pawn (it turns back
 *    into a pawn if captured).
 *
 * Everything chess.js can do (move generation, check detection, castling,
 * en passant) runs on the "clean" FEN with both of those stripped out.
 */
import { Chess } from 'chess.js';

export type ZhRole = 'p' | 'n' | 'b' | 'r' | 'q';
export type ZhColor = 'w' | 'b';

/** Pocket display order: most valuable first. */
export const ZH_ROLES: readonly ZhRole[] = ['q', 'r', 'b', 'n', 'p'];

export type Pocket = Record<ZhRole, number>;
export interface Pockets {
  w: Pocket;
  b: Pocket;
}

export const ZH_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[] w KQkq - 0 1';

const FILES = 'abcdefgh';

const emptyPocket = (): Pocket => ({ p: 0, n: 0, b: 0, r: 0, q: 0 });
export const emptyPockets = (): Pockets => ({ w: emptyPocket(), b: emptyPocket() });

export function sqIndex(sq: string): number {
  // 0 = a8 ... 63 = h1 (FEN reading order)
  const file = FILES.indexOf(sq[0]);
  const rank = Number(sq[1]);
  return (8 - rank) * 8 + file;
}
export function indexSq(i: number): string {
  return FILES[i % 8] + String(8 - Math.floor(i / 8));
}

export interface ZhParsed {
  /** FEN chess.js can load: no pockets, no `~`. */
  clean: string;
  pockets: Pockets;
  /** Squares holding a piece that was promoted from a pawn. */
  promoted: Set<string>;
}

export function parseZhFen(fen: string): ZhParsed {
  const sp = fen.indexOf(' ');
  const head = sp === -1 ? fen : fen.slice(0, sp);
  const tail = sp === -1 ? '' : fen.slice(sp);

  let placement = head;
  const pockets = emptyPockets();
  const br = head.indexOf('[');
  if (br !== -1) {
    placement = head.slice(0, br);
    const end = head.indexOf(']', br);
    const inside = head.slice(br + 1, end === -1 ? undefined : end);
    for (const ch of inside) {
      const lower = ch.toLowerCase() as ZhRole;
      if (!ZH_ROLES.includes(lower)) continue;
      pockets[ch === lower ? 'b' : 'w'][lower] += 1;
    }
  }

  const promoted = new Set<string>();
  let clean = '';
  let rank = 8;
  let file = 0;
  for (const ch of placement) {
    if (ch === '~') {
      // marks the piece just before it
      promoted.add(FILES[file - 1] + String(rank));
      continue;
    }
    clean += ch;
    if (ch === '/') {
      rank -= 1;
      file = 0;
    } else if (ch >= '1' && ch <= '8') {
      file += Number(ch);
    } else {
      file += 1;
    }
  }
  return { clean: clean + tail, pockets, promoted };
}

function pocketString(p: Pockets): string {
  let s = '';
  for (const r of ZH_ROLES) s += r.toUpperCase().repeat(p.w[r]);
  for (const r of ZH_ROLES) s += r.repeat(p.b[r]);
  return s;
}

/** Re-attaches pockets and `~` markers to a clean FEN. */
export function buildZhFen(clean: string, pockets: Pockets, promoted: Set<string>): string {
  const sp = clean.indexOf(' ');
  const placement = sp === -1 ? clean : clean.slice(0, sp);
  const tail = sp === -1 ? '' : clean.slice(sp);

  const rows = placement.split('/');
  const outRows: string[] = [];
  for (let r = 0; r < 8; r++) {
    const rank = 8 - r;
    let out = '';
    let file = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') {
        out += ch;
        file += Number(ch);
      } else {
        out += ch;
        if (promoted.has(FILES[file] + String(rank))) out += '~';
        file += 1;
      }
    }
    outRows.push(out);
  }
  return `${outRows.join('/')}[${pocketString(pockets)}]${tail}`;
}

export function zhTurn(fen: string): ZhColor {
  const parts = fen.split(' ');
  return parts[1] === 'b' ? 'b' : 'w';
}

/** Board as 64 chars (index 0 = a8), '' for empty. */
function boardArray(clean: string): string[] {
  const placement = clean.split(' ')[0];
  const out: string[] = [];
  for (const ch of placement) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') for (let i = 0; i < Number(ch); i++) out.push('');
    else out.push(ch);
  }
  return out;
}

function boardToPlacement(b: string[]): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const c = b[r * 8 + f];
      if (!c) empty += 1;
      else {
        if (empty) row += String(empty);
        empty = 0;
        row += c;
      }
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return rows.join('/');
}

export interface ZhMoveInput {
  from?: string;
  to: string;
  promotion?: string;
  /** Drop a piece of this role from the mover's pocket onto `to`. */
  drop?: ZhRole;
}

export interface ZhAppliedMove {
  /** New extended FEN. */
  fen: string;
  san: string;
  from: string;
  to: string;
  promotion?: string;
  drop?: ZhRole;
  color: ZhColor;
  /** Role that went into the mover's pocket, if this move captured. */
  captured?: ZhRole;
}

export type ZhEnd =
  | { result: 'white' | 'black'; reason: 'checkmate' }
  | { result: 'draw'; reason: 'stalemate' | 'insufficient_material' };

function isRoleLetter(x: string): x is ZhRole {
  return x === 'p' || x === 'n' || x === 'b' || x === 'r' || x === 'q';
}

/** Is the side to move in check? (clean FEN) */
function inCheckClean(clean: string): boolean {
  try {
    return new Chess(clean).isCheck();
  } catch {
    return false;
  }
}

/** Probe FEN: `clean` with `role` of `color` placed on `sq`, same side to
 *  move, no en passant (chess.js rejects some ep targets once a piece lands
 *  on them, and a drop can't be an ep capture anyway). */
function probeFen(clean: string, color: ZhColor, role: ZhRole, sq: string): string {
  const parts = clean.split(' ');
  const b = boardArray(clean);
  b[sqIndex(sq)] = color === 'w' ? role.toUpperCase() : role;
  parts[0] = boardToPlacement(b);
  parts[3] = '-';
  return parts.join(' ');
}

function isLegalDropSquare(clean: string, color: ZhColor, sq: string, role: ZhRole): boolean {
  const b = boardArray(clean);
  if (b[sqIndex(sq)]) return false;
  if (role === 'p' && (sq[1] === '1' || sq[1] === '8')) return false;
  return !inCheckClean(probeFen(clean, color, role, sq));
}

/** Squares the side to move may drop `role` on (ignores pocket contents). */
export function legalDropSquares(fen: string, role: ZhRole): string[] {
  const { clean } = parseZhFen(fen);
  const color = zhTurn(fen);
  const b = boardArray(clean);
  const check = inCheckClean(clean);
  const out: string[] = [];
  for (let i = 0; i < 64; i++) {
    if (b[i]) continue;
    const sq = indexSq(i);
    if (role === 'p' && (sq[1] === '1' || sq[1] === '8')) continue;
    // A drop can never expose the mover's own king, so when not in check
    // every empty square is fine; only a check needs the (slower) probe.
    if (!check || !inCheckClean(probeFen(clean, color, role, sq))) out.push(sq);
  }
  return out;
}

/** Roles the side to move can drop at all right now. */
export function droppableRoles(fen: string): ZhRole[] {
  const { pockets } = parseZhFen(fen);
  const mine = pockets[zhTurn(fen)];
  return ZH_ROLES.filter((r) => mine[r] > 0 && legalDropSquares(fen, r).length > 0);
}

/** Map from-square -> destinations for ordinary (non-drop) moves. */
export function zhDests(fen: string): Map<string, string[]> {
  const { clean } = parseZhFen(fen);
  const dests = new Map<string, string[]>();
  for (const m of new Chess(clean).moves({ verbose: true })) {
    const arr = dests.get(m.from) ?? [];
    if (!arr.includes(m.to)) arr.push(m.to);
    dests.set(m.from, arr);
  }
  return dests;
}

export function zhInCheck(fen: string): boolean {
  return inCheckClean(parseZhFen(fen).clean);
}

function hasAnyDrop(fen: string): boolean {
  const { pockets } = parseZhFen(fen);
  const mine = pockets[zhTurn(fen)];
  for (const r of ZH_ROLES) {
    if (mine[r] > 0 && legalDropSquares(fen, r).length > 0) return true;
  }
  return false;
}

/** Game-ending condition of a position, or null if play continues.
 *  No fifty-move rule here (captured pieces keep the game alive) and
 *  threefold repetition is the caller's job, as it needs history. */
export function zhOutcome(fen: string): ZhEnd | null {
  const { clean, pockets } = parseZhFen(fen);
  const chess = new Chess(clean);
  const noMoves = chess.moves().length === 0;
  if (noMoves && !hasAnyDrop(fen)) {
    if (chess.isCheck()) {
      // side to move is mated, the other side wins
      return { result: chess.turn() === 'w' ? 'black' : 'white', reason: 'checkmate' };
    }
    return { result: 'draw', reason: 'stalemate' };
  }
  // Only the two kings left on the board and nothing in either pocket.
  const total = pocketTotal(pockets.w) + pocketTotal(pockets.b);
  if (total === 0 && boardArray(clean).filter(Boolean).length === 2) {
    return { result: 'draw', reason: 'insufficient_material' };
  }
  return null;
}

function pocketTotal(p: Pocket): number {
  return p.p + p.n + p.b + p.r + p.q;
}

function suffixFor(fen: string): '' | '+' | '#' {
  const end = zhOutcome(fen);
  if (end && end.reason === 'checkmate') return '#';
  return zhInCheck(fen) ? '+' : '';
}

/**
 * Applies a move or drop. Returns null when it is illegal.
 */
export function zhApply(fen: string, input: ZhMoveInput): ZhAppliedMove | null {
  const { clean, pockets, promoted } = parseZhFen(fen);
  const color = zhTurn(fen);
  const pk: Pockets = { w: { ...pockets.w }, b: { ...pockets.b } };

  // ---------- drop ----------
  if (input.drop) {
    const role = input.drop;
    if (!isRoleLetter(role)) return null;
    if (pk[color][role] <= 0) return null;
    if (!isLegalDropSquare(clean, color, input.to, role)) return null;

    pk[color][role] -= 1;
    const parts = clean.split(' ');
    const b = boardArray(clean);
    b[sqIndex(input.to)] = color === 'w' ? role.toUpperCase() : role;
    parts[0] = boardToPlacement(b);
    parts[1] = color === 'w' ? 'b' : 'w';
    parts[3] = '-';
    parts[4] = '0';
    if (color === 'b') parts[5] = String(Number(parts[5]) + 1);
    const newFen = buildZhFen(parts.join(' '), pk, promoted);
    const san = `${role.toUpperCase()}@${input.to}`;
    return {
      fen: newFen,
      san: san + suffixFor(newFen),
      from: input.to,
      to: input.to,
      drop: role,
      color,
    };
  }

  // ---------- ordinary move ----------
  if (!input.from) return null;
  const chess = new Chess(clean);
  let m;
  try {
    m = chess.move({ from: input.from, to: input.to, promotion: input.promotion });
  } catch {
    return null;
  }
  if (!m) return null;

  const nextPromoted = new Set(promoted);
  const movedWasPromoted = nextPromoted.delete(m.from);

  let captured: ZhRole | undefined;
  if (m.captured) {
    // a capture on a square holding a promoted piece yields a pawn
    const capSq = m.flags.includes('e')
      ? m.to[0] + (color === 'w' ? String(Number(m.to[1]) - 1) : String(Number(m.to[1]) + 1))
      : m.to;
    const wasPromoted = nextPromoted.delete(capSq);
    captured = wasPromoted ? 'p' : (m.captured as ZhRole);
    pk[color][captured] += 1;
  }
  if (m.promotion || movedWasPromoted) nextPromoted.add(m.to);

  const newFen = buildZhFen(chess.fen(), pk, nextPromoted);
  const base = m.san.replace(/[+#]$/, '');
  return {
    fen: newFen,
    san: base + suffixFor(newFen),
    from: m.from,
    to: m.to,
    ...(m.promotion ? { promotion: m.promotion } : {}),
    color,
    ...(captured ? { captured } : {}),
  };
}

/** Repetition key: placement (with `~`), pockets, side to move, castling, ep. */
export function zhRepetitionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}
