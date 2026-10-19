import { Chess } from "chess.js";
import type { LoadedGame } from "../../pages/AnalysisGame.js";

/** sessionStorage slot that hands a pasted PGN from /analysis to /analysis/pgn. */
export const PGN_STORAGE_KEY = "chessr:analysis:pgn";

/** Short stable hash, so the same PGN reuses its cached engine results. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Turns pasted PGN text into the same shape a saved game has. Throws an
 *  Error with a readable message when the text isn't a usable PGN. */
export function parsePgnGame(raw: string): LoadedGame {
  const pgn = raw.trim();
  if (!pgn) throw new Error("Paste a PGN first.");

  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    throw new Error("That doesn't look like a valid PGN. Check it and try again.");
  }

  const headers = chess.getHeaders() as Record<string, string | null | undefined>;
  const history = chess.history({ verbose: true });
  if (history.length === 0) throw new Error("This PGN has no moves.");

  const name = (v: string | null | undefined, fallback: string) => {
    const t = (v ?? "").trim();
    return t && t !== "?" ? t : fallback;
  };

  return {
    _id: `pgn-${hash(pgn)}`,
    variant: "standard",
    initialFen: headers.FEN || undefined,
    status: "finished",
    white: { _id: "pgn-white", username: name(headers.White, "White") },
    black: { _id: "pgn-black", username: name(headers.Black, "Black") },
    moves: history.map((m) => ({
      san: m.san,
      from: m.from,
      to: m.to,
      promotion: m.promotion,
      fenAfter: m.after,
    })),
  };
}
