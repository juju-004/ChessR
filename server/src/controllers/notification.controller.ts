import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import type { AuthedRequest } from '../middleware/auth.js';
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/notification.service.js';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const getNotifications = asyncHandler(async (req: AuthedRequest, res) => {
  const { page, limit } = listQuerySchema.parse(req.query);
  const result = await listNotifications(req.user!.id, page, limit);
  res.json(result);
});

export const getNotificationUnreadCount = asyncHandler(async (req: AuthedRequest, res) => {
  const count = await getUnreadCount(req.user!.id);
  res.json({ unreadCount: count });
});

export const readNotification = asyncHandler(async (req: AuthedRequest, res) => {
  const found = await markNotificationRead(req.user!.id, req.params.id);
  if (!found) throw ApiError.notFound('Notification not found');
  res.status(204).end();
});

export const readAllNotifications = asyncHandler(async (req: AuthedRequest, res) => {
  await markAllNotificationsRead(req.user!.id);
  res.status(204).end();
});
