import bcrypt from "bcrypt";
import type { Response } from "express";
import { z } from "zod";
import { User, type IUser } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../services/token.service.js";
import { env, isProd } from "../config/env.js";
import { getRatingCategory, gamesUntilRanked } from "../services/rating.service.js";
import {
  issueEmailVerification,
  consumeEmailVerificationToken,
} from "../services/verification.service.js";
import { verifyGoogleCredential } from "../services/googleAuth.service.js";
import type { AuthedRequest } from "../middleware/auth.js";

const BCRYPT_ROUNDS = 12;
const REFRESH_COOKIE = "refresh_token";

const signupSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username may only contain letters, numbers, underscores",
    ),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

const signinSchema = z.object({
  // Accepts either an email or a username — signin() below sniffs which
  // one it's looking at and queries accordingly. Not further validated
  // as an email/username shape here since it might be either.
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

const googleSigninSchema = z.object({
  // The ID token JWT Google Identity Services hands the client directly —
  // see googleAuth.service.ts for what actually happens to it server-side.
  credential: z.string().min(1),
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
    sameSite: crossOrigin ? "none" : "lax",
    path: "/api/auth",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
}

function ratingFields(user: { rating: number; ratedGamesPlayed: number }) {
  return {
    ratingCategory: getRatingCategory(user.rating, user.ratedGamesPlayed),
    ratedGamesUntilRanked: gamesUntilRanked(user.ratedGamesPlayed),
  };
}

function userFields(user: IUser) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatarGradient: user.avatarGradient ?? null,
    emailVerified: user.emailVerified,
    ...ratingFields(user),
  };
}

function issueSession(res: Response, user: IUser) {
  const accessToken = signAccessToken({
    sub: user.id,
    username: user.username,
  });
  const refreshToken = signRefreshToken(user.id, user.tokenVersion);
  setRefreshCookie(res, refreshToken);
  return accessToken;
}

/** Turns "Ada Lovelace" / "ada.lovelace@site.com" into a username-shaped,
 *  available slug — strips anything outside [a-zA-Z0-9_], pads short
 *  results, truncates long ones, and appends a numeric suffix until it
 *  finds one nobody's taken yet. Used only for brand-new Google sign-ins,
 *  where there's no username the person typed themselves to fall back on. */
async function generateAvailableUsername(seed: string): Promise<string> {
  const base =
    seed
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_]/g, "")
      .slice(0, 20) || "player";
  const padded = base.length >= 3 ? base : `${base}player`.slice(0, 20);

  for (let suffix = 0; suffix < 1000; suffix++) {
    const candidate = suffix === 0 ? padded : `${padded}${suffix}`.slice(0, 24);
    const usernameLower = candidate.toLowerCase();
    // eslint-disable-next-line no-await-in-loop
    const taken = await User.exists({ usernameLower });
    if (!taken) return candidate;
  }
  // Astronomically unlikely to be reached, but keeps the function total.
  return `player${Date.now()}`;
}

export const signup = asyncHandler(async (req, res) => {
  const { username, email, password } = signupSchema.parse(req.body);

  const usernameLower = username.toLowerCase();
  const existing = await User.findOne({
    $or: [{ usernameLower }, { email: email.toLowerCase() }],
  });
  if (existing) {
    throw ApiError.conflict("Username or email already in use");
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await User.create({
    username,
    usernameLower,
    email,
    passwordHash,
  });

  // Fire off the verification email, but don't let a mail-provider hiccup
  // fail account creation — the account exists either way, and "resend
  // verification" (see resendVerification below) covers this if the first
  // send silently drops.
  issueEmailVerification(user).catch((err) =>
    console.error("Failed to send verification email on signup:", err),
  );

  const accessToken = issueSession(res, user);

  res.status(201).json({
    accessToken,
    user: userFields(user),
  });
});

export const signin = asyncHandler(async (req, res) => {
  const { identifier, password } = signinSchema.parse(req.body);

  // A bare heuristic ("contains an @") is enough to tell email and
  // username apart here — usernames are restricted to
  // [a-zA-Z0-9_] at signup, so they can never contain one.
  const isEmail = identifier.includes("@");
  const user = await User.findOne(
    isEmail
      ? { email: identifier.toLowerCase() }
      : { usernameLower: identifier.toLowerCase() },
  ).select("+passwordHash");
  if (!user) throw ApiError.unauthorized("Invalid username/email or password");

  if (!user.passwordHash) {
    // A Google-only account trying the password form — bcrypt.compare
    // against nothing isn't meaningful, and "invalid password" would be a
    // confusing dead end for someone who's never set one.
    throw ApiError.unauthorized(
      "This account signs in with Google. Use \"Continue with Google\" instead.",
    );
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized("Invalid username/email or password");

  const accessToken = issueSession(res, user);

  res.json({
    accessToken,
    user: userFields(user),
  });
});

export const googleSignin = asyncHandler(async (req, res) => {
  const { credential } = googleSigninSchema.parse(req.body);
  const profile = await verifyGoogleCredential(credential);

  let user = await User.findOne({ googleId: profile.googleId });
  // Only true for the "brand new account, just this instant" branch below
  // — an existing account (found by googleId OR linked by email) is never
  // "new" even on its first-ever Google sign-in. Told to the client so it
  // knows whether to route through the one-time "pick a username" step
  // (see ChooseUsername.tsx) rather than straight to the dashboard.
  let isNewUser = false;

  if (!user) {
    // Not seen this Google account before — but if the email matches an
    // existing local (password) account, link Google onto it rather than
    // creating a duplicate account under the same address (the unique
    // index on email would reject that anyway, but this gives a much
    // better outcome: one account, now signable-into either way).
    user = await User.findOne({ email: profile.email.toLowerCase() });
    if (user) {
      user.googleId = profile.googleId;
      if (profile.emailVerified) user.emailVerified = true;
      await user.save();
    } else {
      const username = await generateAvailableUsername(profile.name);
      user = await User.create({
        username,
        usernameLower: username.toLowerCase(),
        email: profile.email,
        googleId: profile.googleId,
        // Google already owns and verifies this address, so there's no
        // "click the link" step needed on top of that — trust its claim
        // the same way every "Sign in with Google" button elsewhere does.
        emailVerified: profile.emailVerified,
      });
      isNewUser = true;
    }
  }

  const accessToken = issueSession(res, user);

  res.json({
    accessToken,
    user: userFields(user),
    isNewUser,
  });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized("Missing refresh token");

  let payload: { sub: string; tokenVersion: number };
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const user = await User.findById(payload.sub);
  if (!user || user.tokenVersion !== payload.tokenVersion) {
    throw ApiError.unauthorized("Refresh token has been revoked");
  }

  const accessToken = signAccessToken({
    sub: user.id,
    username: user.username,
  });
  // Rotate the refresh token to limit replay-attack windows.
  const newRefreshToken = signRefreshToken(user.id, user.tokenVersion);
  setRefreshCookie(res, newRefreshToken);

  res.json({
    accessToken,
    user: userFields(user),
  });
});

export const logout = asyncHandler(async (_req, res) => {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  res.status(204).send();
});

export const me = asyncHandler(async (req: AuthedRequest, res) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound("User not found");
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    avatarGradient: user.avatarGradient ?? null,
    emailVerified: user.emailVerified,
    tokenBalance: user.tokenBalance,
    friendCount: user.friends.length,
    ...ratingFields(user),
  });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = verifyEmailSchema.parse(req.body);
  const user = await consumeEmailVerificationToken(token);
  if (!user) {
    throw ApiError.badRequest("This verification link is invalid or has expired.");
  }
  res.json({ verified: true });
});

export const resendVerification = asyncHandler(async (req: AuthedRequest, res) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound("User not found");
  if (user.emailVerified) {
    res.json({ alreadyVerified: true });
    return;
  }
  await issueEmailVerification(user);
  res.json({ sent: true });
});
