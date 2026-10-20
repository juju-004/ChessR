import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { getSeasonLeaderboard, listPastSeasons } from '../services/seasonLeaderboard.service.js';

const seasonParam = z.object({ season: z.coerce.number().int().min(1) });

export const getCurrent = asyncHandler(async (req, res) => {
  res.json(await getSeasonLeaderboard('current', (req as AuthedRequest).user?.id));
});

export const getSeason = asyncHandler(async (req, res) => {
  const { season } = seasonParam.parse(req.params);
  res.json(await getSeasonLeaderboard(season, (req as AuthedRequest).user?.id));
});

export const getPast = asyncHandler(async (_req, res) => {
  res.json({ seasons: await listPastSeasons() });
});
