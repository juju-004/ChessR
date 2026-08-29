import { Resvg } from '@resvg/resvg-js';

// Bundled so this never depends on whatever fonts (if any) happen to be
// installed on the production container. resvg is told to use ONLY this
// file (loadSystemFonts: false) so rendering is identical in dev and on
// Railway regardless of the base image. DejaVu Sans is used for two
// different jobs below: its regular Latin glyphs for the card's text, and
// its "black" chess-symbol block (U+265A-265F, the solid/filled glyph
// shapes) for the pieces themselves, tinted per-color rather than relying
// on the separate "white" chess glyphs (U+2654-2659), which render as
// plain outlines with no fill in most fonts, including this one, and would
// leave White's and Black's pieces looking identical.
const FONT_PATH = new URL(
  '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf',
  import.meta.url,
).pathname;
const FONT_FAMILY = 'DejaVu Sans';

// Solid chess glyphs, keyed by FEN piece letter (uppercase = white, but the
// glyph itself is the same shape for both colors, see comment above).
const PIECE_GLYPH: Record<string, string> = {
  k: '\u265A',
  q: '\u265B',
  r: '\u265C',
  b: '\u265D',
  n: '\u265E',
  p: '\u265F',
};

interface ParsedSquare {
  file: number; // 0-7, a-h
  rank: number; // 0-7, rank 8 down to rank 1
  glyph: string;
  isWhite: boolean;
}

/** Parses just the piece-placement field of a FEN (the part before the
 *  first space) into a flat list of occupied squares. Works identically
 *  for a chess960 FEN, the piece-placement syntax is the same, only the
 *  starting arrangement differs. */
function parseFenPieces(fen: string): ParsedSquare[] {
  const placement = fen.split(' ')[0];
  const squares: ParsedSquare[] = [];
  const ranks = placement.split('/');
  ranks.forEach((rankStr, rankIndex) => {
    let file = 0;
    for (const ch of rankStr) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
        continue;
      }
      const lower = ch.toLowerCase();
      const glyph = PIECE_GLYPH[lower];
      if (glyph) {
        squares.push({ file, rank: rankIndex, glyph, isWhite: ch === ch.toUpperCase() });
      }
      file += 1;
    }
  });
  return squares;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Card layout ------------------------------------------------------------
//
// 1200x630 is the standard OG image size every crawler (WhatsApp, Facebook,
// Twitter/X, Discord, iMessage) expects; deviating from it risks an
// awkwardly cropped preview rather than an outright broken one, unlike a
// missing og:image entirely.
const CARD_W = 1200;
const CARD_H = 630;
const BOARD_SIZE = 512;
const SQUARE = BOARD_SIZE / 8;
const BOARD_X = 56;
const BOARD_Y = (CARD_H - BOARD_SIZE) / 2;

const LIGHT_SQUARE = '#EBECD0';
const DARK_SQUARE = '#739552';
const BG_TOP = '#14141a';
const BG_BOTTOM = '#0e0e13';
const TEXT_PRIMARY = '#f2f2f5';
const TEXT_MUTED = '#9a9aa5';
const BRAND_FROM = '#3b82f6';
const BRAND_TO = '#8b5cf6';

export interface BoardImageInput {
  fen: string;
  whiteName: string;
  /** Null while the game is still waiting for a second player, renders as
   *  a muted "Waiting for an opponent…" line instead of a bold second
   *  name, see getGameOgImage in og.controller.ts. */
  blackName: string | null;
  /** Short status line, e.g. "10+0 · Live now, move 12" or
   *  "10+0 · kingfish won by resignation in 34 moves". Wrapped onto up to
   *  two lines if it doesn't fit. */
  statusLine: string;
  /** Whether to badge the card as waiting/live/finished, drives the small
   *  pill above the status line. */
  badge: 'waiting' | 'live' | 'finished' | null;
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function renderBoardSquares(fen: string): string {
  let out = '';
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const isLight = (rank + file) % 2 === 0;
      const x = BOARD_X + file * SQUARE;
      const y = BOARD_Y + rank * SQUARE;
      out += `<rect x="${x}" y="${y}" width="${SQUARE}" height="${SQUARE}" fill="${isLight ? LIGHT_SQUARE : DARK_SQUARE}"/>`;
    }
  }
  const pieces = parseFenPieces(fen);
  for (const sq of pieces) {
    const cx = BOARD_X + sq.file * SQUARE + SQUARE / 2;
    const cy = BOARD_Y + sq.rank * SQUARE + SQUARE / 2;
    const fill = sq.isWhite ? '#fefefe' : '#2b2b2b';
    const stroke = sq.isWhite ? '#2b2b2b' : '#000000';
    const strokeWidth = sq.isWhite ? 2 : 0.75;
    out += `<text x="${cx}" y="${cy}" font-family="${FONT_FAMILY}" font-size="${SQUARE * 0.82}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" text-anchor="middle" dominant-baseline="central">${sq.glyph}</text>`;
  }
  return out;
}

function buildSvg(input: BoardImageInput): string {
  const board = renderBoardSquares(input.fen);
  const textX = BOARD_X + BOARD_SIZE + 56;
  const textMaxWidth = CARD_W - textX - 48;
  const maxChars = Math.floor(textMaxWidth / 15); // rough px-per-char at the status font size

  const badgePill =
    input.badge === 'waiting'
      ? `<rect x="${textX}" y="270" rx="12" ry="12" width="150" height="28" fill="#3f3f46"/><text x="${textX + 75}" y="289" font-family="${FONT_FAMILY}" font-size="15" font-weight="bold" fill="#facc15" text-anchor="middle" dominant-baseline="central">WAITING</text>`
      : input.badge === 'live'
        ? `<rect x="${textX}" y="270" rx="12" ry="12" width="72" height="28" fill="#22c55e"/><text x="${textX + 36}" y="289" font-family="${FONT_FAMILY}" font-size="15" font-weight="bold" fill="#052e12" text-anchor="middle" dominant-baseline="central">LIVE</text>`
        : input.badge === 'finished'
          ? `<rect x="${textX}" y="270" rx="12" ry="12" width="108" height="28" fill="#3f3f46"/><text x="${textX + 54}" y="289" font-family="${FONT_FAMILY}" font-size="15" font-weight="bold" fill="${TEXT_MUTED}" text-anchor="middle" dominant-baseline="central">FINISHED</text>`
          : '';

  const statusLines = wrapText(input.statusLine, maxChars);
  const statusY = 340;
  const statusTspans = statusLines
    .map((line, i) => `<tspan x="${textX}" dy="${i === 0 ? 0 : 34}">${escapeXml(line)}</tspan>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${BG_TOP}"/>
    <stop offset="1" stop-color="${BG_BOTTOM}"/>
  </linearGradient>
  <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${BRAND_FROM}"/>
    <stop offset="1" stop-color="${BRAND_TO}"/>
  </linearGradient>
</defs>
<rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>
${board}
<rect x="${BOARD_X}" y="${BOARD_Y}" width="${BOARD_SIZE}" height="${BOARD_SIZE}" fill="none" stroke="#000000" stroke-opacity="0.35" stroke-width="2"/>
<text x="${textX}" y="70" font-family="${FONT_FAMILY}" font-size="30" font-weight="bold" fill="url(#brand)">Chessr</text>
<text x="${textX}" y="140" font-family="${FONT_FAMILY}" font-size="34" font-weight="bold" fill="${TEXT_PRIMARY}">${escapeXml(input.whiteName)}</text>
${
  input.blackName === null
    ? `<text x="${textX}" y="188" font-family="${FONT_FAMILY}" font-size="22" fill="${TEXT_MUTED}">Waiting for an opponent…</text>`
    : `<text x="${textX}" y="178" font-family="${FONT_FAMILY}" font-size="20" fill="${TEXT_MUTED}">vs</text>
<text x="${textX}" y="216" font-family="${FONT_FAMILY}" font-size="34" font-weight="bold" fill="${TEXT_PRIMARY}">${escapeXml(input.blackName)}</text>`
}
${badgePill}
<text x="${textX}" y="${statusY}" font-family="${FONT_FAMILY}" font-size="22" fill="${TEXT_MUTED}">${statusTspans}</text>
</svg>`;
}

/** Renders a 1200x630 PNG for a game's current position, used as the
 *  og:image for a shared /game/:code link (see og.controller.ts). Cheap
 *  enough to render on every request (a handful of rects/text nodes, no
 *  network calls) that caching isn't needed for correctness, though the
 *  route layers on a Cache-Control header since the position for a
 *  finished game never changes again. */
export function renderGameBoardPng(input: BoardImageInput): Buffer {
  const svg = buildSvg(input);
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [FONT_PATH],
      loadSystemFonts: false,
      defaultFontFamily: FONT_FAMILY,
    },
  });
  return resvg.render().asPng();
}
