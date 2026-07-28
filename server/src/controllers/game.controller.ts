import { z } from "zod";
import mongoose from "mongoose";
import { Game } from "../models/Game.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createOpenGame,
  joinOpenGame,
  cancelOpenGame,
  listOpenGames,
  listMyActiveGames,
  getGameByCode,
  listFriendsActiveGames,
} from "../services/game.service.js";
import type { AuthedRequest } from "../middleware/auth.js";

// Sanity ceiling on a single wager — not a business limit, just a guard
// against fat-fingered/garbage input reaching the wallet layer.
const MAX_WAGER_TOKENS = 100_000;

const createSchema = z.object({
  isPrivate: z.boolean().optional().default(false),
  variant: z.enum(["standard", "chess960"]).optional().default("standard"),
  // null/omitted baseMinutes = unlimited time.
  baseMinutes: z.number().min(1).max(180).nullable().optional().default(10),
  incrementSeconds: z.number().min(0).max(60).optional().default(0),
  wagerTokens: z
    .number()
    .int()
    .min(0)
    .max(MAX_WAGER_TOKENS)
    .optional()
    .default(0),
});
const idParamSchema = z.object({
  id: z.string().refine(mongoose.isValidObjectId),
});
const codeParamSchema = z.object({ code: z.string().min(4).max(10) });

export const createGame = asyncHandler(async (req: AuthedRequest, res) => {
  const { isPrivate, variant, baseMinutes, incrementSeconds, wagerTokens } =
    createSchema.parse(req.body ?? {});
  const game = await createOpenGame(
    req.user!.id,
    { baseMinutes: baseMinutes ?? null, incrementSeconds },
    variant,
    isPrivate,
    wagerTokens,
  );
  res.status(201).json({
    gameId: game.id,
    joinCode: game.joinCode,
    variant: game.variant,
    status: game.status,
    isPrivate: game.isPrivate,
    wagerTokens: game.wagerTokens,
  });
});

export const cancelGame = asyncHandler(async (req: AuthedRequest, res) => {
  const { id } = idParamSchema.parse(req.params);
  await cancelOpenGame(id, req.user!.id);
  res.status(204).send();
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

export const getOpenGames = asyncHandler(async (_req: AuthedRequest, res) => {
  // Deliberately includes the caller's own open games now — the client needs
  // to see them to offer a "Cancel" action instead of a "Join" one.
  const games = await listOpenGames();
  res.json({ games });
});

export const getGame = asyncHandler(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const game = await Game.findById(id)
    .populate("white", "username")
    .populate("black", "username")
    .lean();
  if (!game) throw ApiError.notFound("Game not found");
  res.json({ game });
});

export const getFriendsActiveGames = asyncHandler(
  async (req: AuthedRequest, res) => {
    const games = await listFriendsActiveGames(req.user!.id);
    res.json({ games });
  },
);

export const getMyActiveGames = asyncHandler(
  async (req: AuthedRequest, res) => {
    const games = await listMyActiveGames(req.user!.id);
    res.json({ games });
  },
);

export const getGameByCodeHandler = asyncHandler(async (req, res) => {
  const { code } = codeParamSchema.parse(req.params);
  const game = await getGameByCode(code);
  res.json({ game });
});
