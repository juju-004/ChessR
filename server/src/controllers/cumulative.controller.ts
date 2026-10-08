import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { MAX_CUMULATIVE_TOURNAMENTS, MIN_CUMULATIVE_TOURNAMENTS } from "../models/CumulativeLeague.js";
import {
  createCumulative,
  deleteCumulative,
  getCumulative,
  getCumulativeStandings,
  listCumulatives,
  listMyCumulatives,
} from "../services/cumulative.service.js";

const idParamSchema = z.object({ id: z.string().length(24) });
const standingsQuerySchema = z.object({ tournament: z.string().min(4).max(24).optional() });
const createSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(500).nullable().optional(),
  maxTournaments: z.number().int().min(MIN_CUMULATIVE_TOURNAMENTS).max(MAX_CUMULATIVE_TOURNAMENTS),
});

export const getAll = asyncHandler(async (req, res) => {
  const userId = (req as AuthedRequest).user?.id;
  res.json({ cumulatives: await listCumulatives(userId) });
});

export const getMine = asyncHandler(async (req: AuthedRequest, res) => {
  res.json({ cumulatives: await listMyCumulatives(req.user!.id) });
});

export const create = asyncHandler(async (req: AuthedRequest, res) => {
  const input = createSchema.parse(req.body);
  res.status(201).json({ cumulative: await createCumulative(req.user!.id, input) });
});

export const getOne = asyncHandler(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const userId = (req as AuthedRequest).user?.id;
  res.json(await getCumulative(id, userId));
});

export const getStandings = asyncHandler(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const { tournament } = standingsQuerySchema.parse(req.query);
  res.json(await getCumulativeStandings(id, tournament));
});

export const remove = asyncHandler(async (req: AuthedRequest, res) => {
  const { id } = idParamSchema.parse(req.params);
  await deleteCumulative(id, req.user!.id);
  res.status(204).end();
});
