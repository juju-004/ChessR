import { z } from 'zod';
import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import {
  createRace,
  joinRace,
  leaveRace,
  cancelRace,
  requestStart,
  listOpenRaces,
  getMyCurrentRace,
  getPublicRaceByCode,
  PUZZLE_RACE_MIN_PLAYERS,
  PUZZLE_RACE_MAX_PLAYERS,
  PUZZLE_RACE_MIN_PUZZLES,
  PUZZLE_RACE_MAX_PUZZLES,
} from '../services/puzzleRace.service.js';

// Same limits as game.controller.ts (keep in sync with client/src/lib/limits.ts).
const MAX_WAGER_TOKENS = 9_999_999;
const MIN_STAKE_TOKENS = 10;

const createSchema = z.object({
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'),
  puzzleCount: z.number().int().min(PUZZLE_RACE_MIN_PUZZLES).max(PUZZLE_RACE_MAX_PUZZLES).default(5),
  maxPlayers: z.number().int().min(PUZZLE_RACE_MIN_PLAYERS).max(PUZZLE_RACE_MAX_PLAYERS).default(4),
  wagerTokens: z
    .number()
    .int()
    .min(0)
    .max(MAX_WAGER_TOKENS)
    .refine(
      (v) => v === 0 || v >= MIN_STAKE_TOKENS,
      `A wager must either be 0 (free race) or at least ${MIN_STAKE_TOKENS} R`,
    )
    .default(0),
});
const idParamSchema = z.object({ id: z.string().refine(mongoose.isValidObjectId) });
const codeParamSchema = z.object({ code: z.string().min(4).max(10) });

export const createPuzzleRace = asyncHandler(async (req: AuthedRequest, res) => {
  const input = createSchema.parse(req.body ?? {});
  const race = await createRace(req.user!.id, input);
  res.status(201).json({ id: race.id, code: race.code });
});

export const joinPuzzleRace = asyncHandler(async (req: AuthedRequest, res) => {
  const { id } = idParamSchema.parse(req.params);
  const race = await joinRace(id, req.user!.id);
  res.json({ id: race.id, code: race.code });
});

export const leavePuzzleRace = asyncHandler(async (req: AuthedRequest, res) => {
  const { id } = idParamSchema.parse(req.params);
  await leaveRace(id, req.user!.id);
  res.status(204).send();
});

export const cancelPuzzleRace = asyncHandler(async (req: AuthedRequest, res) => {
  const { id } = idParamSchema.parse(req.params);
  await cancelRace(id, req.user!.id);
  res.status(204).send();
});

export const startPuzzleRace = asyncHandler(async (req: AuthedRequest, res) => {
  const { id } = idParamSchema.parse(req.params);
  await requestStart(id, req.user!.id);
  res.status(204).send();
});

export const listOpenPuzzleRaces = asyncHandler(async (_req, res) => {
  res.json({ races: await listOpenRaces() });
});

export const getMyPuzzleRace = asyncHandler(async (req: AuthedRequest, res) => {
  res.json({ race: await getMyCurrentRace(req.user!.id) });
});

export const getPuzzleRaceByCode = asyncHandler(async (req, res) => {
  const { code } = codeParamSchema.parse(req.params);
  res.json({ race: await getPublicRaceByCode(code) });
});
