import { Notification, type INotification, type NotificationType } from '../models/Notification.js';
import { getIo } from '../sockets/io.js';

export interface CreateNotificationParams {
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
}

function serialize(n: INotification) {
  return {
    id: n._id.toString(),
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.read,
    createdAt: n.createdAt,
  };
}

/** Creates one notification and pushes it live over the recipient's own
 *  socket room (see presenceSocket.ts's `user:${userId}` join), the same
 *  addressing convention challenge/cage-invite events already use. A
 *  recipient with no open connection just picks it up next time they open
 *  the notifications list/modal, this isn't the only way it's delivered. */
export async function createNotification(params: CreateNotificationParams): Promise<INotification> {
  const notification = await Notification.create({
    recipient: params.recipientId,
    type: params.type,
    title: params.title,
    body: params.body,
    link: params.link,
  });

  try {
    getIo().to(`user:${params.recipientId}`).emit('notification:new', serialize(notification));
  } catch (err) {
    // Same "best-effort" posture as every other fire-and-forget socket
    // push in this codebase, io not being up yet (e.g. a script context)
    // shouldn't fail the write that already succeeded.
    console.error('notification socket push failed:', err);
  }

  return notification;
}

export interface ListNotificationsResult {
  notifications: ReturnType<typeof serialize>[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  unreadCount: number;
}

export async function listNotifications(
  userId: string,
  page = 1,
  limit = 20,
): Promise<ListNotificationsResult> {
  const [items, total, unreadCount] = await Promise.all([
    Notification.find({ recipient: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments({ recipient: userId }),
    Notification.countDocuments({ recipient: userId, read: false }),
  ]);

  return {
    notifications: items.map((n) => serialize(n as unknown as INotification)),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    unreadCount,
  };
}

export async function getUnreadCount(userId: string): Promise<number> {
  return Notification.countDocuments({ recipient: userId, read: false });
}

/** Scoped to `recipient: userId` so one person can never mark (or even
 *  discover the existence of) another person's notification by guessing
 *  an id. */
export async function markNotificationRead(userId: string, notificationId: string): Promise<boolean> {
  const result = await Notification.updateOne(
    { _id: notificationId, recipient: userId },
    { $set: { read: true } },
  );
  return result.matchedCount > 0;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await Notification.updateMany({ recipient: userId, read: false }, { $set: { read: true } });
}
