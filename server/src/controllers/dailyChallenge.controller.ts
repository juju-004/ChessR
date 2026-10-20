import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { getDailyChallengeState } from '../services/dailyChallenge.service.js';

export const getDailyChallenges = asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await getDailyChallengeState(req.user!.id));
});
