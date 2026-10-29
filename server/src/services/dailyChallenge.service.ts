import { DailyChallengeProgress, type IDailyChallengeProgress } from '../models/DailyChallengeProgress.js';
import { User } from '../models/User.js';
import { Tournament } from '../models/Tournament.js';
import { env } from '../config/env.js';
import { getIo } from '../sockets/io.js';
import { creditDailyReward } from './wallet.service.js';
import { createNotification } from './notification.service.js';
import { createCalendar } from './dailyChallenge.calendar.js';
import {
  challengeDef,
  DAY_REWARDS,
  WEEK_BONUS,
  eventCounts,
  pickChallenges,
  type ChallengeIcon,
  type DailyEvent,
} from './dailyChallenge.catalog.js';

// --- Calendar ------------------------------------------------------------------
// A "day" is a calendar day in DAILY_CHALLENGE_TZ, as a YYYY-MM-DD key. Using
// calendar days (not 24-hour windows) means every player's day ends at the
// same moment, and "yesterday" is simple to reason about.
const { dateKeyOf, addDays, msUntilNextDay } = createCalendar(env.DAILY_CHALLENGE_TZ);

// --- Rewards -------------------------------------------------------------------
export const rewardForDay = (day: number) => DAY_REWARDS[day - 1];

// --- Starting / rolling a day ----------------------------------------------------
/** What decides which challenges this player can be given right now. */
async function pickContextFor(userId: string) {
  const [user, openTournament] = await Promise.all([
    User.findById(userId).select('rating').lean(),
    // "Join a tournament" only if one is open for anyone to join for free.
    Tournament.exists({ status: 'pending', passwordHash: null, regFeeTokens: { $lte: 0 } }),
  ]);
  // "Higher rated" challenges need somebody above this player to play. The
  // top of the ladder has nobody, so they are never handed one.
  const higherRatedExists =
    typeof user?.rating === 'number' ? !!(await User.exists({ rating: { $gt: user.rating } })) : false;
  return { openTournament: !!openTournament, higherRatedExists };
}

async function buildChallenges(userId: string, cycle: number, day: number) {
  const ids = pickChallenges(userId, cycle, day, await pickContextFor(userId));
  return ids.map((id) => ({ id, progress: 0, completedAt: null }));
}

/** Makes sure the player's record is for TODAY and returns it, creating it on
 *  first use and rolling it forward (or resetting it after a missed day). */
async function ensureCurrent(userId: string): Promise<IDailyChallengeProgress> {
  const today = dateKeyOf(Date.now());
  let doc = await DailyChallengeProgress.findOne({ user: userId });

  if (!doc) {
    const challenges = await buildChallenges(userId, 1, 1);
    try {
      return await DailyChallengeProgress.create({ user: userId, cycle: 1, day: 1, dateKey: today, challenges });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      doc = await DailyChallengeProgress.findOne({ user: userId }); // lost a creation race
      if (!doc) throw err;
    }
  }

  if (doc.dateKey === today) {
    if (doc.dayCompleted && !doc.rewardPaid) await payReward(doc);
    return doc;
  }

  // A new calendar day. Pay anything still owed for the day that just ended.
  if (doc.dayCompleted && !doc.rewardPaid) await payReward(doc);

  const continued = doc.dayCompleted && doc.dateKey === addDays(today, -1);
  let cycle = doc.cycle;
  let day: number;
  let resetNotice: IDailyChallengeProgress['resetNotice'] = null;
  const setExtra: Record<string, unknown> = {};

  if (continued && doc.day < 7) {
    day = doc.day + 1;
  } else if (continued) {
    // Finished Day 7 yesterday: a fresh week starts today.
    cycle += 1;
    day = 1;
    setExtra.completedDays = [];
  } else {
    // Missed at least one day. Back to Day 1, and the run of days is broken.
    cycle += 1;
    day = 1;
    setExtra.completedDays = [];
    setExtra.streak = 0;
    if (doc.day > 1 || doc.dayCompleted) resetNotice = { dateKey: today, fromDay: doc.day };
  }

  const challenges = await buildChallenges(userId, cycle, day);
  const rolled = await DailyChallengeProgress.findOneAndUpdate(
    { _id: doc._id, dateKey: doc.dateKey }, // only one rollover wins
    {
      $set: {
        cycle,
        day,
        dateKey: today,
        challenges,
        dayCompleted: false,
        rewardPaid: false,
        winStreak: 0,
        bestWinStreak: 0,
        seenKeys: [],
        resetNotice,
        ...setExtra,
      },
    },
    { new: true },
  );
  return rolled ?? (await DailyChallengeProgress.findOne({ user: userId }))!;
}

// --- Paying a completed day ---------------------------------------------------------
async function payReward(doc: IDailyChallengeProgress): Promise<void> {
  const userId = doc.user.toString();
  const base = rewardForDay(doc.day);
  const bonus = doc.day === 7 ? WEEK_BONUS : 0;

  const paidBase = await creditDailyReward(userId, base, `DCR-${userId}-${doc.cycle}-${doc.day}`);
  const paidBonus = bonus > 0 ? await creditDailyReward(userId, bonus, `DCR-${userId}-${doc.cycle}-week`) : false;

  const credited = (paidBase ? base : 0) + (paidBonus ? bonus : 0);
  await DailyChallengeProgress.updateOne(
    { _id: doc._id, rewardPaid: false },
    { $set: { rewardPaid: true }, ...(credited ? { $inc: { totalEarned: credited } } : {}) },
  );
  doc.rewardPaid = true;

  if (credited > 0) {
    const weekDone = doc.day === 7;
    createNotification({
      recipientId: userId,
      type: 'daily_reward',
      title: weekDone ? 'Week complete! 🏆' : `Day ${doc.day} complete!`,
      body: weekDone
        ? `You finished all 7 days and earned ${credited} R. A new week starts tomorrow.`
        : `You earned ${credited} R. Come back tomorrow for Day ${doc.day + 1}: ${rewardForDay(doc.day + 1)} R.`,
      link: '/daily',
    }).catch((err) => console.error('daily reward notification failed:', err));
  }
}

// --- Marking challenges done ---------------------------------------------------------------
/** Marks anything that has reached its target as done (once, atomically), and
 *  when all three are done, flips the day to completed and pays the reward
 *  (exactly one caller wins that). Shared by live play and admin scripts. */
async function settleCompletions(doc: IDailyChallengeProgress): Promise<void> {
  // Mark anything that just reached its target as done (once, atomically).
  let anyDone = false;
  for (const [i, c] of doc.challenges.entries()) {
    const d = challengeDef(c.id);
    if (!d || c.completedAt || c.progress < d.target) continue;
    const res = await DailyChallengeProgress.updateOne(
      { _id: doc._id, dateKey: doc.dateKey, [`challenges.${i}.completedAt`]: null },
      { $set: { [`challenges.${i}.completedAt`]: new Date() } },
    );
    if (res.modifiedCount) anyDone = true;
  }

  if (anyDone) {
    // All three done? Exactly one caller flips dayCompleted and pays.
    const finished = await DailyChallengeProgress.findOneAndUpdate(
      {
        _id: doc._id,
        dateKey: doc.dateKey,
        dayCompleted: false,
        challenges: { $not: { $elemMatch: { completedAt: null } } },
      },
      {
        $set: { dayCompleted: true },
        $addToSet: { completedDays: doc.day },
        $inc: { streak: 1, daysCompleted: 1, ...(doc.day === 7 ? { weeksCompleted: 1 } : {}) },
      },
      { new: true },
    );
    if (finished) {
      if (finished.streak > finished.bestStreak) {
        await DailyChallengeProgress.updateOne({ _id: finished._id }, { $set: { bestStreak: finished.streak } });
      }
      await payReward(finished);
    }
  }
}

// --- Recording what players do ---------------------------------------------------------
function notifyClient(userId: string): void {
  try {
    getIo().to(`user:${userId}`).emit('dailyChallenges:updated');
  } catch {
    // sockets not up (scripts/tests): nothing to tell
  }
}

/** Counts an event toward today's challenges. Safe to call for anything a
 *  player does; does nothing when no challenge cares. Never throws: callers
 *  use this fire-and-forget (see trackDaily). */
export async function recordDailyEvent(userId: string, event: DailyEvent): Promise<void> {
  let doc = await ensureCurrent(userId);
  if (doc.dayCompleted) return; // today is done, nothing more to earn

  const isGame = event.type === 'game_finished';
  const matches = doc.challenges
    .map((c, i) => ({ c, i, d: challengeDef(c.id) }))
    .filter(
      (x): x is typeof x & { d: NonNullable<typeof x.d> } =>
        !!x.d && !x.c.completedAt && eventCounts(x.d, event),
    );
  // A game also moves the win streak even when no streak challenge is shown
  // today, so the counter is always right.
  if (matches.length === 0 && !isGame) return;

  const inc: Record<string, number> = {};
  const set: Record<string, unknown> = {};
  const max: Record<string, number> = {};
  for (const { i, d } of matches) {
    if (!d.streak) inc[`challenges.${i}.progress`] = 1;
  }

  // Win streak: a win extends it, a loss or draw ends it.
  let streakNow = doc.winStreak;
  if (isGame) {
    streakNow = event.result === 'win' ? doc.winStreak + 1 : 0;
    set.winStreak = streakNow;
    if (streakNow > 0) max.bestWinStreak = streakNow;
    for (const { i, d } of matches) {
      if (d.streak) max[`challenges.${i}.progress`] = streakNow;
    }
    // A streak challenge isn't "matched" by a loss (the test is omitted so
    // every game reaches it), only a win moves its number, which `max` handles.
  }

  const filter: Record<string, unknown> = { _id: doc._id, dateKey: doc.dateKey };
  if (event.key) filter.seenKeys = { $ne: event.key };
  const update: Record<string, unknown> = {};
  if (Object.keys(inc).length) update.$inc = inc;
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(max).length) update.$max = max;
  if (event.key) update.$push = { seenKeys: event.key };
  if (Object.keys(update).length === 0) return;

  const updated = await DailyChallengeProgress.findOneAndUpdate(filter, update, { new: true });
  if (!updated) return; // duplicate event, or the day rolled over mid-flight
  doc = updated;

  await settleCompletions(doc);

  notifyClient(userId);
}

/** Fire-and-forget wrapper for hook sites: never slows or breaks the thing
 *  that triggered it. */
export function trackDaily(userId: string | null | undefined, event: DailyEvent): void {
  if (!userId) return;
  recordDailyEvent(userId, event).catch((err) => console.error('daily challenge tracking failed:', err));
}

// --- Admin / one-off script helpers -----------------------------------------------------------
/** Today's calendar day key, in the challenges' time zone. */
export const todayKey = () => dateKeyOf(Date.now());

/** Rolls the player's record forward to today (same rules as opening the
 *  page) and returns it. For admin scripts. */
export const rollToToday = ensureCurrent;

/** Context for picking a challenge for this player right now. */
export const currentPickContext = pickContextFor;

/** Completes ONE of today's unfinished challenges for the player: the one with
 *  the smallest target (ties go to the earlier slot). If that was their last
 *  one, the day is completed and its reward paid, exactly as if they had
 *  played it. Idempotent per `key`: calling again with the same key does
 *  nothing, so a script can be re-run safely. */
export async function completeOneChallenge(
  userId: string,
  key: string,
): Promise<{ status: 'completed' | 'already' | 'nothing_left'; challengeId?: string; dayCompleted?: boolean }> {
  const doc = await ensureCurrent(userId);
  if (doc.seenKeys.includes(key)) return { status: 'already' };

  const open = doc.challenges
    .map((c, i) => ({ c, i, d: challengeDef(c.id) }))
    .filter((x): x is typeof x & { d: NonNullable<typeof x.d> } => !!x.d && !x.c.completedAt)
    .sort((x, y) => x.d.target - y.d.target || x.i - y.i);
  if (doc.dayCompleted || open.length === 0) return { status: 'nothing_left' };

  const { c, i, d } = open[0];
  const updated = await DailyChallengeProgress.findOneAndUpdate(
    { _id: doc._id, dateKey: doc.dateKey, seenKeys: { $ne: key }, [`challenges.${i}.completedAt`]: null },
    {
      // Only lift the progress to the target; settleCompletions() below then
      // stamps completedAt and, if it was the last one, finishes + pays the day.
      $max: { [`challenges.${i}.progress`]: d.target },
      $push: { seenKeys: key },
    },
    { new: true },
  );
  if (!updated) return { status: 'already' };

  await settleCompletions(updated);
  notifyClient(userId);
  const after = await DailyChallengeProgress.findById(doc._id).select('dayCompleted').lean();
  return { status: 'completed', challengeId: c.id, dayCompleted: !!after?.dayCompleted };
}

// --- What the page shows ---------------------------------------------------------------------
export interface DailyChallengeState {
  day: number;
  dateKey: string;
  serverNow: number;
  msUntilReset: number;
  challenges: Array<{
    id: string;
    title: string;
    icon: ChallengeIcon;
    link: string;
    target: number;
    progress: number;
    completed: boolean;
  }>;
  dayCompleted: boolean;
  /** What today pays (day reward, plus the week bonus on Day 7). */
  rewardToday: number;
  week: Array<{ day: number; reward: number; bonus: number; status: 'done' | 'today' | 'upcoming' }>;
  weekBonus: number;
  /** Day 7 finished: the week is won. */
  weekComplete: boolean;
  tomorrow: { day: number; reward: number } | null;
  resetNotice: { fromDay: number } | null;
  streak: number;
  bestStreak: number;
  daysCompleted: number;
  weeksCompleted: number;
  totalEarned: number;
}

export async function getDailyChallengeState(userId: string): Promise<DailyChallengeState> {
  const doc = await ensureCurrent(userId);
  const now = Date.now();

  const challenges = doc.challenges.map((c) => {
    const d = challengeDef(c.id);
    return {
      id: c.id,
      title: d?.title ?? c.id,
      icon: d?.icon ?? 'target',
      link: d?.link ?? '/',
      target: d?.target ?? 1,
      progress: Math.min(c.progress, d?.target ?? 1),
      completed: !!c.completedAt,
    } as DailyChallengeState['challenges'][number];
  });

  const week = DAY_REWARDS.map((reward, i) => {
    const day = i + 1;
    const status: 'done' | 'today' | 'upcoming' =
      doc.completedDays.includes(day) || (day === doc.day && doc.dayCompleted)
        ? 'done'
        : day === doc.day
          ? 'today'
          : 'upcoming';
    return { day, reward, bonus: day === 7 ? WEEK_BONUS : 0, status };
  });

  return {
    day: doc.day,
    dateKey: doc.dateKey,
    serverNow: now,
    msUntilReset: msUntilNextDay(now),
    challenges,
    dayCompleted: doc.dayCompleted,
    rewardToday: rewardForDay(doc.day) + (doc.day === 7 ? WEEK_BONUS : 0),
    week,
    weekBonus: WEEK_BONUS,
    weekComplete: doc.dayCompleted && doc.day === 7,
    tomorrow: doc.dayCompleted && doc.day < 7 ? { day: doc.day + 1, reward: rewardForDay(doc.day + 1) } : null,
    resetNotice:
      doc.resetNotice && doc.resetNotice.dateKey === doc.dateKey ? { fromDay: doc.resetNotice.fromDay } : null,
    streak: doc.streak,
    bestStreak: doc.bestStreak,
    daysCompleted: doc.daysCompleted,
    weeksCompleted: doc.weeksCompleted,
    totalEarned: doc.totalEarned,
  };
}
