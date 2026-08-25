import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken } from '../services/token.service.js';

export interface AuthedRequest extends Request {
  user?: { id: string; username: string };
}

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Missing access token'));
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, username: payload.username };
    next();
  } catch {
    next(ApiError.unauthorized('Invalid or expired access token'));
  }
}

// Attaches req.user if a valid token is present, but never rejects the request.
// Useful for endpoints that behave differently for logged-in users (e.g. profile views).
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(header.slice('Bearer '.length));
      req.user = { id: payload.sub, username: payload.username };
    } catch {
      // ignore invalid token, treat as anonymous
    }
  }
  next();
}
