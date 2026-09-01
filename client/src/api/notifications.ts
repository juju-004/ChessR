import { apiFetch } from './http.js';

export type NotificationType = 'welcome' | 'anticheat_freeze' | 'report_freeze' | 'admin_message';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationsListResponse {
  notifications: AppNotification[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  unreadCount: number;
}

export function getNotifications(page = 1, limit = 20) {
  return apiFetch<NotificationsListResponse>(`/notifications?page=${page}&limit=${limit}`);
}

export function getNotificationUnreadCount() {
  return apiFetch<{ unreadCount: number }>('/notifications/unread-count');
}

export function markNotificationRead(id: string) {
  return apiFetch<void>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export function markAllNotificationsRead() {
  return apiFetch<void>('/notifications/read-all', { method: 'PATCH' });
}
