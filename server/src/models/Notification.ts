import mongoose, { Schema, type Document, type Types } from 'mongoose';

// Persisted, first-party notifications *from ChessR itself* — welcome
// message, anti-cheat freeze alerts, multi-report freeze alerts, any
// future admin broadcast. Deliberately a separate thing from:
//   - NotificationContext.tsx's toasts (client-only, ephemeral, never
//     persisted, e.g. "Move played")
//   - the friend-request/challenge/cage-invite bell (NotificationCenterContext,
//     social & actionable, mostly Redis-backed with short TTLs)
// This model is for messages *the platform* sends *to* a user about their
// account, read once and kept around, the way a bank app's notification
// tab works, not a live social feed.
export type NotificationType =
  | 'welcome'
  | 'anticheat_freeze'
  | 'report_freeze'
  | 'admin_message';

export interface INotification extends Document {
  _id: Types.ObjectId;
  recipient: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  /** Optional in-app path the notification should link to when tapped,
   *  e.g. "/about", "/terms", "/wallet". Absolute app-relative paths only,
   *  never a raw external URL, so the client can just <Link> it. */
  link?: string;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['welcome', 'anticheat_freeze', 'report_freeze', 'admin_message'],
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    link: { type: String, trim: true, maxlength: 200 },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

// Every list/unread-count read is scoped to one recipient and sorted by
// recency, this compound index covers both shapes directly instead of
// falling back to a collection scan or a separate index per query.
notificationSchema.index({ recipient: 1, createdAt: -1 });

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
