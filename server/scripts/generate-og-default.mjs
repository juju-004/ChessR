// Regenerates server/public/og-default.png, the static fallback preview
// image used by getGameOgCard/getTournamentOgCard (see og.controller.ts)
// whenever there's no per-game board PNG to show (tournaments, and games
// that fail to load). Styled to echo client/public/logo.png's gradient
// "Chess·R" wordmark and crown accent, and the same dark/checkerboard
// background as the per-game cards (see boardImage.service.ts), so every
// OG image on the site reads as one visual family.
//
// Not wired into any request path, this is a one-off asset generator, run
// by hand whenever the branding changes:
//   cd server && node scripts/generate-og-default.mjs
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_PATH = path.join(__dirname, '../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');
const FONT_FAMILY = 'DejaVu Sans';
const OUT_PATH = path.join(__dirname, '../public/og-default.png');

const CARD_W = 1200;
const CARD_H = 630;
const BG_TOP = '#14141a';
const BG_BOTTOM = '#0e0e13';
const TEXT_MUTED = '#9a9aa5';
// Sampled from client/public/logo.png's wordmark gradient (blue -> purple).
const BRAND_FROM = '#3f7bfa';
const BRAND_TO = '#a13bde';
const CROWN_GOLD = '#d8a941';

// Faint checkerboard, bottom-right, same treatment as the per-game card
// (boardImage.service.ts) so the two OG images read as one family.
function checkerboard() {
  const size = 60;
  const cols = 8;
  const rows = 6;
  const startX = CARD_W - cols * size - 40;
  const startY = CARD_H - rows * size - 40;
  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2 !== 0) continue;
      out += `<rect x="${startX + c * size}" y="${startY + r * size}" width="${size}" height="${size}" fill="#ffffff" fill-opacity="0.035"/>`;
    }
  }
  return out;
}

// A simple 3-peak crown (two shorter outer peaks, one taller center peak),
// echoing the small gold crown in the client wordmark (logo.png) without
// trying to pixel-match it.
function crown(x, y, w, h) {
  const base = y + h;
  const valleyY = y + h * 0.42;
  const outerPeakY = y + h * 0.05;
  const centerPeakY = y;
  const p = [
    [x, base],
    [x, valleyY],
    [x + w * 0.18, outerPeakY],
    [x + w * 0.35, valleyY],
    [x + w * 0.5, centerPeakY],
    [x + w * 0.65, valleyY],
    [x + w * 0.82, outerPeakY],
    [x + w, valleyY],
    [x + w, base],
  ];
  const d = p.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt[0]} ${pt[1]}`).join(' ') + ' Z';
  return `<path d="${d}" fill="${CROWN_GOLD}" stroke="${CROWN_GOLD}" stroke-width="1.5" stroke-linejoin="round"/>`;
}

function buildSvg() {
  const wordmarkY = 330;
  const wordmarkSize = 130;
  // Rough width estimate for a bold 130px "Chess", just enough to place
  // the crown/"R" after it without a real text-measuring pass (resvg
  // doesn't expose one ahead of render).
  const chessWidth = 430;
  const wordmarkX = 90;
  const rX = wordmarkX + chessWidth + 18;
  const crownW = 44;
  const crownH = 32;
  const crownX = rX + 26;
  const crownY = wordmarkY - wordmarkSize * 1.0;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${BG_TOP}"/>
    <stop offset="1" stop-color="${BG_BOTTOM}"/>
  </linearGradient>
  <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${BRAND_FROM}"/>
    <stop offset="1" stop-color="${BRAND_TO}"/>
  </linearGradient>
</defs>
<rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>
${checkerboard()}
<text x="${wordmarkX}" y="${wordmarkY}" font-family="${FONT_FAMILY}" font-size="${wordmarkSize}" font-weight="bold" fill="url(#brand)">Chess</text>
${crown(crownX, crownY, crownW, crownH)}
<text x="${rX}" y="${wordmarkY}" font-family="${FONT_FAMILY}" font-size="${wordmarkSize}" font-weight="bold" fill="url(#brand)">R</text>
<text x="${wordmarkX}" y="${wordmarkY + 70}" font-family="${FONT_FAMILY}" font-size="30" fill="${TEXT_MUTED}">Real-time multiplayer chess</text>
</svg>`;
}

const resvg = new Resvg(buildSvg(), {
  font: {
    fontFiles: [FONT_PATH],
    loadSystemFonts: false,
    defaultFontFamily: FONT_FAMILY,
  },
});
const png = resvg.render().asPng();
writeFileSync(OUT_PATH, png);
console.log(`wrote ${OUT_PATH} (${png.length} bytes)`);
