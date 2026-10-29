/**
 * Turns a lazily-loaded piece set from vector art into small bitmaps.
 *
 * Why: every set except "classic" ships as SVG data-URIs inside CSS
 * (styles/pieces-*.css). An SVG background has to be parsed and rasterised by
 * the browser before it can be painted, and those sets are far heavier than
 * classic (mono is 2048-unit paths, contrast is gradient-heavy). The cost lands
 * on the main thread exactly when a piece first appears, or whenever the
 * browser decides to re-rasterise it, which is what made the board stutter
 * while pieces slid. A small PNG is just a texture upload.
 *
 * How: once a set's stylesheet is in, find its twelve `piece.<role>.<color>`
 * rules, draw each SVG onto a canvas ONE time, and add override rules that
 * point the same selectors at the resulting blob: URLs. The original SVG rules
 * stay in place as the fallback, so if anything here fails (old browser,
 * blocked canvas, no cssRules access) the set simply keeps rendering from SVG
 * exactly as before.
 */

/** Bitmap edge in pixels. Squares are at most ~100 CSS px on the biggest
 *  boards; 192 stays sharp on retina phones and is still only ~150 KB of
 *  memory per piece. */
const SIZE = 192;

const BG_URL = /url\(\s*["']?(.*?)["']?\s*\)/;

const started = new Set<string>();

/** The twelve piece rules of one set that are already loaded in the page. */
function pieceRulesFor(theme: string): CSSStyleRule[] {
  const prefix = `.piece-theme-${theme} .cg-wrap piece.`;
  const found: CSSStyleRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules; // throws for a cross-origin sheet
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText.startsWith(prefix)) found.push(rule);
    }
  }
  return found;
}

async function toBitmapUrl(svgUrl: string): Promise<string> {
  const img = new Image();
  img.decoding = 'async';
  img.src = svgUrl;
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  // Explicit destination size: some of the sets declare no intrinsic size.
  ctx.drawImage(img, 0, 0, SIZE, SIZE);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('canvas.toBlob returned nothing');
  const url = URL.createObjectURL(blob);

  // Decode the bitmap now, off the critical path, so the first time a piece
  // is painted there is nothing left to decode.
  const warm = new Image();
  warm.src = url;
  await warm.decode().catch(() => {});
  return url;
}

/**
 * Call once a piece set's stylesheet has loaded. Safe to call repeatedly and
 * for sets that have no rules (classic): it never throws and does nothing
 * twice.
 */
export async function rasterizePieceTheme(theme: string): Promise<void> {
  if (started.has(theme) || typeof document === 'undefined') return;
  // The stylesheet can be a beat behind the import promise (dev server, slow
  // link), so look for its rules a few times before giving up.
  let rules = pieceRulesFor(theme);
  for (let attempt = 0; rules.length === 0 && attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    rules = pieceRulesFor(theme);
  }
  if (rules.length === 0 || started.has(theme)) return;
  started.add(theme);

  try {
    const overrides = await Promise.all(
      rules.map(async (rule) => {
        const match = BG_URL.exec(rule.style.backgroundImage);
        if (!match) return null;
        const bitmap = await toBitmapUrl(match[1]);
        // `:root` raises specificity so this wins however the sheets are ordered.
        return `:root ${rule.selectorText}{background-image:url("${bitmap}")}`;
      }),
    );
    const css = overrides.filter((r): r is string => r !== null).join('\n');
    if (!css) return;
    const style = document.createElement('style');
    style.dataset.pieceRaster = theme;
    style.textContent = css;
    document.head.appendChild(style);
  } catch {
    // Keep the SVG rules; allow a later selection to try again.
    started.delete(theme);
  }
}
