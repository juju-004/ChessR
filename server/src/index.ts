import { createServer } from 'http';
import { env } from './config/env.js';
import { connectMongo, disconnectMongo } from './config/db.js';
import { disconnectRedis } from './config/redis.js';
import { createApp } from './app.js';
import { initSocketServer } from './sockets/index.js';
import { reconcileActiveGames } from './services/game.service.js';

async function main() {
  await connectMongo();

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

  // Runs much more often than IDLE_PHASE_ABANDON_MS (5 min, in game.service.ts)
  // on purpose — if this ran every 5 minutes too, a game that just missed one
  // sweep could sit idle for close to double the intended threshold before
  // getting caught. A 60s cadence bounds that worst case to ~1 extra minute
  // instead, while still being cheap (Game.find({status:'active'}) over a
  // realistic table size, once a minute).
  const reconcileInterval = setInterval(() => {
    reconcileActiveGames().catch((err) => console.error('periodic reconcileActiveGames failed:', err));
  }, 60 * 1000);
  reconcileInterval.unref();

  httpServer.listen(env.PORT, () => {
    console.log(`🚀 Server listening on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    httpServer.close(async () => {
      await Promise.all([disconnectMongo(), disconnectRedis()]);
      process.exit(0);
    });
    // Force-exit if graceful shutdown hangs.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
