import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getTournamentSummaryByCode,
  getTournamentRound,
  getTournamentPlayerDetails,
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
  const tournament = await getTournamentSummaryByCode(code);
  res.json({ tournament });
});

const roundParamSchema = z.object({
  code: z.string().min(4).max(24),
  index: z.coerce.number().int().min(0).max(100_000),
});

/** One round's full pairings, fetched when a round tab is opened. */
export const getTournamentRoundHandler = asyncHandler(async (req, res) => {
  const { code, index } = roundParamSchema.parse(req.params);
  res.json({ round: await getTournamentRound(code, index) });
});

const playerParamSchema = z.object({
  code: z.string().min(4).max(24),
  userId: z.string().length(24),
});

/** A player's full stats and own pairings, fetched when their row is opened. */
export const getTournamentPlayerHandler = asyncHandler(async (req, res) => {
  const { code, userId } = playerParamSchema.parse(req.params);
  res.json(await getTournamentPlayerDetails(code, userId));
});
