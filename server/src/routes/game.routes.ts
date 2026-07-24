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

const router = Router();

router.post('/', requireAuth, createGame);
router.post('/:id/join', requireAuth, joinGame);
router.delete('/:id', requireAuth, cancelGame);
router.get('/open', requireAuth, getOpenGames);
router.get('/active/friends', requireAuth, getFriendsActiveGames);
router.get('/active/mine', requireAuth, getMyActiveGames);
router.get('/code/:code', optionalAuth, getGameByCodeHandler);
router.get('/:id', optionalAuth, getGame);

export default router;
