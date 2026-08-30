import { createServer } from 'http';
import { env } from './config/env.js';
import { connectMongo, disconnectMongo } from './config/db.js';
import { disconnectRedis } from './config/redis.js';
import { createApp } from './app.js';
import { initSocketServer } from './sockets/index.js';
import { getIo } from './sockets/io.js';
import { reconcileActiveGames } from './services/game.service.js';
import { reconcileActiveTournaments, sweepCancelledTournaments } from './services/tournament.service.js';
import { FriendRequest } from './models/FriendRequest.js';

async function main() {
  await connectMongo();

  // Self-heals a schema change: FriendRequest's unique index used to be a
  // blanket {from, to} unique index; it's now partial, scoped to pending
  // requests only, so a resolved request no longer permanently blocks a
  // fresh one between the same two people (see FriendRequest.ts).
  // Mongoose's autoIndex creates newly-defined indexes on boot but won't
  // drop a conflicting old one on its own, a database that already had
  // the old index just keeps silently enforcing it forever, defeating the
  // fix, hence this. syncIndexes drops anything not in the current schema
  // and creates what's missing; idempotent and cheap once already in
  // sync, so it's fine to just run on every boot rather than needing a
  // one-off migration script someone has to remember to run.
  await FriendRequest.syncIndexes().catch((err) => {
    console.error('FriendRequest.syncIndexes failed:', err);
  });

  const app = createApp();
  const httpServer = createServer(app);

  initSocketServer(httpServer);

  // Recover any games whose in-memory clock timer was wiped out by the process
  // restarting (very common in dev with hot-reload; also a real concern in
  // prod after a deploy or crash). Then keep sweeping periodically as a
  // general safety net.
  reconcileActiveGames()
    .then(({ resumed, timedOut, aborted, idleCancelled }) => {
      if (resumed || timedOut || aborted || idleCancelled) {
        console.log(
          `♟️  Reconciled active games on boot: ${resumed} resumed, ${timedOut} timed out, ${aborted} aborted (no live state), ${idleCancelled} cancelled (idle too long).`,
        );
      }
    })
    .catch((err) => console.error('reconcileActiveGames failed on boot:', err));

  // Same idea as reconcileActiveGames, but for tournaments sitting in their
  // inter-round break, recovers any in-memory break timer wiped out by a
  // restart (see scheduleRoundStart in tournament.service.ts).
  reconcileActiveTournaments()
    .then(({ activated, rearmed, autoStarted, autoStartRearmed }) => {
      if (activated || rearmed || autoStarted || autoStartRearmed) {
        console.log(
          `🏆 Reconciled tournaments on boot: ${activated} round(s) activated, ${rearmed} break(s) re-armed, ${autoStarted} auto-started, ${autoStartRearmed} auto-start(s) re-armed.`,
        );
      }
    })
    .catch((err) => console.error('reconcileActiveTournaments failed on boot:', err));

  // Cancelled tournaments carry no lasting value (no games were ever
  // played), so they're deleted a short while after cancellation rather
  // than accumulating forever, see sweepCancelledTournaments' own comment
  // for the grace-period reasoning.
  sweepCancelledTournaments()
    .then(({ deleted }) => {
      if (deleted) console.log(`🗑️  Swept ${deleted} cancelled tournament(s) on boot.`);
    })
    .catch((err) => console.error('sweepCancelledTournaments failed on boot:', err));

  // Runs much more often than IDLE_PHASE_ABANDON_MS (5 min, in game.service.ts)
  // on purpose, if this ran every 5 minutes too, a game that just missed one
  // sweep could sit idle for close to double the intended threshold before
  // getting caught. A 60s cadence bounds that worst case to ~1 extra minute
  // instead, while still being cheap (Game.find({status:'active'}) over a
  // realistic table size, once a minute).
  const reconcileInterval = setInterval(() => {
    reconcileActiveGames().catch((err) => console.error('periodic reconcileActiveGames failed:', err));
    reconcileActiveTournaments().catch((err) => console.error('periodic reconcileActiveTournaments failed:', err));
    sweepCancelledTournaments().catch((err) => console.error('periodic sweepCancelledTournaments failed:', err));
  }, 60 * 1000);
  reconcileInterval.unref();

  httpServer.listen(env.PORT, () => {
    console.log(`🚀 Server listening on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    // httpServer.close()'s callback only fires once every connection on it
    // has ended, and open WebSocket connections don't end on their own, so
    // with even one player still connected that callback would never fire.
    // That used to mean disconnectRedis() never ran, and the process was
    // killed 10s later by the force-exit below instead, a hard cut that
    // left the Redis adapter's pub/sub subscriber connections still open
    // from Redis's point of view. The next deploy's instance would then
    // wait on fetchSockets() replies from this now-dead instance until
    // Redis itself noticed the connection was gone, well past the
    // adapter's own request timeout, surfacing as spurious "timeout
    // reached while waiting for fetchSockets response" errors.
    // io.close() force-disconnects every socket immediately and lets the
    // Redis adapter unsubscribe cleanly, so it's called first and
    // unconditionally rather than nested inside httpServer.close()'s
    // callback.
    getIo().close();
    httpServer.close();
    // Force-exit if the cleanup below hangs for some other reason. Scheduled
    // up front, not after the awaited cleanup, so it actually guards against
    // a hang rather than only running once the hang is already over.
    const forceExit = setTimeout(() => process.exit(1), 10000);
    forceExit.unref();
    await Promise.all([disconnectMongo(), disconnectRedis()]);
    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
