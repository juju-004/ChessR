import { Router } from 'express';
import { searchUsers, getProfile } from '../controllers/user.controller.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

router.get('/search', optionalAuth, searchUsers);
router.get('/:username', optionalAuth, getProfile);

export default router;
