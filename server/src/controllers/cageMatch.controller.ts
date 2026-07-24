import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getCageMatchByCode, listMyCageMatches } from '../services/cageMatch.service.js';
import type { AuthedRequest } from '../middleware/auth.js';

const codeParamSchema = z.object({ code: z.string().min(4).max(10) });

export const getMyCageMatches = asyncHandler(async (req: AuthedRequest, res) => {
  const matches = await listMyCageMatches(req.user!.id);
  res.json({ matches });
});

export const getCageMatchByCodeHandler = asyncHandler(async (req, res) => {
  const { code } = codeParamSchema.parse(req.params);
  const match = await getCageMatchByCode(code);
  res.json({ match });
});
