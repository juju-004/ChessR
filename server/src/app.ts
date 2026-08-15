import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env, isProd } from './config/env.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import friendRoutes from './routes/friend.routes.js';
import gameRoutes from './routes/game.routes.js';
import cageMatchRoutes from './routes/cageMatch.routes.js';
import tournamentRoutes from './routes/tournament.routes.js';
import walletRoutes from './routes/wallet.routes.js';
import reportRoutes from './routes/report.routes.js';
import adminRoutes from './routes/admin.routes.js';
import configRoutes from './routes/config.routes.js';
import { handleWebhook } from './controllers/wallet.controller.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // needed for correct rate-limit/IP behavior behind a load balancer

  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    }),
  );

  // The Paystack webhook MUST be registered before express.json() and needs
  // the raw, unparsed body — signature verification is an HMAC over the exact
  // bytes Paystack sent, which express.json() would otherwise have already
  // consumed and reserialized (silently breaking every signature check).
  app.post(
    '/api/wallet/webhook',
    express.raw({ type: 'application/json' }),
    (req, _res, next) => {
      (req as any).rawBody = req.body; // Buffer, thanks to express.raw()
      next();
    },
    handleWebhook,
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(morgan(isProd ? 'combined' : 'dev'));

  // Global baseline limiter; sensitive routes layer on stricter limits (see auth.routes.ts).
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/friends', friendRoutes);
  app.use('/api/games', gameRoutes);
  app.use('/api/cage-matches', cageMatchRoutes);
  app.use('/api/tournaments', tournamentRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/config', configRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
