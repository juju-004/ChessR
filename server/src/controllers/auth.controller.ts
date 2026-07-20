import bcrypt from 'bcrypt';
import type { Response } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../services/token.service.js';
import { env, isProd } from '../config/env.js';
import type { AuthedRequest } from '../middleware/auth.js';

const BCRYPT_ROUNDS = 12;
const REFRESH_COOKIE = 'refresh_token';

const signupSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, underscores'),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

const signinSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

function setRefreshCookie(res: Response, token: string) {
  // Local dev: frontend and backend look same-origin (Vite proxies /api), so
  // 'lax' + non-secure works over plain http://localhost. In production,
  // frontend (Vercel) and backend (Railway) are genuinely different origins —
  // browsers will not send a 'lax' cookie on that cross-site request at all,
  // which is exactly what silently breaks session restore after a real deploy.
  // 'none' requires secure:true (HTTPS), which both platforms provide by default.
  const crossOrigin = isProd;
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE || crossOrigin,
    sameSite: crossOrigin ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
}

export const signup = asyncHandler(async (req, res) => {
  const { username, email, password } = signupSchema.parse(req.body);

  const usernameLower = username.toLowerCase();
  const existing = await User.findOne({
    $or: [{ usernameLower }, { email: email.toLowerCase() }],
  });
  if (existing) {
    throw ApiError.conflict('Username or email already in use');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await User.create({ username, usernameLower, email, passwordHash });

  const accessToken = signAccessToken({ sub: user.id, username: user.username });
  const refreshToken = signRefreshToken(user.id, user.tokenVersion);
  setRefreshCookie(res, refreshToken);

  res.status(201).json({
    accessToken,
    user: { id: user.id, username: user.username, rating: user.rating },
  });
});

export const signin = asyncHandler(async (req, res) => {
  const { email, password } = signinSchema.parse(req.body);

  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  if (!user) throw ApiError.unauthorized('Invalid email or password');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized('Invalid email or password');

  const accessToken = signAccessToken({ sub: user.id, username: user.username });
  const refreshToken = signRefreshToken(user.id, user.tokenVersion);
  setRefreshCookie(res, refreshToken);

  res.json({
    accessToken,
    user: { id: user.id, username: user.username, rating: user.rating },
  });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized('Missing refresh token');

  let payload: { sub: string; tokenVersion: number };
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const user = await User.findById(payload.sub);
  if (!user || user.tokenVersion !== payload.tokenVersion) {
    throw ApiError.unauthorized('Refresh token has been revoked');
  }

  const accessToken = signAccessToken({ sub: user.id, username: user.username });
  // Rotate the refresh token to limit replay-attack windows.
  const newRefreshToken = signRefreshToken(user.id, user.tokenVersion);
  setRefreshCookie(res, newRefreshToken);

  res.json({
    accessToken,
    user: { id: user.id, username: user.username, rating: user.rating },
  });
});

export const logout = asyncHandler(async (req, res) => {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.status(204).send();
});

export const me = asyncHandler(async (req: AuthedRequest, res) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound('User not found');
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    rating: user.rating,
    friendCount: user.friends.length,
  });
});
