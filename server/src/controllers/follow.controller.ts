import { z } from 'zod';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Follow } from '../models/Follow.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getOnlineUserIds } from '../services/presence.service.js';
import { getActiveGameCodesForUsers } from '../services/game.service.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { trackDaily } from '../services/dailyChallenge.service.js';

const followSchema = z.object({ userId: z.string().refine(mongoose.isValidObjectId) });

/** Lists are capped so one account can't make a request arbitrarily heavy. */
const LIST_LIMIT = 500;

const PLAYER_FIELDS = 'username avatarUrl avatarGradient rating ratingCategory';

/** Decorates a list of users with presence + "mid-game" in two batched
 *  lookups (one Redis round trip, one Mongo query), not two per player. */
async function withPresence(users: any[], viewerId: string, followingIds: Set<string>) {
  const ids = users.map((u) => u._id.toString());
  const [onlineIds, gameCodes] = await Promise.all([
    getOnlineUserIds(ids),
    getActiveGameCodesForUsers(ids, viewerId),
  ]);
  return users.map((u) => {
    const id = u._id.toString();
    return {
      id: u._id,
      username: u.username,
      avatarUrl: u.avatarUrl,
      avatarGradient: u.avatarGradient ?? null,
      rating: u.rating,
      ratingCategory: u.ratingCategory,
      online: onlineIds.has(id),
      activeGameCode: gameCodes.get(id) ?? null,
      isFollowing: followingIds.has(id),
    };
  });
}

export const followUser = asyncHandler(async (req: AuthedRequest, res) => {
  const { userId: targetId } = followSchema.parse(req.body);
  const me = req.user!.id;
  if (targetId === me) throw ApiError.badRequest("You can't follow yourself");

  const target = await User.exists({ _id: targetId });
  if (!target) throw ApiError.notFound('User not found');

  // Idempotent: following someone you already follow is a no-op, not an error.
  const result = await Follow.updateOne(
    { follower: me, following: targetId },
    { $setOnInsert: { follower: me, following: targetId } },
    { upsert: true },
  );
  const created = result.upsertedCount > 0;

  if (created) {
    // Keyed by target so follow -> unfollow -> follow of the same person
    // can't be farmed for the daily challenge.
    trackDaily(me, { type: 'friend_request_sent', key: `follow:${targetId}` });
    // Deliberately silent: the person being followed gets no notification
    // and no live event, nothing tells them someone followed them.
  }

  res.status(created ? 201 : 200).json({ following: true });
});

export const unfollowUser = asyncHandler(async (req: AuthedRequest, res) => {
  const targetId = req.params.userId;
  if (!mongoose.isValidObjectId(targetId)) throw ApiError.badRequest('Invalid user');
  const me = req.user!.id;

  // Deliberately not pushed to the other person: being unfollowed is silent.
  await Follow.deleteOne({ follower: me, following: targetId });

  res.status(204).send();
});

/** Players the viewer follows. */
export const listFollowing = asyncHandler(async (req: AuthedRequest, res) => {
  const me = req.user!.id;
  const rows = await Follow.find({ follower: me })
    .sort({ createdAt: -1 })
    .limit(LIST_LIMIT)
    .populate('following', PLAYER_FIELDS)
    .lean();
  const users = rows.map((r) => r.following as any).filter(Boolean);
  const followingIds = new Set(users.map((u) => u._id.toString()));
  res.json({ following: await withPresence(users, me, followingIds) });
});

/** Players who follow the viewer, each flagged with whether the viewer
 *  follows them back (drives the "Follow back" button). */
export const listFollowers = asyncHandler(async (req: AuthedRequest, res) => {
  const me = req.user!.id;
  const rows = await Follow.find({ following: me })
    .sort({ createdAt: -1 })
    .limit(LIST_LIMIT)
    .populate('follower', PLAYER_FIELDS)
    .lean();
  const users = rows.map((r) => r.follower as any).filter(Boolean);

  const mine = await Follow.find({ follower: me, following: { $in: users.map((u) => u._id) } })
    .select('following')
    .lean();
  const followingIds = new Set(mine.map((f) => f.following.toString()));

  res.json({ followers: await withPresence(users, me, followingIds) });
});
