import { Router } from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import {
  createGame,
  joinGame,
  cancelGame,
  getOpenGames,
  getFriendsActiveGames,
  getMyActiveGames,
  getGame,
  getGameByCodeHandler,
} from '../controllers/game.controller.js';
import { getGameOgCard } from '../controllers/og.controller.js';

const router = Router();

router.post('/', requireAuth, createGame);
router.post('/:id/join', requireAuth, joinGame);
router.delete('/:id', requireAuth, cancelGame);
router.get('/open', requireAuth, getOpenGames);
router.get('/active/friends', requireAuth, getFriendsActiveGames);
router.get('/active/mine', requireAuth, getMyActiveGames);
// No auth, this is fetched by link-preview crawlers (WhatsApp, Facebook,
// etc.), which never carry a session. See og.controller.ts for the caveat
// about needing frontend-side routing for this to actually get hit by them.
router.get('/code/:code/card', getGameOgCard);
router.get('/code/:code', optionalAuth, getGameByCodeHandler);
router.get('/:id', optionalAuth, getGame);

export default router;
