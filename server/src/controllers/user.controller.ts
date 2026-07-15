import { z } from 'zod';
import { User } from '../models/User.js';
import { Game } from '../models/Game.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthedRequest } from '../middleware/auth.js';

const searchSchema = z.object({
  q: z.string().trim().min(1).max(24),
});

export const searchUsers = asyncHandler(async (req, res) => {
  const { q } = searchSchema.parse(req.query);

  // Prefix match on the normalized username — uses the usernameLower index.
  const regex = new RegExp('^' + q.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const users = await User.find({ usernameLower: regex })
    .select('username rating avatarUrl')
    .limit(20)
    .lean();

  res.json({ users });
});

export const getProfile = asyncHandler(async (req: AuthedRequest, res) => {
  const { username } = req.params;
  const user = await User.findOne({ usernameLower: username.toLowerCase() })
    .select('username rating avatarUrl friends createdAt')
    .lean();

  if (!user) throw ApiError.notFound('User not found');

  const [gamesPlayed, wins] = await Promise.all([
    Game.countDocuments({
      status: 'finished',
      $or: [{ white: user._id }, { black: user._id }],
    }),
    Game.countDocuments({
      status: 'finished',
      $or: [
        { white: user._id, result: 'white' },
        { black: user._id, result: 'black' },
      ],
    }),
  ]);

  const isFriend = req.user
    ? user.friends.some((f) => f.toString() === req.user!.id)
    : false;
  const isSelf = req.user?.id === user._id.toString();

  res.json({
    id: user._id,
    username: user.username,
    rating: user.rating,
    avatarUrl: user.avatarUrl,
    memberSince: user.createdAt,
    stats: { gamesPlayed, wins },
    isFriend,
    isSelf,
  });
});
