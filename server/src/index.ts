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

  const reconcileInterval = setInterval(() => {
    reconcileActiveGames().catch((err) => console.error('periodic reconcileActiveGames failed:', err));
  }, 5 * 60 * 1000);
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
