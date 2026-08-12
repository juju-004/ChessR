import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError.js';
import { verifyAdminToken } from '../services/token.service.js';

export interface AdminRequest extends Request {
  isAdmin?: true;
}

/** Guards admin-only routes. Deliberately separate from requireAuth/
 *  AuthedRequest — an admin token is never a stand-in for a player session
 *  (it can't join games, fund a wallet, etc), so keeping the two checks
 *  apart means a bug in one can't accidentally grant the other. */
export function requireAdmin(req: AdminRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Missing admin token'));
  }
  try {
    verifyAdminToken(header.slice('Bearer '.length));
    req.isAdmin = true;
    next();
  } catch {
    next(ApiError.unauthorized('Invalid or expired admin session'));
  }
}
