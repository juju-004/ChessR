import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getTournamentByCode,
  listTournaments,
  listMyTournaments,
} from "../services/tournament.service.js";
import type { AuthedRequest } from "../middleware/auth.js";

const codeParamSchema = z.object({ code: z.string().min(4).max(24) });
const listQuerySchema = z.object({
  status: z.enum(["pending", "active", "finished"]).optional(),
});

export const getOpenTournaments = asyncHandler(async (req, res) => {
  const { status } = listQuerySchema.parse(req.query);
  const tournaments = await listTournaments(status);
  res.json({ tournaments });
});

const mineQuerySchema = z.object({
  scope: z.enum(["finished"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  // Capped well below anything that could pull the whole history at once.
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export const getMyTournaments = asyncHandler(async (req: AuthedRequest, res) => {
  const { scope, page, limit } = mineQuerySchema.parse(req.query);
  res.json(await listMyTournaments(req.user!.id, { scope, page, limit }));
});

export const getTournamentByCodeHandler = asyncHandler(async (req, res) => {
  const { code } = codeParamSchema.parse(req.params);
  const tournament = await getTournamentByCode(code);
  res.json({ tournament });
});
