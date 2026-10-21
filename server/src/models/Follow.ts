import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** One-way follow, Lichess style: `follower` follows `following`. No request,
 *  no approval; following is instant and the other person doesn't have to
 *  follow back. Two follows in opposite directions is just "mutual". */
export interface IFollow extends Document {
  _id: Types.ObjectId;
  follower: Types.ObjectId;
  following: Types.ObjectId;
  createdAt: Date;
}

const followSchema = new Schema<IFollow>(
  {
    follower: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    following: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// One follow per pair, and it's also the index behind "who do I follow".
followSchema.index({ follower: 1, following: 1 }, { unique: true });
// "Who follows me": follower lists, follower counts and presence fan-out.
followSchema.index({ following: 1, createdAt: -1 });

export const Follow = mongoose.model<IFollow>('Follow', followSchema);
