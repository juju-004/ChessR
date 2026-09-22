import { Router } from 'express';
import { searchUsers, getProfile, getUserGames, updateMyProfile } from '../controllers/user.controller.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/search', optionalAuth, searchUsers);
router.patch('/me', requireAuth, updateMyProfile);
router.get('/:username/games', optionalAuth, getUserGames);
router.get('/:username', optionalAuth, getProfile);

export default router;
