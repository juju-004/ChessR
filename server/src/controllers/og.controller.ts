import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getGameByCode } from '../services/game.service.js';
import { getTournamentByCode } from '../services/tournament.service.js';
import { renderGameBoardPng } from '../services/boardImage.service.js';
import { env } from '../config/env.js';

const codeParamSchema = z.object({ code: z.string().min(4).max(10) });

function formatTimeControl(tc: { baseSeconds: number | null; incrementSeconds: number }): string {
  if (tc.baseSeconds === null) return 'Unlimited';
  return `${Math.round(tc.baseSeconds / 60)}+${tc.incrementSeconds}`;
}

// Shared by describeGame (the text description) and getGameOgImage (the
// board PNG), both need the same names/time-control/status pieces, this is
// the one place that assembles them from a raw game doc.
function gameCardInfo(game: Awaited<ReturnType<typeof getGameByCode>>) {
  const tc = formatTimeControl(game.timeControl);
  // game.moves is a ply log (one entry per half-move), fine for the
  // === 0 "hasn't started" check below, but the number shown to a person
  // needs to be the actual chess move count, which only increments once
  // per full move pair (halved, rounding up so a game that ends on
  // White's move still reports that move rather than truncating it away).
  const plyCount = game.moves.length;
  const moveCount = Math.ceil(plyCount / 2);
  const whiteName = (game.white as any)?.username ?? 'White';
  const blackName = (game.black as any)?.username ?? 'Black';
  const isLive = game.status !== 'finished' && game.status !== 'aborted';

  let statusLine: string;
  if (isLive) {
    statusLine = plyCount === 0 ? `${tc} · about to start` : `${tc} · live now, move ${moveCount}`;
  } else {
    const outcome =
      game.result === 'draw'
        ? 'Draw'
        : game.result === 'white'
          ? `${whiteName} won`
          : game.result === 'black'
            ? `${blackName} won`
            : 'Game aborted';
    const reason = game.endReason ? ` by ${game.endReason.replace(/_/g, ' ')}` : '';
    statusLine = `${tc} · ${outcome}${reason} in ${moveCount} moves`;
  }

  return { whiteName, blackName, statusLine, isLive, tc };
}

function describeGame(game: Awaited<ReturnType<typeof getGameByCode>>): string {
  const { whiteName, blackName, statusLine } = gameCardInfo(game);
  return `${whiteName} vs ${blackName} · ${statusLine}`;
}

function describeTournament(tournament: Awaited<ReturnType<typeof getTournamentByCode>>): string {
  const tc =
    tournament.baseMinutes === null
      ? 'Unlimited'
      : `${tournament.baseMinutes}+${tournament.incrementSeconds}`;
  const formatLabel: Record<string, string> = {
    normal: 'Knockout',
    swiss: 'Swiss',
    robin: 'Round robin',
    round_robin: 'Round robin',
    arena: 'Arena',
  };
  const format = formatLabel[tournament.format] ?? tournament.format;
  const count = tournament.players.length;
  const playerWord = count === 1 ? 'player' : 'players';

  if (tournament.status === 'cancelled') {
    return `${tournament.name} · ${format} · ${tc} · cancelled`;
  }
  if (tournament.status === 'finished') {
    // 'normal' (knockout) tracks the winner via elimination round, not
    // points (points are meaningless there, see ITournamentPlayer's
    // doc comment), the eventual winner is whoever was never eliminated.
    const winner =
      tournament.format === 'normal'
        ? tournament.players.find((p) => p.eliminatedRound === null)
        : [...tournament.players].sort((a, b) => b.points - a.points)[0];
    const winnerLine = winner ? ` · won by ${winner.username}` : '';
    return `${tournament.name} · ${format} · ${tc}${winnerLine}`;
  }
  if (tournament.status === 'active') {
    return `${tournament.name} · ${format} · ${tc} · live now · ${count} ${playerWord}`;
  }
  return `${tournament.name} · ${format} · ${tc} · ${count} ${playerWord} registered`;
}

// Escapes text dropped into an HTML attribute/body, this is the one place
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

// CLIENT_URL is the *frontend's* origin (e.g. the Vercel deployment), the
// canonical/og:url below must point there, not at this API server, since
// that's the URL people actually share and click.
const CLIENT_URL = process.env.CLIENT_URL ?? env.CLIENT_ORIGIN;

// This API server's OWN public origin, og:image needs a fully-qualified URL
// a crawler can fetch directly, and the image itself is served by this
// server (see app.ts's express.static mount), not the frontend.
const API_ORIGIN = env.API_ORIGIN ?? `http://localhost:${env.PORT}`;
const DEFAULT_OG_IMAGE = `${API_ORIGIN}/og-default.png`;

interface PreviewCardInput {
  title: string;
  description: string;
  url: string;
  /** Fully-qualified image URL. Defaults to DEFAULT_OG_IMAGE when omitted
   *  (tournaments, and games that fail to load). */
  image?: string;
}

/**
 * Renders a minimal static HTML page with Open Graph / Twitter Card tags, 
 * e.g. "kingfish vs mira · 10+0 · kingfish won by resignation in 34 moves"
 *, for link-preview crawlers (WhatsApp, Facebook, Twitter/X, Discord,
 * iMessage) that don't execute JavaScript and so can never see anything
 * from the actual React app.
 *
 * og:image is REQUIRED, not optional decoration, several crawlers
 * (WhatsApp chief among them) simply render no preview card at all,
 * title/description included, when a page has no image to show. That was
 * the actual cause of "pasting a game link into WhatsApp shows nothing":
 * every tag here was already correct except this one was missing entirely.
 * A game card's og:image now points at getGameOgImage below, a real
 * per-game board-position PNG (see boardImage.service.ts), same idea as
 * Lichess's link previews. Tournament cards, and games that fail to load,
 * still fall back to the static branded DEFAULT_OG_IMAGE.
 *
 * This alone isn't sufficient to make a shared /game/:code or
 * /tournaments/:code link show a rich preview, those links are served by
 * the *frontend's* origin, not this API. Something on the frontend's side
 * (a Vercel Edge Middleware rewrite, for example) needs to detect crawler
 * requests and route them here instead of the SPA shell. See
 * client/middleware.ts.
 */
function renderPreviewPage({ title, description, url, image }: PreviewCardInput): string {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const imageUrl = image ?? DEFAULT_OG_IMAGE;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<meta name="description" content="${safeDescription}">
<meta property="og:type" content="website">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDescription}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDescription}">
<meta name="twitter:image" content="${imageUrl}">
<meta http-equiv="refresh" content="0; url=${url}">
</head>
<body>
<p>${safeDescription}</p>
<p><a href="${url}">Open this on Chessr</a></p>
</body>
</html>`;
}

export const getGameOgCard = asyncHandler(async (req, res) => {
  const { code } = codeParamSchema.parse(req.params);

  let description: string;
  let image: string | undefined;
  try {
    const game = await getGameByCode(code);
    description = describeGame(game as any);
    image = `${API_ORIGIN}/api/games/code/${encodeURIComponent(code)}/card-image.png`;
  } catch {
    description = 'A chess game on Chessr.';
  }

  const html = renderPreviewPage({
    title: `Chessr · Game ${code.toUpperCase()}`,
    description,
    url: `${CLIENT_URL}/game/${encodeURIComponent(code)}`,
    image,
  });

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

/** The actual per-game board-position PNG referenced by getGameOgCard's
 *  og:image, kept as its own route (rather than inlined as a data URI)
 *  since crawlers fetch og:image as a plain, separately-cacheable request,
 *  same as they would any other <img src>. Falls back to a redirect to the
 *  static default image on any error, so a bad/unknown code still resolves
 *  to *something* fetchable rather than a broken image icon in the
 *  preview. */
export const getGameOgImage = asyncHandler(async (req, res) => {
  const { code } = codeParamSchema.parse(req.params);

  let game: Awaited<ReturnType<typeof getGameByCode>>;
  try {
    game = await getGameByCode(code);
  } catch {
    return res.redirect(302, DEFAULT_OG_IMAGE);
  }

  const { whiteName, blackName, statusLine, isLive } = gameCardInfo(game);
  const png = renderGameBoardPng({
    fen: game.fen,
    whiteName,
    blackName,
    statusLine,
    badge: isLive ? 'live' : 'finished',
  });

  // A finished game's position never changes again, cache it hard. A live
  // game's does, on every move, so crawlers/clients should always refetch
  // rather than showing a stale position (WhatsApp in particular tends to
  // cache the very first preview it ever sees for a URL regardless of
  // headers, but that's a WhatsApp-side limitation, not something a
  // Cache-Control header here can work around).
  res.set('Cache-Control', game.status === 'finished' || game.status === 'aborted' ? 'public, max-age=31536000, immutable' : 'public, max-age=30');
  res.set('Content-Type', 'image/png');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(png);
});

export const getTournamentOgCard = asyncHandler(async (req, res) => {
  const { code } = codeParamSchema.parse(req.params);

  let title = `Chessr · Tournament ${code.toUpperCase()}`;
  let description = 'A chess tournament on Chessr.';
  try {
    const tournament = await getTournamentByCode(code);
    title = `Chessr · ${tournament.name}`;
    description = describeTournament(tournament as any);
  } catch {
    // Fall back to the generic copy above, an unknown/deleted code should
    // still produce a valid (if generic) preview rather than a broken page.
  }

  const html = renderPreviewPage({
    title,
    description,
    url: `${CLIENT_URL}/tournaments/${encodeURIComponent(code)}`,
  });

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});
