import mongoose, { Schema, type Document, type Types } from 'mongoose';

export type TeamJoinRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface ITeamJoinRequest extends Document {
  _id: Types.ObjectId;
  team: Types.ObjectId;
  user: Types.ObjectId;
  status: TeamJoinRequestStatus;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ITeamJoinRequest>(
  {
    team: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['pending', 'accepted', 'declined', 'cancelled'], default: 'pending' },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

// One open request per person per team. Partial, so resolved ones don't
// block a later request (same approach as FriendRequest).
schema.index({ team: 1, user: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

export const TeamJoinRequest = mongoose.model<ITeamJoinRequest>('TeamJoinRequest', schema);
