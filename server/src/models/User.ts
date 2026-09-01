import mongoose, { Schema, type Document, type Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  username: string;
  usernameLower: string;
  email: string;
  /** Absent for accounts created via Google sign-in that have never set a
   *  local password, see auth.controller.ts's signin, which rejects a
   *  password attempt with a "use Google sign-in instead" message rather
   *  than a generic bcrypt failure when this is unset. */
  passwordHash?: string;
  /** Google's stable per-account subject id ("sub" claim), set the first
   *  time someone signs in with Google, either on a brand-new account or
   *  linked onto an existing email/password one. Sparse+unique so at most
   *  one User can ever claim a given Google account, while leaving it
   *  undefined on every account that's never used Google sign-in. */
  googleId?: string;
  /** True once the address in `email` has been confirmed, via clicking
   *  the emailed link (see verification.service.ts) or, for Google
   *  sign-in, inherited directly from Google's own `email_verified` claim.
   *  Gates nothing server-side yet beyond the client's "verify your email"
   *  banner, but keeping it a real field (not inferred from token
   *  presence) means that can grow into an enforced gate later without a
   *  migration. */
  emailVerified: boolean;
  /** sha256 hex digest of the current outstanding verification token, 
   *  the raw token itself is only ever in the emailed link, never stored,
   *  so a database read alone can't be used to verify someone else's
   *  address. select:false alongside passwordHash since neither should
   *  ride along on normal user reads. */
  emailVerificationTokenHash?: string;
  emailVerificationExpires?: Date;
  tokenBalance: number;
  friends: Types.ObjectId[];
  avatarUrl?: string;
  /** Preset id from the client's avatarGradients.ts list, validated against
   *  that same allow-list server-side (see user.controller.ts) so this can
   *  never end up holding an arbitrary/unstyled string. */
  avatarGradient?: string;
  /** Short freeform profile blurb, shown under the username. */
  bio?: string;
  /** Off means direct challenges (challengeSocket.ts's challenge:send) and
   *  cage match invites (cageMatchSocket.ts's cage:send) are rejected
   *  before ever reaching this person, checked against the target, not
   *  the sender. Doesn't affect tournament pairings, those are opt-in by
   *  nature already (joining the tournament yourself). Defaults to true,
   *  existing users keep getting challenged exactly as before. */
  acceptChallenges: boolean;
  /** Set automatically once either: (a) two or more distinct users have an
   *  open report against this account (see report.service.ts's
   *  DISTINCT_REPORTERS_FREEZE_THRESHOLD — a single report alone no
   *  longer freezes anything, it just reaches the admin queue), or (b)
   *  the anti-cheat heuristic auto-flags one of their games (see
   *  anticheat.service.ts's runAutoCheatCheck / GameFlag). Either way
   *  it's a precautionary hold pending human review, not a verdict. An
   *  admin clears it from the report/game-check review screen once
   *  they've looked into it. See wallet.service's initiateWithdrawal for
   *  the enforcement side. */
  withdrawalBlocked: boolean;
  /** Set by an admin (not automatic, unlike withdrawalBlocked) when a
   *  user's own reports turn out to be spam/bad-faith, stops them from
   *  filing new reports without touching anything else on the account.
   *  See report.service.createReport for enforcement. */
  reportingBlocked: boolean;
  /** Temporary play/chat restriction, set automatically when a user's
   *  reports keep getting dismissed as bad-faith (see
   *  admin.controller.ts's checkReportAbuseSuspension /
   *  DISMISSED_REPORTS_SUSPENSION_THRESHOLD), or manually by an admin.
   *  Undefined/past means not restricted. Enforced per-action via
   *  suspension.service.ts's assertNotRestricted at the point someone
   *  tries to start a new challenge/cage match/tournament or send a chat
   *  message — deliberately NOT in requireAuth or at signin/refresh, this
   *  never signs anyone out or blocks the rest of the app, and it has no
   *  bearing on withdrawalBlocked below (a restricted user can still
   *  deposit and withdraw normally). The client reads this straight off
   *  its own user object to show a countdown on Dashboard. */
  suspendedUntil?: Date;
  tokenVersion: number;
  /** Hidden internal skill rating. Elo-like, starts at 1500, shared across
   *  every time control and variant (deliberately NOT split per-TC/variant
   *  like lichess/chess.com). Never sent to the client as a raw number, 
   *  see rating.service.ts's getRatingCategory for the tier name that
   *  actually gets shown. */
  rating: number;
  /** Count of decisive/drawn games that have fed into `rating`. Doubles as
   *  the provisional-period gate (see PROVISIONAL_GAMES_THRESHOLD in
   *  rating.service.ts), below that count, ratingCategory reads as
   *  "Unranked" no matter what the hidden number says. */
  ratedGamesPlayed: number;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, trim: true, minlength: 3, maxlength: 24 },
    // Store a normalized lowercase copy so lookups/uniqueness are case-insensitive
    // without needing a collation on every query. `unique: true` alone
    // already creates the index, no need for an `index: true` here too
    // (that combination, or a duplicate `schema.index()` call below, is
    // exactly what trips Mongoose's "Duplicate schema index" warning on
    // every server restart).
    usernameLower: { type: String, required: true, unique: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // Not required at the schema level: a Google-only account has nothing
    // to put here (see IUser.passwordHash doc comment above).
    passwordHash: { type: String, select: false },
    // sparse: true is what actually matters here, it means the unique
    // constraint only applies to documents where googleId is *set*, so any
    // number of local-only accounts (where it's undefined) can coexist.
    // unique: true alone already creates the index.
    googleId: { type: String, unique: true, sparse: true },
    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    tokenBalance: { type: Number, default: 0, min: 0 },
    friends: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    avatarUrl: { type: String },
    avatarGradient: { type: String },
    bio: { type: String, maxlength: 160, trim: true },
    acceptChallenges: { type: Boolean, default: true },
    withdrawalBlocked: { type: Boolean, default: false },
    reportingBlocked: { type: Boolean, default: false },
    suspendedUntil: { type: Date },
    // Bumped on password change / "log out everywhere" to invalidate all
    // outstanding refresh tokens without needing a server-side blacklist.
    tokenVersion: { type: Number, default: 0 },
    rating: { type: Number, default: 1500 },
    ratedGamesPlayed: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

export const User = mongoose.model<IUser>('User', userSchema);
