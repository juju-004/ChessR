import mongoose, { Schema, type Document, type Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  username: string;
  usernameLower: string;
  email: string;
  passwordHash: string;
  rating: number;
  tokenBalance: number;
  friends: Types.ObjectId[];
  avatarUrl?: string;
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
    rating: { type: Number, default: 1200 },
    tokenBalance: { type: Number, default: 0, min: 0 },
    friends: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    avatarUrl: { type: String },
    // Bumped on password change / "log out everywhere" to invalidate all
    // outstanding refresh tokens without needing a server-side blacklist.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Supports prefix search for the "look up other user profiles" feature.
userSchema.index({ usernameLower: 1 });

export const User = mongoose.model<IUser>('User', userSchema);
