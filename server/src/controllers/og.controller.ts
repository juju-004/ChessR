import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getGameByCode } from '../services/game.service.js';

const codeParamSchema = z.object({ code: z.string().min(4).max(10) });

function formatTimeControl(tc: { baseSeconds: number | null; incrementSeconds: number }): string {
  if (tc.baseSeconds === null) return 'Unlimited';
  return `${Math.round(tc.baseSeconds / 60)}+${tc.incrementSeconds}`;
}

function describeGame(game: Awaited<ReturnType<typeof getGameByCode>>): string {
  const tc = formatTimeControl(game.timeControl);
  // game.moves is a ply log (one entry per half-move) — fine for the
  // === 0 "hasn't started" check below, but the number shown to a person
  // needs to be the actual chess move count, which only increments once
  // per full move pair (halved, rounding up so a game that ends on
  // White's move still reports that move rather than truncating it away).
  const plyCount = game.moves.length;
  const moveCount = Math.ceil(plyCount / 2);
  const whiteName = (game.white as any)?.username ?? 'White';
  const blackName = (game.black as any)?.username ?? 'Black';

  if (game.status !== 'finished' && game.status !== 'aborted') {
    return plyCount === 0
      ? `${whiteName} vs ${blackName} · ${tc} · about to start`
      : `${whiteName} vs ${blackName} · ${tc} · live now, move ${moveCount}`;
  }

  const outcome =
    game.result === 'draw'
      ? 'Draw'
      : game.result === 'white'
        ? `${whiteName} won`
        : game.result === 'black'
          ? `${blackName} won`
          : 'Game aborted';
  const reason = game.endReason ? ` by ${game.endReason.replace(/_/g, ' ')}` : '';
  return `${whiteName} vs ${blackName} · ${tc} · ${outcome}${reason} in ${moveCount} moves`;
}

// Escapes text dropped into an HTML attribute/body — this is the one place
// in the app assembling raw HTML by hand (everywhere else is React), so it
// needs its own escaping rather than relying on JSX's automatic escaping.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// CLIENT_URL is the *frontend's* origin (e.g. the Vercel deployment) — the
// canonical/og:url below must point there, not at this API server, since
// that's the URL people actually share and click.
const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173';

/**
 * Renders a minimal static HTML page with Open Graph / Twitter Card tags
 * describing a game — e.g. "kingfish vs mira · 10+0 · kingfish won by
 * resignation in 34 moves" — for link-preview crawlers (WhatsApp, Facebook,
 * Twitter/X, Discord, iMessage) that don't execute JavaScript and so can
 * never see anything from the actual React app.
 *
 * This alone isn't sufficient to make a shared /game/:code link show a
 * rich preview — that link is served by the *frontend's* origin, not this
 * API. Something on the frontend's side (a Vercel Edge Middleware rewrite,
 * for example) needs to detect crawler requests to /game/:code and
 * /replay/:code and route them here instead of the SPA shell. See
 * client/middleware.ts.
 */
export const getGameOgCard = asyncHandler(async (req, res) => {
  const { code } = codeParamSchema.parse(req.params);

  let description: string;
  try {
    const game = await getGameByCode(code);
    description = describeGame(game as any);
  } catch {
    description = 'A chess game on ChessR.';
  }

  const title = `ChessR · Game ${escapeHtml(code.toUpperCase())}`;
  const url = `${CLIENT_URL}/game/${encodeURIComponent(code)}`;
  const safeDescription = escapeHtml(description);

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${safeDescription}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${safeDescription}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${safeDescription}">
<meta http-equiv="refresh" content="0; url=${url}">
</head>
<body>
<p>${safeDescription}</p>
<p><a href="${url}">Open this game on ChessR</a></p>
</body>
</html>`);
});
