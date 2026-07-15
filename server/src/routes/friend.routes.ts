import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  sendFriendRequest,
  respondToFriendRequest,
  listFriends,
  listIncomingRequests,
  removeFriend,
} from '../controllers/friend.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/', listFriends);
router.get('/requests', listIncomingRequests);
router.post('/requests', sendFriendRequest);
router.post('/requests/respond', respondToFriendRequest);
router.delete('/:friendId', removeFriend);

export default router;
