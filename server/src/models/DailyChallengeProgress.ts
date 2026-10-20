import mongoose, { Schema, type Document, type Types } from 'mongoose';

export interface IDailyChallengeItem {
  /** Key into CATALOG (dailyChallenge.catalog.ts). */
  id: string;
  progress: number;
  completedAt: Date | null;
}

/**
 * One document per player: where they are in the 7-day challenge week and
 * what today's three challenges look like. Rolled forward lazily (the first
 * time the player is touched on a new calendar day), so there is no daily
 * cron job to run or to fail.
 */
export interface IDailyChallengeProgress extends Document {
  user: Types.ObjectId;
  /** Increments each time a fresh week begins (after finishing Day 7 or after
   *  a missed day). Part of every reward's ledger reference. */
  cycle: number;
  /** Day of the week, 1-7. */
  day: number;
  /** The calendar day (YYYY-MM-DD, in DAILY_CHALLENGE_TZ) `challenges` is for. */
  dateKey: string;
  challenges: IDailyChallengeItem[];
  dayCompleted: boolean;
  /** True once the completed day's reward has been credited. Payout is
   *  idempotent, so a crash between completion and credit just retries. */
  rewardPaid: boolean;
  /** Days of the current week already completed, for the week strip. */
  completedDays: number[];
  /** Today's current and best run of consecutive wins (win-streak challenges). */
  winStreak: number;
  bestWinStreak: number;
  /** Event keys already counted today (see DailyEvent.key). */
  seenKeys: string[];
  /** Set when a missed day sent the player back to Day 1. */
  resetNotice: { dateKey: string; fromDay: number } | null;
  /** Consecutive calendar days completed, across weeks. */
  streak: number;
  bestStreak: number;
  daysCompleted: number;
  weeksCompleted: number;
  totalEarned: number;
  createdAt: Date;
  updatedAt: Date;
}

const itemSchema = new Schema<IDailyChallengeItem>(
  {
    id: { type: String, required: true },
    progress: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
  },
  { _id: false },
);

const schema = new Schema<IDailyChallengeProgress>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    cycle: { type: Number, default: 1 },
    day: { type: Number, default: 1 },
    dateKey: { type: String, required: true },
    challenges: { type: [itemSchema], default: [] },
    dayCompleted: { type: Boolean, default: false },
    rewardPaid: { type: Boolean, default: false },
    completedDays: { type: [Number], default: [] },
    winStreak: { type: Number, default: 0 },
    bestWinStreak: { type: Number, default: 0 },
    seenKeys: { type: [String], default: [] },
    resetNotice: {
      type: new Schema({ dateKey: String, fromDay: Number }, { _id: false }),
      default: null,
    },
    streak: { type: Number, default: 0 },
    bestStreak: { type: Number, default: 0 },
    daysCompleted: { type: Number, default: 0 },
    weeksCompleted: { type: Number, default: 0 },
    totalEarned: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const DailyChallengeProgress = mongoose.model<IDailyChallengeProgress>(
  'DailyChallengeProgress',
  schema,
);
