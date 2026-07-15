import { Router } from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { createGame, joinGame, getOpenGames, getGame } from '../controllers/game.controller.js';

const router = Router();

router.post('/', requireAuth, createGame);
router.post('/:id/join', requireAuth, joinGame);
router.get('/open', requireAuth, getOpenGames);
router.get('/:id', optionalAuth, getGame);

export default router;
