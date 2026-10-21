import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  followUser,
  unfollowUser,
  listFollowing,
  listFollowers,
} from '../controllers/follow.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/following', listFollowing);
router.get('/followers', listFollowers);
router.post('/', followUser);
router.delete('/:userId', unfollowUser);

export default router;
