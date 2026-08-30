import mongoose, { Schema, type Document, type Types } from 'mongoose';

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface IFriendRequest extends Document {
  _id: Types.ObjectId;
  from: Types.ObjectId;
  to: Types.ObjectId;
  status: FriendRequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

const friendRequestSchema = new Schema<IFriendRequest>(
  {
    from: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    to: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'cancelled'],
      default: 'pending',
      index: true,
    },
  },
  { timestamps: true },
);

// Stops a duplicate PENDING request between the same pair (the same thing
// sendFriendRequest's own findOne check above guards at the application
// level, this is the DB-level backstop). Deliberately partial, scoped to
// status: 'pending' only: a plain unique index on {from, to} looked
// equivalent at a glance but actually blocked far more than intended —
// once any request ever existed between two people, even one long since
// accepted, declined, or cancelled, a fresh FriendRequest.create() for
// that same direction hit this index and failed with a raw duplicate-key
// error. In practice that meant unfriending someone made it permanently
// impossible to re-add them: the old accepted request was still sitting
// there holding the slot. A partial index only enforces uniqueness among
// documents matching partialFilterExpression, so a resolved request no
// longer blocks a new one.
friendRequestSchema.index(
  { from: 1, to: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);

export const FriendRequest = mongoose.model<IFriendRequest>('FriendRequest', friendRequestSchema);
