import mongoose, { Schema, type Document, type Types } from 'mongoose';

export type ReportReason =
  | 'cheating'
  | 'harassment'
  | 'sandbagging'
  | 'payment_dispute'
  | 'other';

export type ReportStatus = 'pending' | 'reviewing' | 'actioned' | 'dismissed';

export interface IReport extends Document {
  _id: Types.ObjectId;
  reporter: Types.ObjectId;
  reportedUser: Types.ObjectId;
  reason: ReportReason;
  /** Free-text details the reporter provides, what happened, when, etc. */
  description: string;
  /** Optional join code of the game in question, so the admin reviewing
   *  this can jump straight to the game record without the reporter
   *  needing to know a Mongo id. Not validated against a real game at
   *  submission time, the review step is where that gets checked. */
  gameCode?: string;
  status: ReportStatus;
  /** Admin user id who last touched this report, once one has. Admins are
   *  not User documents (see admin.controller.ts) so this is just the
   *  fixed admin username, not a ref. */
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const reportSchema = new Schema<IReport>(
  {
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reportedUser: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reason: {
      type: String,
      enum: ['cheating', 'harassment', 'sandbagging', 'payment_dispute', 'other'],
      required: true,
    },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    gameCode: { type: String, trim: true, uppercase: true },
    status: {
      type: String,
      enum: ['pending', 'reviewing', 'actioned', 'dismissed'],
      default: 'pending',
      index: true,
    },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    reviewNotes: { type: String, maxlength: 2000, trim: true },
  },
  { timestamps: true },
);

export const Report = mongoose.model<IReport>('Report', reportSchema);
