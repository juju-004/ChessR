import { z } from 'zod';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { FriendRequest } from '../models/FriendRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getUserSocketIds } from '../services/presence.service.js';
import { getActiveGameCodeForUser } from '../services/game.service.js';
import { getRatingCategory } from '../services/rating.service.js';
import { getIo } from '../sockets/io.js';
import type { AuthedRequest } from '../middleware/auth.js';

const requestSchema = z.object({ toUserId: z.string().refine(mongoose.isValidObjectId) });
const respondSchema = z.object({
  requestId: z.string().refine(mongoose.isValidObjectId),
  accept: z.boolean(),
});

async function pushToUser(userId: string, event: string, payload: unknown) {
  const socketIds = await getUserSocketIds(userId);
  if (socketIds.length === 0) return;
  const io = getIo();
  for (const id of socketIds) io.to(id).emit(event, payload);
}

export const sendFriendRequest = asyncHandler(async (req: AuthedRequest, res) => {
  const { toUserId } = requestSchema.parse(req.body);
  const fromUserId = req.user!.id;

  if (toUserId === fromUserId) throw ApiError.badRequest("You can't friend yourself");

  const [toUser, fromUser] = await Promise.all([
    User.findById(toUserId).select('username friends'),
    User.findById(fromUserId).select('username friends avatarGradient rating ratedGamesPlayed'),
  ]);
  if (!toUser) throw ApiError.notFound('User not found');

  if (fromUser!.friends.some((f) => f.toString() === toUserId)) {
    throw ApiError.conflict('Already friends');
  }

  const existing = await FriendRequest.findOne({
    $or: [
      { from: fromUserId, to: toUserId },
      { from: toUserId, to: fromUserId },
    ],
    status: 'pending',
  });
  if (existing) throw ApiError.conflict('A pending request already exists');

  let request;
  try {
    request = await FriendRequest.create({ from: fromUserId, to: toUserId });
  } catch (err: any) {
    // Backstop for an environment where the partial-unique-index migration
    // (see FriendRequest.ts) hasn't been applied yet, in that window the
    // old blanket unique index can still reject this the moment there's
    // any prior resolved request between this pair, this at least turns
    // that into a clean, expected-looking error instead of a raw 500.
    if (err?.code === 11000) {
      throw ApiError.conflict('A pending request already exists');
    }
    throw err;
  }

  await pushToUser(toUserId, 'friend:request_received', {
    requestId: request.id,
    from: {
      id: fromUserId,
      username: fromUser!.username,
      avatarGradient: fromUser!.avatarGradient ?? null,
      ratingCategory: getRatingCategory(fromUser!.rating, fromUser!.ratedGamesPlayed),
    },
  });

  res.status(201).json({ requestId: request.id, status: request.status });
});

export const respondToFriendRequest = asyncHandler(async (req: AuthedRequest, res) => {
  const { requestId, accept } = respondSchema.parse(req.body);
  const userId = req.user!.id;

  const request = await FriendRequest.findById(requestId);
  if (!request) throw ApiError.notFound('Friend request not found');
  if (request.to.toString() !== userId) throw ApiError.forbidden();
  if (request.status !== 'pending') throw ApiError.conflict('Request already resolved');

  request.status = accept ? 'accepted' : 'declined';
  await request.save();

  if (accept) {
    await Promise.all([
      User.updateOne({ _id: request.from }, { $addToSet: { friends: request.to } }),
      User.updateOne({ _id: request.to }, { $addToSet: { friends: request.from } }),
    ]);
  }

  await pushToUser(request.from.toString(), 'friend:request_resolved', {
    requestId: request.id,
    accepted: accept,
    by: userId,
  });

  res.json({ requestId: request.id, status: request.status });
});

export const listFriends = asyncHandler(async (req: AuthedRequest, res) => {
  const user = await User.findById(req.user!.id)
    .populate('friends', 'username avatarUrl avatarGradient rating ratedGamesPlayed')
    .lean();
  if (!user) throw ApiError.notFound('User not found');

  const withPresence = await Promise.all(
    (user.friends as any[]).map(async (f) => ({
      id: f._id,
      username: f.username,
      avatarUrl: f.avatarUrl,
      avatarGradient: f.avatarGradient ?? null,
      ratingCategory: getRatingCategory(f.rating, f.ratedGamesPlayed),
      online: (await getUserSocketIds(f._id.toString())).length > 0,
      activeGameCode: await getActiveGameCodeForUser(f._id.toString(), req.user!.id),
    })),
  );

  res.json({ friends: withPresence });
});

export const listIncomingRequests = asyncHandler(async (req: AuthedRequest, res) => {
  const requests = await FriendRequest.find({ to: req.user!.id, status: 'pending' })
    .populate('from', 'username avatarUrl avatarGradient')
    .lean();
  res.json({ requests });
});

export const removeFriend = asyncHandler(async (req: AuthedRequest, res) => {
  const friendId = req.params.friendId;
  const userId = req.user!.id;

  await Promise.all([
    User.updateOne({ _id: userId }, { $pull: { friends: friendId } }),
    User.updateOne({ _id: friendId }, { $pull: { friends: userId } }),
  ]);

  // Removing a friend used to be silent on the other end, nothing told
  // their client the friendship was gone, so it kept showing up in their
  // friends list (and "Friends"/an active Unfriend button on your
  // profile, from their side) until they happened to reload. Same fix
  // shape as friend:request_resolved above, just for this action.
  await pushToUser(friendId, 'friend:removed', { by: userId });

  res.status(204).send();
});
