import crypto from 'node:crypto';
import { User, type IUser } from '../models/User.js';
import { env } from '../config/env.js';
import { sendVerificationEmail } from './mailer.service.js';

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Generates a fresh verification token for `user`, stores only its hash
 * (same reasoning as a password reset flow, the raw token lives in the
 * emailed link and nowhere else, so a database read alone can never be
 * used to verify someone else's address), and emails the link. Safe to
 * call repeatedly (e.g. "resend email"), each call overwrites any
 * previous outstanding token, invalidating it.
 */
export async function issueEmailVerification(user: IUser): Promise<void> {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  user.emailVerificationTokenHash = hashToken(rawToken);
  user.emailVerificationExpires = new Date(Date.now() + TOKEN_TTL_MS);
  await user.save();

  const verifyUrl = `${env.CLIENT_ORIGIN}/verify-email?token=${rawToken}`;
  await sendVerificationEmail(user.email, user.username, verifyUrl);
}

/**
 * Looks up the user matching `rawToken`'s hash, checks it hasn't expired,
 * marks them verified, and clears the token so it can't be reused. Returns
 * null (rather than throwing) for any invalid/expired/already-used token, 
 * the controller turns that into a 400, but "token not found" and "token
 * expired" deliberately look identical to the caller so this can't be used
 * to fish for which case applies.
 */
export async function consumeEmailVerificationToken(rawToken: string): Promise<IUser | null> {
  const tokenHash = hashToken(rawToken);
  const user = await User.findOne({
    emailVerificationTokenHash: tokenHash,
    emailVerificationExpires: { $gt: new Date() },
  }).select('+emailVerificationTokenHash +emailVerificationExpires');

  if (!user) return null;

  user.emailVerified = true;
  user.emailVerificationTokenHash = undefined;
  user.emailVerificationExpires = undefined;
  await user.save();
  return user;
}
