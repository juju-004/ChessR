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
  /** Set by an admin (not automatic, unlike withdrawalBlocked) when a
   *  user's own reports turn out to be spam/bad-faith — stops them from
   *  filing new reports without touching anything else on the account.
   *  See report.service.createReport for enforcement. */
  reportingBlocked: boolean;
  tokenVersion: number;
  /** Hidden internal skill rating — Elo-like, starts at 1500, shared across
   *  every time control and variant (deliberately NOT split per-TC/variant
   *  like lichess/chess.com). Never sent to the client as a raw number —
   *  see rating.service.ts's getRatingCategory for the tier name that
   *  actually gets shown. */
  rating: number;
  /** Count of decisive/drawn games that have fed into `rating`. Doubles as
   *  the provisional-period gate (see PROVISIONAL_GAMES_THRESHOLD in
   *  rating.service.ts) — below that count, ratingCategory reads as
   *  "Unranked" no matter what the hidden number says. */
  ratedGamesPlayed: number;
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
    reportingBlocked: { type: Boolean, default: false },
    // Bumped on password change / "log out everywhere" to invalidate all
    // outstanding refresh tokens without needing a server-side blacklist.
    tokenVersion: { type: Number, default: 0 },
    rating: { type: Number, default: 1500 },
    ratedGamesPlayed: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// Supports prefix search for the "look up other user profiles" feature.
userSchema.index({ usernameLower: 1 });

export const User = mongoose.model<IUser>('User', userSchema);
