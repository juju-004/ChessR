import { createServer } from 'http';
import { env } from './config/env.js';
import { connectMongo, disconnectMongo } from './config/db.js';
import { disconnectRedis } from './config/redis.js';
import { createApp } from './app.js';
import { initSocketServer } from './sockets/index.js';

async function main() {
  await connectMongo();

  const app = createApp();
  const httpServer = createServer(app);

  initSocketServer(httpServer);

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
