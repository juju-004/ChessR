import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessTokenPayload {
  sub: string; // userId
  username: string;
}

export interface AdminTokenPayload {
  sub: 'admin';
  role: 'admin';
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL as any });
}

export function signRefreshToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ sub: userId, tokenVersion }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL as any,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string; tokenVersion: number } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string; tokenVersion: number };
}

// Admin tokens are signed with the same access-token secret but carry a
// `role: 'admin'` claim and a fixed `sub: 'admin'` instead of a real user
// id — there's no User document backing this identity (see
// admin.controller.ts), so there's nothing in the User collection for it
// to collide with. A short 8h TTL since this is a low-traffic, high-trust
// account with no refresh-token flow of its own — an expired session just
// means logging back in with the .env credentials.
export function signAdminToken(): string {
  return jwt.sign({ sub: 'admin', role: 'admin' }, env.JWT_ACCESS_SECRET, { expiresIn: '8h' });
}

export function verifyAdminToken(token: string): AdminTokenPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as any;
  if (payload?.role !== 'admin' || payload?.sub !== 'admin') {
    throw new Error('Not an admin token');
  }
  return payload;
}
