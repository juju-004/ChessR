import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getCageMatchByCode, listMyCageMatches } from '../services/cageMatch.service.js';
import type { AuthedRequest } from '../middleware/auth.js';

// Accepts either a short matchCode (e.g. "AB3XY9") or a full 24-char Mongo
// ObjectId, the latter is what a leg's game page links back with, since it
// only knows the cage match's _id, not its human-friendly matchCode.
const codeParamSchema = z.object({ code: z.string().min(4).max(24) });

const mineQuerySchema = z.object({
  scope: z.enum(['finished']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export const getMyCageMatches = asyncHandler(async (req: AuthedRequest, res) => {
  const { scope, page, limit } = mineQuerySchema.parse(req.query);
  res.json(await listMyCageMatches(req.user!.id, { scope, page, limit }));
});

export const getCageMatchByCodeHandler = asyncHandler(async (req, res) => {
  const { code } = codeParamSchema.parse(req.params);
  const match = await getCageMatchByCode(code);
  res.json({ match });
});
