import type { Socket } from 'socket.io';
import { verifyAccessToken } from '../services/token.service.js';

export interface AuthedSocketData {
  userId: string;
  username: string;
}

export function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void,
) {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    return next(new Error('AUTH_REQUIRED'));
  }

  try {
    const payload = verifyAccessToken(token);
    (socket.data as AuthedSocketData).userId = payload.sub;
    (socket.data as AuthedSocketData).username = payload.username;
    next();
  } catch {
    next(new Error('AUTH_INVALID'));
  }
}
