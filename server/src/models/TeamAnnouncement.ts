import mongoose, { Schema, type Document, type Types } from 'mongoose';

export interface ITeamAnnouncement extends Document {
  _id: Types.ObjectId;
  team: Types.ObjectId;
  author: Types.ObjectId;
  title: string;
  body: string;
  pinned: boolean;
  pinnedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ITeamAnnouncement>(
  {
    team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, default: '', trim: true, maxlength: 60 },
    body: { type: String, required: true, trim: true, minlength: 1, maxlength: 600 },
    pinned: { type: Boolean, default: false },
    pinnedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Pinned first, then newest: matches how the team page reads them.
schema.index({ team: 1, pinned: -1, createdAt: -1 });

export const TeamAnnouncement = mongoose.model<ITeamAnnouncement>('TeamAnnouncement', schema);
