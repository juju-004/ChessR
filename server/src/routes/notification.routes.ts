import { Router } from 'express';
import {
  getNotifications,
  getNotificationUnreadCount,
  readNotification,
  readAllNotifications,
} from '../controllers/notification.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, getNotifications);
router.get('/unread-count', requireAuth, getNotificationUnreadCount);
router.patch('/read-all', requireAuth, readAllNotifications);
router.patch('/:id/read', requireAuth, readNotification);

export default router;
