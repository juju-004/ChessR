import { Router } from 'express';
import { searchUsers, getProfile, getUserGames } from '../controllers/user.controller.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

router.get('/search', optionalAuth, searchUsers);
router.get('/:username/games', optionalAuth, getUserGames);
router.get('/:username', optionalAuth, getProfile);

export default router;
