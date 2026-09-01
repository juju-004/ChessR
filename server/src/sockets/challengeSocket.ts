import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import mongoose from 'mongoose';
import { nanoid } from 'nanoid';
import { redis } from '../config/redis.js';
import { User } from '../models/User.js';
import { createDirectGame, assertUnderActiveGameLimit, countActiveGamesForUser, MAX_ACTIVE_GAMES_PER_USER, activeGameLimitMessage } from '../services/game.service.js';
import { assertNotRestricted } from '../services/suspension.service.js';
import { isUserOnline } from '../services/presence.service.js';
import type { AuthedSocketData } from './socketAuth.js';

const CHALLENGE_TTL_SECONDS = 60;
const challengeKey = (id: string) => `challenge:${id}`;
// Tracks "userId already has an unanswered challenge out to this specific
// person", same TTL as the challenge itself. Blocks challenge:send from
// firing again for the same pair while one's still pending, which is what
// actually stops a repeated-challenge spam burst at the source, rather than
// just hiding the resulting notifications on the receiving end.
const pendingPairKey = (fromId: string, toId: string) => `challenge:pending:${fromId}:${toId}`;

const MAX_WAGER_TOKENS = 9_999_999; // 7-digit cap on any single wager/fee input
// Floor on any single wager/stake/fee amount, kept in sync with
// MIN_STAKE_TOKENS in client/src/lib/limits.ts.
const MIN_STAKE_TOKENS = 20;

const sendSchema = z.object({
  toUserId: z.string().refine(mongoose.isValidObjectId),
  baseMinutes: z.number().min(1).max(180).nullable().optional().default(10),
  incrementSeconds: z.number().min(0).max(60).optional().default(0),
  variant: z.enum(['standard', 'chess960']).optional().default('standard'),
  wagerTokens: z.number().int().min(MIN_STAKE_TOKENS, `A wager of at least ${MIN_STAKE_TOKENS} R is required for every game`).max(MAX_WAGER_TOKENS),
});
const respondSchema = z.object({ challengeId: z.string(), accept: z.boolean() });

function emitError(socket: Socket, message: string) {
  socket.emit('challenge:error', { message });
}

// Every handler is wrapped so an unexpected failure (e.g. a transient Redis or
// Mongo hiccup) always reaches the client as `challenge:error` instead of
// disappearing as a silent, unhandled promise rejection.
function safeHandler<T>(
  socket: Socket,
  fn: (payload: T) => Promise<void>,
): (payload: T) => void {
  return (payload: T) => {
    fn(payload).catch((err) => {
      console.error('challenge socket handler failed:', err);
      emitError(socket, 'Something went wrong processing that challenge. Please try again.');
    });
  };
}

export function registerChallengeHandlers(io: Server, socket: Socket) {
  const { userId, username } = socket.data as AuthedSocketData;

  socket.on(
    'challenge:send',
    safeHandler(socket, async (raw) => {
      const parsed = sendSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid challenge payload');
      const { toUserId, baseMinutes, incrementSeconds, variant, wagerTokens } = parsed.data;

      if (toUserId === userId) return emitError(socket, "You can't challenge yourself");

      try {
        await assertNotRestricted(userId);
      } catch (err) {
        return emitError(socket, err instanceof Error ? err.message : "You can't start new games right now");
      }

      const me = await User.findById(userId).select('friends tokenBalance').lean();
      const isFriend = me?.friends.some((f) => f.toString() === toUserId);
      if (!isFriend) return emitError(socket, 'You can only challenge friends');

      const online = await isUserOnline(toUserId);
      if (!online) return emitError(socket, 'That friend is currently offline');

      const target = await User.findById(toUserId).select('acceptChallenges').lean();
      if (target && target.acceptChallenges === false) {
        return emitError(socket, "That player isn't accepting challenges right now.");
      }

      // Soft check up front so a challenger can't send a stake they can't
      // cover, the authoritative debit still happens for both sides at
      // acceptance time, since balances can change in the meantime.
      if (wagerTokens > 0 && (me?.tokenBalance ?? 0) < wagerTokens) {
        return emitError(socket, "You don't have enough R tokens for that wager");
      }

      // Same soft-check pattern for the active-game cap, the authoritative
      // check happens again for both sides at acceptance time.
      const myActiveCount = await countActiveGamesForUser(userId);
      if (myActiveCount >= MAX_ACTIVE_GAMES_PER_USER) {
        return emitError(socket, activeGameLimitMessage("challenging someone else"));
      }

      // Stops a repeated-challenge spam burst at the source: while an
      // unanswered challenge to this same person is still outstanding,
      // reject another one instead of piling up a fresh `challenge:received`
      // notification on their end every time this fires.
      const alreadyPending = await redis.exists(pendingPairKey(userId, toUserId));
      if (alreadyPending) {
        return emitError(socket, "You already have a pending challenge to that player.");
      }

      const challengeId = nanoid();
      await redis.set(
        challengeKey(challengeId),
        JSON.stringify({ fromId: userId, toId: toUserId, baseMinutes, incrementSeconds, variant, wagerTokens }),
        'EX',
        CHALLENGE_TTL_SECONDS,
      );
      await redis.set(pendingPairKey(userId, toUserId), challengeId, 'EX', CHALLENGE_TTL_SECONDS);

      io.to(`user:${toUserId}`).emit('challenge:received', {
        challengeId,
        from: { id: userId, username },
        timeControl: { baseMinutes, incrementSeconds },
        variant,
        wagerTokens,
        expiresInSeconds: CHALLENGE_TTL_SECONDS,
      });

      socket.emit('challenge:sent', { challengeId, toUserId, wagerTokens });
    }),
  );

  socket.on(
    'challenge:respond',
    safeHandler(socket, async (raw) => {
      const parsed = respondSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid response payload');
      const { challengeId, accept } = parsed.data;

      const stored = await redis.get(challengeKey(challengeId));
      if (!stored) return emitError(socket, 'This challenge has expired');

      const { fromId, toId, baseMinutes, incrementSeconds, variant, wagerTokens } = JSON.parse(stored) as {
        fromId: string;
        toId: string;
        baseMinutes: number | null;
        incrementSeconds: number;
        variant: 'standard' | 'chess960';
        wagerTokens: number;
      };
      if (toId !== userId) return emitError(socket, 'This challenge is not addressed to you');

      await redis.del(challengeKey(challengeId));
      await redis.del(pendingPairKey(fromId, toId));

      if (!accept) {
        io.to(`user:${fromId}`).emit('challenge:declined', { challengeId, by: userId });
        return;
      }

      // Authoritative re-check for both sides, either could have picked up
      // a play restriction in the time between the challenge being sent
      // and answered (same reasoning as the active-game-limit re-check
      // right below).
      try {
        await assertNotRestricted(toId);
      } catch (err) {
        return emitError(socket, err instanceof Error ? err.message : "You can't accept new games right now");
      }

      // Authoritative re-check for both sides, either could have hit the
      // cap in the time between the challenge being sent and answered.
      try {
        await assertUnderActiveGameLimit(fromId);
      } catch {
        const message = activeGameLimitMessage('accepting');
        emitError(socket, 'That player already has too many active games to start another right now.');
        io.to(`user:${fromId}`).emit('challenge:error', { message });
        return;
      }
      try {
        await assertUnderActiveGameLimit(toId);
      } catch {
        const message = activeGameLimitMessage('accepting');
        emitError(socket, message);
        io.to(`user:${fromId}`).emit('challenge:error', {
          message: 'That player already has too many active games to accept right now.',
        });
        return;
      }

      const [whiteId, blackId] = Math.random() < 0.5 ? [fromId, toId] : [toId, fromId];
      let game;
      try {
        game = await createDirectGame(
          whiteId,
          blackId,
          { baseMinutes, incrementSeconds },
          challengeId,
          variant,
          wagerTokens,
        );
      } catch (err) {
        // Most likely: one side's R token balance dropped below the wager
        // between sending/accepting. Nobody's tokens are left committed, 
        // createDirectGame already unwound any partial debit, so just tell
        // both sides the game never started.
        const message = err instanceof Error ? err.message : 'Could not start the game';
        emitError(socket, message);
        io.to(`user:${fromId}`).emit('challenge:error', { message });
        return;
      }

      const payload = {
        challengeId,
        gameId: game.id,
        joinCode: game.joinCode,
        white: whiteId,
        black: blackId,
        wagerTokens: game.wagerTokens,
      };
      io.to(`user:${fromId}`).emit('challenge:accepted', payload);
      io.to(`user:${toId}`).emit('challenge:accepted', payload);
    }),
  );

  socket.on(
    'challenge:cancel',
    safeHandler(socket, async (raw) => {
      const schema = z.object({ challengeId: z.string() });
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return;
      const stored = await redis.get(challengeKey(parsed.data.challengeId));
      if (!stored) return;
      const { fromId, toId } = JSON.parse(stored) as { fromId: string; toId: string };
      if (fromId !== userId) return;
      await redis.del(challengeKey(parsed.data.challengeId));
      await redis.del(pendingPairKey(fromId, toId));
      io.to(`user:${toId}`).emit('challenge:cancelled', { challengeId: parsed.data.challengeId });
    }),
  );
}
