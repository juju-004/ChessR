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

// Mirrors the ids in client/src/lib/avatarGradients.ts — kept as a plain
// allow-list here (not colors, we don't need those server-side) so a
// gradient value can never end up holding an arbitrary/unstyled string.
const VALID_AVATAR_GRADIENTS = [
  'brand', 'sunset', 'ocean', 'forest', 'berry', 'fire', 'midnight', 'gold', 'rose', 'ice',
] as const;

const updateProfileSchema = z.object({
  avatarGradient: z.enum(VALID_AVATAR_GRADIENTS).optional(),
  bio: z.string().trim().max(160).optional(),
});

export const updateMyProfile = asyncHandler(async (req: AuthedRequest, res) => {
  const body = updateProfileSchema.parse(req.body);

  const update: Record<string, unknown> = {};
  if (body.avatarGradient !== undefined) update.avatarGradient = body.avatarGradient;
  if (body.bio !== undefined) update.bio = body.bio;

  const user = await User.findByIdAndUpdate(req.user!.id, update, { new: true })
    .select('username avatarUrl avatarGradient bio')
    .lean();
  if (!user) throw ApiError.notFound('User not found');

  res.json({
    username: user.username,
    avatarUrl: user.avatarUrl,
    avatarGradient: user.avatarGradient,
    bio: user.bio,
  });
});

export const searchUsers = asyncHandler(async (req, res) => {
  const { q } = searchSchema.parse(req.query);
  const regex = new RegExp('^' + q.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const users = await User.find({ usernameLower: regex })
    .select('username avatarUrl avatarGradient')
    .limit(20)
    .lean();

  res.json({ users });
});

export const getProfile = asyncHandler(async (req: AuthedRequest, res) => {
  const { username } = req.params;
  const user = await User.findOne({ usernameLower: username.toLowerCase() })
    .select('username avatarUrl avatarGradient bio friends createdAt')
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

  // Head-to-head record against whoever's looking at this profile — only
  // makes sense when someone's logged in and it's not their own profile.
  let h2h: { wins: number; losses: number; draws: number } | null = null;
  if (req.user && !isSelf) {
    const viewerId = req.user.id;
    const [viewerWins, viewerLosses, viewerDraws] = await Promise.all([
      Game.countDocuments({
        status: 'finished',
        $or: [
          { white: viewerId, black: user._id, result: 'white' },
          { white: user._id, black: viewerId, result: 'black' },
        ],
      }),
      Game.countDocuments({
        status: 'finished',
        $or: [
          { white: viewerId, black: user._id, result: 'black' },
          { white: user._id, black: viewerId, result: 'white' },
        ],
      }),
      Game.countDocuments({
        status: 'finished',
        result: 'draw',
        $or: [
          { white: viewerId, black: user._id },
          { white: user._id, black: viewerId },
        ],
      }),
    ]);
    const total = viewerWins + viewerLosses + viewerDraws;
    // null (not a zeroed object) when they've simply never played — lets
    // the client skip rendering the h2h card entirely rather than showing
    // an empty "0-0-0" for every stranger's profile.
    h2h = total > 0 ? { wins: viewerWins, losses: viewerLosses, draws: viewerDraws } : null;
  }

  res.json({
    id: user._id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    avatarGradient: user.avatarGradient,
    bio: user.bio,
    memberSince: user.createdAt,
    stats: { wins, losses, draws, gamesPlayed: wins + losses + draws },
    isFriend,
    isSelf,
    activeGameCode,
    h2h,
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
      .populate('white', 'username avatarGradient')
      .populate('black', 'username avatarGradient')
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
      // game.moves.length is a *ply* count (one entry per half-move — White's
      // e4 and Black's e5 are two separate entries). The number chess
      // players actually mean by "N moves" only increments once per full
      // move pair, so this needs to be halved (rounding up, since a game
      // can end mid-pair on White's move) rather than reported as-is.
      moveCount: Math.ceil(g.moves.length / 2),
      startedAt: g.startedAt,
      endedAt: g.endedAt,
    };
  });

  res.json({ games: items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
});
