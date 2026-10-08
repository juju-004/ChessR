import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getGameByCode } from "../services/game.service.js";
import { getTournamentByCode } from "../services/tournament.service.js";
import { getCageMatchByCode, resolveCageInviteLink } from "../services/cageMatch.service.js";
import { redis } from "../config/redis.js";
import { User } from "../models/User.js";
import { env } from "../config/env.js";

const codeParamSchema = z.object({ code: z.string().min(4).max(10) });

function formatTimeControl(tc: {
  baseSeconds: number | null;
  incrementSeconds: number;
}): string {
  if (tc.baseSeconds === null) return "Unlimited";
  return `${Math.round(tc.baseSeconds / 60)}+${tc.incrementSeconds}`;
}

// Assembles the names/time-control/status pieces used by describeGame's
// text description, from a raw game doc.
function gameCardInfo(game: Awaited<ReturnType<typeof getGameByCode>>) {
  const tc = formatTimeControl(game.timeControl);
  // game.moves is a ply log (one entry per half-move), fine for the
  // === 0 "hasn't started" check below, but the number shown to a person
  // needs to be the actual chess move count, which only increments once
  // per full move pair (halved, rounding up so a game that ends on
  // White's move still reports that move rather than truncating it away).
  const plyCount = game.moves.length;
  const moveCount = Math.ceil(plyCount / 2);
  const whiteName = (game.white as any)?.username ?? "White";
  // Nobody's joined the black side yet. This used to fall through to the
  // "?? 'Black'" default below regardless, which made an empty, just-
  // created game read as "<creator> vs Black · about to start" — as if
  // a real second player named "Black" existed and the game was seconds
  // from starting, when actually it's just sitting open waiting for
  // literally anyone to join. blackName stays null in that case so
  // describeGame reads as "looking for an opponent" instead of naming a
  // fake second player.
  const isWaiting = game.status === "waiting" && !game.black;
  const blackName = isWaiting ? null : ((game.black as any)?.username ?? "Black");
  const isLive = !isWaiting && game.status !== "finished" && game.status !== "aborted";

  let statusLine: string;
  if (isWaiting) {
    statusLine = `${tc} · waiting for an opponent`;
  } else if (isLive) {
    statusLine =
      plyCount === 0
        ? `${tc} · about to start`
        : `${tc} · live now, move ${moveCount}`;
  } else {
    const outcome =
      game.result === "draw"
        ? "Draw"
        : game.result === "white"
          ? `${whiteName} won`
          : game.result === "black"
            ? `${blackName} won`
            : "Game aborted";
    const reason = game.endReason
      ? ` by ${game.endReason.replace(/_/g, " ")}`
      : "";
    statusLine = `${tc} · ${outcome}${reason} in ${moveCount} moves`;
  }

  return { whiteName, blackName, statusLine, isLive, isWaiting, tc };
}

function describeGame(game: Awaited<ReturnType<typeof getGameByCode>>): string {
  const { whiteName, blackName, statusLine, isWaiting } = gameCardInfo(game);
  return isWaiting
    ? `${whiteName} is looking for an opponent · ${statusLine}`
    : `${whiteName} vs ${blackName} · ${statusLine}`;
}

function describeTournament(
  tournament: Awaited<ReturnType<typeof getTournamentByCode>>,
): string {
  const tc =
    tournament.baseMinutes === null
      ? "Unlimited"
      : `${tournament.baseMinutes}+${tournament.incrementSeconds}`;
  const formatLabel: Record<string, string> = {
    normal: "Knockout",
    swiss: "Swiss",
    robin: "Round robin",
    round_robin: "Round robin",
    arena: "Arena",
  };
  const format = formatLabel[tournament.format] ?? tournament.format;
  const count = tournament.players.length;
  const playerWord = count === 1 ? "player" : "players";

  if (tournament.status === "cancelled") {
    return `${tournament.name} · ${format} · ${tc} · cancelled`;
  }
  if (tournament.status === "finished") {
    // 'normal' (knockout) tracks the winner via elimination round, not
    // points (points are meaningless there, see ITournamentPlayer's
    // doc comment), the eventual winner is whoever was never eliminated.
    const winner =
      tournament.format === "normal"
        ? tournament.players.find((p) => p.eliminatedRound === null)
        : [...tournament.players].sort((a, b) => b.points - a.points)[0];
    const winnerLine = winner ? ` · won by ${winner.username}` : "";
    return `${tournament.name} · ${format} · ${tc}${winnerLine}`;
  }
  if (tournament.status === "active") {
    return `${tournament.name} · ${format} · ${tc} · live now · ${count} ${playerWord}`;
  }
  return `${tournament.name} · ${format} · ${tc} · ${count} ${playerWord} registered`;
}

// Escapes text dropped into an HTML attribute/body, this is the one place
// in the app assembling raw HTML by hand (everywhere else is React), so it
// needs its own escaping rather than relying on JSX's automatic escaping.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// CLIENT_URL is the *frontend's* origin (e.g. the Vercel deployment), the
// canonical/og:url below must point there, not at this API server, since
// that's the URL people actually share and click.
const CLIENT_URL = process.env.CLIENT_URL ?? env.CLIENT_ORIGIN;

interface PreviewCardInput {
  title: string;
  description: string;
  url: string;
}

/**
 * Renders a minimal static HTML page with Open Graph / Twitter Card tags,
 * e.g. "kingfish vs mira · 10+0 · kingfish won by resignation in 34 moves"
 *, for link-preview crawlers (WhatsApp, Facebook, Twitter/X, Discord,
 * iMessage) that don't execute JavaScript and so can never see anything
 * from the actual React app.
 *
 * Deliberately no og:image/twitter:image here (removed after it kept
 * breaking) — description-only preview cards. Some crawlers (WhatsApp
 * chief among them) show a smaller/plainer card without an image, but
 * that's an acceptable tradeoff against the recurring breakage.
 *
 * This alone isn't sufficient to make a shared /game/:code or
 * /tournaments/:code link show a rich preview, those links are served by
 * the *frontend's* origin, not this API. Something on the frontend's side
 * (a Vercel Edge Middleware rewrite, for example) needs to detect crawler
 * requests and route them here instead of the SPA shell. See
 * client/middleware.ts.
 */
function renderPreviewPage({ title, description, url }: PreviewCardInput): string {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
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
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDescription}">
<meta http-equiv="refresh" content="0; url=${url}">
</head>
<body>
<p>${safeDescription}</p>
<p><a href="${url}">Open this on Chessr</a></p>
</body>
</html>`;
}

const linkIdParamSchema = z.object({ linkId: z.string().min(1).max(64) });

const CAGE_WINNER_MODE_LABEL: Record<string, string> = {
  total_score: "total score",
  most_categories: "most categories won",
  first_to_n: "first to N wins",
};

function cageWagerLabel(wagerMode: string, wagerTokens: number): string {
  if (!wagerTokens) return "no wager";
  if (wagerMode === "per_leg") return `${wagerTokens} R per game`;
  if (wagerMode === "split_even") return `${wagerTokens} R split across the games`;
  return `${wagerTokens} R, winner takes all`;
}

// Same shape as the game/tournament cards above, but for a cage match invite
// link. An invite that's still open describes the challenge; one that's
// already been accepted describes the match it turned into (the same URL
// takes you to that match, see cage:link_lookup), so a link pasted into a
// chat later doesn't keep advertising a challenge nobody can take anymore.
async function describeCageInvite(linkId: string): Promise<string> {
  const stored = await redis.get(`cageLinkInvite:${linkId}`);
  if (stored) {
    const invite = JSON.parse(stored) as {
      fromId: string;
      legs: unknown[];
      winnerMode: string;
      targetWins: number | null;
      wagerMode: string;
      wagerTokens: number;
    };
    const from = await User.findById(invite.fromId).select("username").lean();
    const who = from?.username ?? "Someone";
    const winnerMode =
      invite.winnerMode === "first_to_n" && invite.targetWins
        ? `first to ${invite.targetWins} wins`
        : (CAGE_WINNER_MODE_LABEL[invite.winnerMode] ?? invite.winnerMode);
    return `${who} challenged you to a cage match · ${invite.legs.length} games · ${winnerMode} · ${cageWagerLabel(invite.wagerMode, invite.wagerTokens)}`;
  }

  const resolved = await resolveCageInviteLink(linkId);
  if (resolved) {
    const match = await getCageMatchByCode(resolved.matchCode);
    const p1 = (match.player1 as any)?.username ?? "Player 1";
    const p2 = (match.player2 as any)?.username ?? "Player 2";
    const total = match.legs.length;
    let status: string;
    if (match.status === "active") {
      status = `live now, game ${match.currentLegIndex + 1} of ${total}`;
    } else if (match.matchWinner === "p1") {
      status = `${p1} won`;
    } else if (match.matchWinner === "p2") {
      status = `${p2} won`;
    } else if (match.matchWinner === "draw") {
      status = "ended in a draw";
    } else {
      status = "finished";
    }
    return `${p1} vs ${p2} · cage match · ${total} games · ${status}`;
  }

  return "This cage match invite has expired.";
}

export const getCageInviteOgCard = asyncHandler(async (req, res) => {
  const { linkId } = linkIdParamSchema.parse(req.params);

  let description = "A cage match invite on Chessr.";
  try {
    description = await describeCageInvite(linkId);
  } catch {
    // Fall back to the generic copy above, same as the other cards.
  }

  const html = renderPreviewPage({
    title: "Chessr · Cage match",
    description,
    url: `${CLIENT_URL}/cage/invite/${encodeURIComponent(linkId)}`,
  });

  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

export const getGameOgCard = asyncHandler(async (req, res) => {
  const { code } = codeParamSchema.parse(req.params);

  let description: string;
  try {
    const game = await getGameByCode(code);
    description = describeGame(game as any);
  } catch {
    description = "A chess game on Chessr.";
  }

  const html = renderPreviewPage({
    title: `Chessr · Game ${code.toUpperCase()}`,
    description,
    url: `${CLIENT_URL}/game/${encodeURIComponent(code)}`,
  });

  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

export const getTournamentOgCard = asyncHandler(async (req, res) => {
  const { code } = codeParamSchema.parse(req.params);

  let title = `Chessr · Tournament ${code.toUpperCase()}`;
  let description = "A chess tournament on Chessr.";
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

  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});
