import mongoose, { Schema, type Document, type Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  username: string;
  usernameLower: string;
  email: string;
  passwordHash: string;
  tokenBalance: number;
  friends: Types.ObjectId[];
  avatarUrl?: string;
  /** Preset id from the client's avatarGradients.ts list — validated against
   *  that same allow-list server-side (see user.controller.ts) so this can
   *  never end up holding an arbitrary/unstyled string. */
  avatarGradient?: string;
  /** Short freeform profile blurb, shown under the username. */
  bio?: string;
  /** Set the moment any report is filed against this user (see Report
   *  model) — instant, automatic, and independent of whether the report
   *  turns out to be substantiated. An admin clears it from the report
   *  review screen once they've looked into it. See wallet.service's
   *  initiateWithdrawal for the enforcement side. */
  withdrawalBlocked: boolean;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, trim: true, minlength: 3, maxlength: 24 },
    // Store a normalized lowercase copy so lookups/uniqueness are case-insensitive
    // without needing a collation on every query.
    usernameLower: { type: String, required: true, unique: true, index: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    tokenBalance: { type: Number, default: 0, min: 0 },
    friends: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    avatarUrl: { type: String },
    avatarGradient: { type: String },
    bio: { type: String, maxlength: 160, trim: true },
    withdrawalBlocked: { type: Boolean, default: false },
    // Bumped on password change / "log out everywhere" to invalidate all
    // outstanding refresh tokens without needing a server-side blacklist.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Supports prefix search for the "look up other user profiles" feature.
userSchema.index({ usernameLower: 1 });

export const User = mongoose.model<IUser>('User', userSchema);
