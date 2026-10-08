import { Router } from 'express';
import {
  searchUsers,
  getProfile,
  getUserGames,
  updateMyProfile,
  listOnlinePlayers,
} from '../controllers/user.controller.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/search', optionalAuth, searchUsers);
router.patch('/me', requireAuth, updateMyProfile);
// Two segments, so it can never be mistaken for a username (usernames can't
// contain a slash) and needs no special ordering against '/:username'.
router.get('/online/players', requireAuth, listOnlinePlayers);
router.get('/:username/games', optionalAuth, getUserGames);
router.get('/:username', optionalAuth, getProfile);

export default router;
