# Chess App — Multiplayer Chess Engine (Server-Authoritative)

Two independent apps:

```
chess-app/
  server/   Express + Socket.IO + MongoDB + Redis + chess.js (source of truth)
  client/   Vite + vanilla TypeScript (raw UI — board rendering comes later)
```

## Why it's built this way

- **chess.js never runs trusted on the client.** Every move is re-validated on the
  server (`server/src/services/gameState.service.ts`) against the authoritative FEN
  held in Redis. The client only *proposes* a move; the server decides if it happened.
- **Redis holds the *live* game** (`game:{id}:state`) for low-latency read/write during
  play. **MongoDB holds the permanent record** (full move list, PGN-able, results) —
  written once per move and finalized when the game ends. This split is what lets the
  hot path (move validation) stay fast while you still get durable history.
- **Socket.IO + Redis adapter** (`@socket.io/redis-adapter`) means you can run this
  server on multiple instances behind a load balancer and events still fan out
  correctly — required once you outgrow a single Node process.
- **Presence is Redis-backed, multi-device aware** (`presence.service.ts`): a user can
  have several tabs/sockets open; "online" means "at least one socket registered."
- **Access tokens live in memory on the client, refresh tokens in an httpOnly cookie.**
  This is the standard mitigation against XSS-stolen tokens — a compromised page can't
  read the refresh token, and the short-lived access token limits the blast radius.
- **Friend challenges skip the create/join REST flow entirely** — they're pure
  Socket.IO (`challengeSocket.ts`), backed by a short-TTL Redis key, so there's no
  orphaned "waiting" game left behind if nobody responds.

## Prerequisites

- Node.js 20+
- MongoDB running locally (or a connection string)
- Redis running locally (or a connection string)

## Setup

```bash
cd server
cp .env.example .env    # edit JWT secrets, Mongo/Redis URLs as needed
npm install
npm run dev              # http://localhost:4000

cd ../client
npm install
npm run dev               # http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://localhost:4000` (see `client/vite.config.ts`),
and Socket.IO connects directly to the same origin the page is served from — update
`CLIENT_ORIGIN` in `server/.env` and the socket URL in `client/src/socket.ts` if you
deploy them on different domains.

## What's implemented

- Sign up / sign in / silent session restore / logout (JWT access + refresh rotation)
- Create an open game / list open games / join one
- Server-authoritative moves, resign, draw offers — all via Socket.IO, validated by chess.js
- User search + public profiles + friend requests (send/accept/decline)
- Friends list with live online/offline presence
- Real-time friend challenges (bypassing create/join), with accept/decline and auto-redirect
  into the game for both players

## What's intentionally stubbed for now

- **Board rendering**: the game page is raw inputs (`from`/`to`/`promotion` text fields)
  by design, per your request. Swap in `@lichess-org/chessground` (not the deprecated
  `chessground` package) inside `client/src/pages/game.ts` — the socket event contract
  (`game:sync`, `game:move`, `game:over`) is already what a board component would need.
- Timers/clocks, spectating, matchmaking-by-rating, rate-limited move flood protection.

## Scaling notes for later

- Add a `move-rate-limit` check per socket (e.g. token bucket in Redis) before calling
  `applyMove` — right now a malicious client could spam moves.
- Elo/rating updates on game end (`finalizeGame` is the natural hook).
- If you outgrow a single Redis instance, the adapter and presence/game-state services
  are already isolated behind small modules — swapping to Redis Cluster touches only
  `server/src/config/redis.ts`.
