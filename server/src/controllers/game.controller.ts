import { z } from 'zod';
import mongoose from 'mongoose';
import { Game } from '../models/Game.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  createOpenGame,
  joinOpenGame,
  listOpenGames,
  getGameByCode,
} from '../services/game.service.js';
import type { AuthedRequest } from '../middleware/auth.js';

const createSchema = z.object({
  isPrivate: z.boolean().optional().default(false),
  // null/omitted baseMinutes = unlimited time.
  baseMinutes: z.number().min(1).max(180).nullable().optional().default(10),
  incrementSeconds: z.number().min(0).max(60).optional().default(0),
});
const idParamSchema = z.object({ id: z.string().refine(mongoose.isValidObjectId) });
const codeParamSchema = z.object({ code: z.string().min(4).max(10) });

export const createGame = asyncHandler(async (req: AuthedRequest, res) => {
  const { isPrivate, baseMinutes, incrementSeconds } = createSchema.parse(req.body ?? {});
  const game = await createOpenGame(
    req.user!.id,
    { baseMinutes: baseMinutes ?? null, incrementSeconds },
    isPrivate,
  );
  res.status(201).json({
    gameId: game.id,
    joinCode: game.joinCode,
    status: game.status,
    isPrivate: game.isPrivate,
  });
});

export const joinGame = asyncHandler(async (req: AuthedRequest, res) => {
  const { id } = idParamSchema.parse(req.params);
  const game = await joinOpenGame(id, req.user!.id);
  res.json({
    gameId: game.id,
    joinCode: game.joinCode,
    status: game.status,
    white: game.white,
    black: game.black,
    fen: game.fen,
  });
});

export const getOpenGames = asyncHandler(async (req: AuthedRequest, res) => {
  const games = await listOpenGames(req.user?.id);
  res.json({ games });
});

export const getGame = asyncHandler(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const game = await Game.findById(id)
    .populate('white', 'username rating')
    .populate('black', 'username rating')
    .lean();
  if (!game) throw ApiError.notFound('Game not found');
  res.json({ game });
});

export const getGameByCodeHandler = asyncHandler(async (req, res) => {
  const { code } = codeParamSchema.parse(req.params);
  const game = await getGameByCode(code);
  res.json({ game });
});
