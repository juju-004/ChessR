# Chess App — Multiplayer Chess Engine (Server-Authoritative)

```
chess-app/
  server/   Express + Socket.IO + MongoDB + Redis + chess.js (source of truth)
  client/   Vite + React + TypeScript + Tailwind CSS v4
```

## Setup

```bash
cd server
cp .env.example .env    # fill in JWT secrets, Mongo/Redis URLs
npm install
npm run dev              # http://localhost:4000

cd ../client
npm install
npm run dev                # http://localhost:5173
```

Vite proxies `/api` and `/socket.io` to `http://localhost:4000` in dev (see
`client/vite.config.ts`) — the WebSocket proxy (`ws: true`) is required, without
it the socket silently falls back to failing, not to polling.

## Architecture notes

- **Server-authoritative moves.** Every move is re-validated by chess.js against
  the FEN held in Redis (`server/src/services/gameState.service.ts`). The client's
  board is a renderer, not a source of truth.
- **Redis holds live game state**, MongoDB holds the permanent record. Moves
  broadcast to the room *immediately* after the Redis write; Mongo persistence
  and cleanup happen in the background rather than blocking the broadcast.
- **Clocks are server-enforced**, including a scheduled per-game timer so a
  timeout fires even if the opponent never moves again to trigger it. A
  reconciliation sweep runs on boot and every 5 minutes to recover any game
  whose timer was lost to a process restart — this is what stops games from
  getting stuck "active" forever after a deploy or crash.
- **Disconnect/reconnect grace period**: a dropped socket doesn't end the game.
  After a debounce + grace period, the remaining player can claim a win or draw;
  reconnecting within the window cancels all of that automatically. Both
  players' connection status is shown live next to their name/clock.
- **R token wagers replace ratings**: instead of a skill rating, players stake R
  tokens on each game. Open games escrow the host's stake at creation (refunded
  if cancelled before anyone joins); friend challenges and rematches escrow both
  sides' stakes at acceptance (rolled back if either side can't cover it). On a
  real conclusion (checkmate, resignation, timeout, or a claimed disconnect
  win) the winner takes the full pot; a draw refunds each side their own stake.
  Settlement is idempotent (guarded by a `wagerSettled` flag on the game), so a
  reconciliation sweep after a restart can never double-pay.
- **Chess960 (Fischer Random)** is fully supported, including castling — which
  chess.js itself does *not* support (confirmed via their own GitHub issues,
  open since 2016). Castling for 960 games is hand-implemented in
  `server/src/services/chess960Castling.ts` directly against chess.js's board
  primitives (`.get`/`.put`/`.remove`/`.isAttacked`/`.inCheck`), independently
  tracking which king/rook have moved. **This was verified by manual trace
  through concrete scenarios, not by executing it against a live chess.js
  instance** (this sandbox has no network access to install dependencies) —
  test it deliberately (both castling directions, plus at least one case that
  should be correctly rejected) before relying on it.
- **Access tokens live in memory, refresh tokens in an httpOnly cookie** — the
  standard mitigation against XSS token theft.
- **Friend challenges and rematches** are pure Socket.IO, backed by short-TTL
  in-memory/Redis state — no orphaned "waiting" records if nobody responds.
- **Real-time notifications use in-app banners, not `window.confirm()`.** Native
  blocking dialogs are unreliable on background/unfocused tabs.
- **`ChessBoard.tsx`** wraps `@lichess-org/chessground` (a non-React, imperative
  library). `viewOnly` is the one config option chessground will not let you
  change after construction — the component's mount effect is keyed on it
  specifically to force a rebuild when it flips, rather than a silent no-op.
  `lastMove` and `check` are threaded through as controlled props on every
  update for the same reason (both were real, previously-shipped bugs; see
  git history / conversation for the debugging trail — chessground's actual
  TypeScript source ended up being the source of truth over its README, which
  described an older API in places).
- Premove support and Chess960 castling both depend on getting chessground's
  actual current config shape right — verify premoves specifically, as this one
  went through two rounds of fixes and the second still needs first-hand
  confirmation from testing on a real machine.

## What's implemented

- Sign up / sign in / silent session restore / logout (JWT access + refresh rotation)
- Create a game with a chosen time control and variant (Standard or Chess960) →
  short shareable **join code**; anyone with the code can join as the opponent
  (if open) or spectate live (if full)
- Real chessground board, promotion picker, premoves, check highlighting
- Server-side clocks, resign, draw offers, **rematch**, **abort** (only available
  before either side has moved — mutually exclusive with resign, not shown
  alongside it), and **disconnect-grace + claim**
- Live **connection indicators** next to each player's name/clock
- A proper **game-over modal** with result, reason, R token wager outcome, and rematch
- Original synthesized sound effects (Web Audio API oscillators — not sampled
  from anywhere, so no licensing concerns, but not professional sound design either)
- Dashboard shows **friends' currently active games** with a one-click **Watch**
- **Spectator-only chat**, never persisted (pure Socket.IO relay, separate room
  from players — they never even receive the traffic, not just a hidden UI)
- User search, public profiles with **win/loss/draw record**, paginated
  **game history** linking to a move-by-move **replay** page
- Friends list with live presence, friend requests, and real-time challenges
  (selectable time control + variant + R token wager)
- Basic production hardening: a React error boundary (no more blank white
  screen on a render crash), a 404 route, per-socket move rate limiting, and
  every socket handler wrapped so unexpected failures reach the client as a
  real error instead of vanishing as an unhandled promise rejection

## ⚠️ Licensing note on chessground

`@lichess-org/chessground` is **GPL-3.0-or-later**. Combined work using it must
be distributed under the GPL — you must release your source code to users of
your website. Worth deciding on deliberately before this goes further.

## Deploying (Vercel + Railway)

**Backend → Railway:**
1. New Railway project, deploy from this repo, set the root directory to `server/`.
2. Add these environment variables (same names as `server/.env.example`): `MONGO_URI`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`. Set `NODE_ENV=production`. Set `CLIENT_ORIGIN` to your Vercel URL once you have it (e.g. `https://your-app.vercel.app`, no trailing slash — CORS matching is exact).
3. Don't set `PORT` — Railway injects it automatically and the server already reads `process.env.PORT`.
4. Railway serves over HTTPS by default, which is required for the cross-origin cookie setup below to work.

**Frontend → Vercel:**
1. New Vercel project, root directory `client/`. Build command `npm run build`, output directory `dist`.
2. Add environment variables `VITE_API_BASE_URL` and `VITE_SOCKET_URL`, both pointing at your Railway backend URL (see `client/.env.example`). Vite bakes these in at build time, so redeploy after changing them.
3. `client/vercel.json` is already set up to rewrite all paths to `index.html` — without it, a hard refresh on `/game/CODE` would 404, since `BrowserRouter` needs the server to hand back `index.html` for every route and let React Router take over client-side.

**Why this isn't just an env-var swap:** two things were previously hardcoded assuming frontend and backend share an origin (true locally, only because Vite's dev proxy fakes it):
- The refresh-token cookie was `sameSite: 'lax'`, which browsers silently refuse to send on genuinely cross-site requests. It's now `sameSite: 'none'` + `secure: true` automatically whenever `NODE_ENV=production`.
- The client's API calls and socket connection assumed same-origin (`/api`, `/`). Both now read from `VITE_API_BASE_URL` / `VITE_SOCKET_URL`, falling back to same-origin for local dev.

## R Tokens (Paystack wallet)

Server-authoritative in-app currency, following the same "server decides, client displays" pattern as everything else in this app.

**Setup:**
1. Add `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` to `server/.env` (test-mode keys, `sk_test_...` / `pk_test_...`).
2. **Set up the webhook** — this is the one step that's easy to miss and everything's built to lean on: in your Paystack dashboard, Settings → API Keys & Webhooks, set the webhook URL to `https://your-railway-url.up.railway.app/api/wallet/webhook`. Without this, purchases still work (the client-side verify call is a real fallback, not just cosmetic), but withdrawal status updates from Paystack's side (`transfer.success` / `transfer.failed` / `transfer.reversed`) will never arrive, leaving withdrawals stuck `pending` in the transaction list forever even if Paystack actually completed them.
3. Test purchases with [Paystack's documented test card numbers](https://paystack.com/docs/payments/test-payments/) — no real charge happens in test mode regardless.

**How it works:**
- **Purchases**: fixed plans defined server-side only (`server/src/services/wallet.service.ts` → `TOKEN_PLANS`) — the client never gets to specify an amount. A pending transaction is created, the Paystack popup opens, and on success the transaction gets verified **directly against Paystack's API** (never trusting the popup's own "it worked" callback) before any tokens are credited. That verification happens from two independent paths — the client's post-popup call (fast, for instant UI feedback) and the `charge.success` webhook (slow but authoritative, still resolves it correctly even if the user closes the tab mid-payment) — both converge on the same idempotent `completePurchase()`, so whichever arrives first wins and the other is a no-op.
- **Withdrawals**: token→naira conversion uses a deliberately different (lower) rate than the purchase price — otherwise buying and immediately withdrawing would be free arbitrage. Tokens are debited atomically at request time (an atomic conditional `$inc` prevents two concurrent withdrawal requests from both passing a balance check and taking the account negative) and refunded automatically if the transfer fails outright or gets reversed.
- **⚠️ Transfer OTP**: if your Paystack account has Transfer OTP enabled (Settings → Preferences), withdrawals require an OTP sent to *you*, the account owner — not something an end user can provide. This app's withdrawal flow assumes OTP is disabled for automated transfers to complete. If you want to keep OTP enabled for real-money safety later, withdrawals need a different flow (e.g. manual admin approval) rather than the current fully-automated one.
- The token balance shown in the navbar and dashboard is a shared client-side store (`api/walletStore.ts`) — a purchase completing on the Buy page updates the navbar badge immediately, not just the page you're on.

## Known limitations / things to revisit before scaling past one instance

- The per-game clock timer, rematch offers, pending disconnects, and the move
  rate limiter all live in a single process's memory (`Map`s in
  `clock.service.ts` / `gameSocket.ts`). Fine for one server instance — the
  reconciliation sweep specifically exists to paper over *restarts* of that
  one instance. If you run multiple instances behind a load balancer, these
  need to move to a durable/shared store (Redis sorted-set sweep, BullMQ
  delayed jobs, etc.) so they work correctly regardless of which instance
  handles which event.
- React Router uses `BrowserRouter` (clean URLs, no `#`). This needs a SPA
  fallback rewrite rule when you deploy to static hosting (e.g. Vercel's
  `rewrites` config directing all paths to `index.html`) — we'll handle this
  when we get to the actual production deploy.
- Wager escrow timing is intentionally asymmetric: an open game locks the
  host's stake the instant it's created (since it can sit unclaimed
  indefinitely), while a friend challenge/rematch only locks stakes at
  acceptance (since those expire quickly). Worth revisiting if it's confusing
  in practice.
