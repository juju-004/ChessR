import { z } from 'zod';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { FriendRequest } from '../models/FriendRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getUserSocketIds } from '../services/presence.service.js';
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
    User.findById(fromUserId).select('username friends'),
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

  const request = await FriendRequest.create({ from: fromUserId, to: toUserId });

  await pushToUser(toUserId, 'friend:request_received', {
    requestId: request.id,
    from: { id: fromUserId, username: fromUser!.username },
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
    .populate('friends', 'username rating avatarUrl')
    .lean();
  if (!user) throw ApiError.notFound('User not found');

  const withPresence = await Promise.all(
    (user.friends as any[]).map(async (f) => ({
      id: f._id,
      username: f.username,
      rating: f.rating,
      avatarUrl: f.avatarUrl,
      online: (await getUserSocketIds(f._id.toString())).length > 0,
    })),
  );

  res.json({ friends: withPresence });
});

export const listIncomingRequests = asyncHandler(async (req: AuthedRequest, res) => {
  const requests = await FriendRequest.find({ to: req.user!.id, status: 'pending' })
    .populate('from', 'username rating avatarUrl')
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

  res.status(204).send();
});
