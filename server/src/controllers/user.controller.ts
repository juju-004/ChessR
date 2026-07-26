import { z } from 'zod';
import { User } from '../models/User.js';
import { Game } from '../models/Game.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getActiveGameCodeForUser } from '../services/game.service.js';
import type { AuthedRequest } from '../middleware/auth.js';

const searchSchema = z.object({
  q: z.string().trim().min(1).max(24),
});

export const searchUsers = asyncHandler(async (req, res) => {
  const { q } = searchSchema.parse(req.query);
  const regex = new RegExp('^' + q.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const users = await User.find({ usernameLower: regex })
    .select('username avatarUrl')
    .limit(20)
    .lean();

  res.json({ users });
});

export const getProfile = asyncHandler(async (req: AuthedRequest, res) => {
  const { username } = req.params;
  const user = await User.findOne({ usernameLower: username.toLowerCase() })
    .select('username avatarUrl friends createdAt')
    .lean();

  if (!user) throw ApiError.notFound('User not found');

  const [wins, losses, draws] = await Promise.all([
    Game.countDocuments({
      status: 'finished',
      $or: [
        { white: user._id, result: 'white' },
        { black: user._id, result: 'black' },
      ],
    }),
    Game.countDocuments({
      status: 'finished',
      $or: [
        { white: user._id, result: 'black' },
        { black: user._id, result: 'white' },
      ],
    }),
    Game.countDocuments({
      status: 'finished',
      result: 'draw',
      $or: [{ white: user._id }, { black: user._id }],
    }),
  ]);

  const isFriend = req.user ? user.friends.some((f) => f.toString() === req.user!.id) : false;
  const isSelf = req.user?.id === user._id.toString();
  // Only worth checking once we know it isn't the viewer's own profile —
  // there's no "watch yourself" button to show either way.
  const activeGameCode = isSelf ? null : await getActiveGameCodeForUser(user._id.toString());

  res.json({
    id: user._id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    memberSince: user.createdAt,
    stats: { wins, losses, draws, gamesPlayed: wins + losses + draws },
    isFriend,
    isSelf,
    activeGameCode,
  });
});

const gamesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const getUserGames = asyncHandler(async (req, res) => {
  const { username } = req.params;
  const { page, limit } = gamesQuerySchema.parse(req.query);

  const user = await User.findOne({ usernameLower: username.toLowerCase() }).select('_id').lean();
  if (!user) throw ApiError.notFound('User not found');

  const filter = {
    status: 'finished' as const,
    $or: [{ white: user._id }, { black: user._id }],
  };

  const [games, total] = await Promise.all([
    Game.find(filter)
      .sort({ endedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('white', 'username')
      .populate('black', 'username')
      .select('joinCode white black result endReason timeControl moves startedAt endedAt')
      .lean(),
    Game.countDocuments(filter),
  ]);

  const items = games.map((g) => {
    const isWhite = g.white._id.toString() === user._id.toString();
    const myResult: 'win' | 'loss' | 'draw' =
      g.result === 'draw' ? 'draw' : g.result === (isWhite ? 'white' : 'black') ? 'win' : 'loss';
    return {
      gameId: g._id,
      joinCode: g.joinCode,
      opponent: isWhite ? g.black : g.white,
      color: isWhite ? 'white' : 'black',
      result: myResult,
      endReason: g.endReason,
      timeControl: g.timeControl,
      moveCount: g.moves.length,
      startedAt: g.startedAt,
      endedAt: g.endedAt,
    };
  });

  res.json({ games: items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
});
