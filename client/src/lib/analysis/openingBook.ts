/**
 * Opening book lookup. The data (openingBook.data.ts) is generated from the
 * Lichess openings dataset by scripts/generate-opening-book.mjs: every
 * position reached along any named opening line, stored as a hash. A move is
 * "book" when the position it produces is in that set, so transpositions
 * count too.
 *
 * The data module is ~60 KB gzipped, so it is imported lazily, only when an
 * analysis page opens.
 */

// KEEP IN SYNC with cyrb53() in scripts/generate-opening-book.mjs.
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Placement + turn + castling only (en passant dropped, see the generator). */
export function bookKey(fen: string): string {
  return cyrb53(fen.split(" ").slice(0, 3).join(" ")).toString(36);
}

export type BookSet = Set<string>;

let cached: Promise<BookSet> | null = null;

export function loadOpeningBook(): Promise<BookSet> {
  cached ??= import("./openingBook.data.js").then((m) => new Set<string>(m.default));
  return cached;
}
