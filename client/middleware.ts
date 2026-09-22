/**
 * Vercel Edge Middleware — runs on Vercel's edge network, in front of the
 * normal static/SPA response, for every request matching `config.matcher`
 * below. This is what makes a shared /game/:code or /replay/:code link
 * show a real title/description in WhatsApp, Facebook, Twitter/X,
 * Discord, iMessage, etc.
 *
 * Why this exists at all: those crawlers fetch the URL and read whatever
 * HTML comes back *without* running any JavaScript — so a plain Vite SPA,
 * where the actual page content only appears after React mounts and
 * fetches data, looks like an empty shell to them no matter what
 * <title>/meta tags get set client-side. The fix is to detect that the
 * request is from a crawler (by User-Agent) and, only in that case, serve
 * a small pre-rendered HTML page with the right <meta property="og:..">
 * tags instead of the SPA shell. Real visitors (no crawler UA) pass
 * through untouched.
 *
 * DEPLOYMENT NOTE — please verify this actually works before relying on
 * it: it was written without the ability to test against a live Vercel
 * deployment, so treat it as a solid first draft rather than a finished,
 * verified feature.
 *   1. It needs an API_BASE_URL environment variable set in the Vercel
 *      project (Project Settings → Environment Variables) pointing at the
 *      backend, e.g. https://your-app.up.railway.app/api. This is
 *      deliberately NOT the VITE_API_BASE_URL used by the client bundle —
 *      VITE_-prefixed vars are baked into the built JS at compile time and
 *      aren't readable at Edge Middleware runtime, which executes
 *      per-request server-side on Vercel's edge, separate from that build.
 *   2. Confirm this file's location/name/export shape still matches
 *      Vercel's current Edge Middleware conventions for a non-Next.js
 *      (Vite) project — check https://vercel.com/docs/functions/edge-middleware
 *      since this may have changed since this was written.
 *   3. Test with Facebook's Sharing Debugger, Twitter's Card Validator, or
 *      by pasting a real game link into a WhatsApp chat to yourself.
 */

const CRAWLER_UA_PATTERN =
  /facebookexternalhit|WhatsApp|Twitterbot|Slackbot|Discordbot|LinkedInBot|TelegramBot|Pinterest|redditbot|vkShare|Applebot|SkypeUriPreview/i;

export const config = {
  matcher: ["/game/:code", "/replay/:code"],
};

export default async function middleware(request: Request): Promise<Response | undefined> {
  const userAgent = request.headers.get("user-agent") ?? "";
  if (!CRAWLER_UA_PATTERN.test(userAgent)) {
    return undefined; // not a crawler — fall through to the normal SPA response
  }

  const url = new URL(request.url);
  const match = url.pathname.match(/^\/(?:game|replay)\/([^/]+)/);
  if (!match) return undefined;
  const code = match[1];

  const apiBase = process.env.API_BASE_URL;
  if (!apiBase) return undefined; // not configured — fail open to the normal SPA

  try {
    const cardRes = await fetch(`${apiBase}/games/code/${encodeURIComponent(code)}/card`);
    const html = await cardRes.text();
    return new Response(html, {
      status: cardRes.status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch {
    return undefined; // any failure here should never block a real visitor
  }
}
