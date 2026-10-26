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
import { trackDaily } from '../services/dailyChallenge.service.js';

// A challenge to someone who is online lives for a minute, like it always has.
// One to someone who is OFFLINE waits for them for a day, and is shown to them
// the moment they come back online (see challenge:sync below).
const CHALLENGE_TTL_SECONDS = 60;
const OFFLINE_CHALLENGE_TTL_SECONDS = 24 * 60 * 60;
// Most challenges replayed to someone when they come online.
const MAX_REPLAYED_CHALLENGES = 20;
const challengeKey = (id: string) => `challenge:${id}`;
// Ids of the challenges still waiting for a given player to answer.
const inboxKey = (toId: string) => `challenge:inbox:${toId}`;
// Tracks "userId already has an unanswered challenge out to this specific
// person", same TTL as the challenge itself. Blocks challenge:send from
// firing again for the same pair while one's still pending, which is what
// actually stops a repeated-challenge spam burst at the source, rather than
// just hiding the resulting notifications on the receiving end.
const pendingPairKey = (fromId: string, toId: string) => `challenge:pending:${fromId}:${toId}`;

const MAX_WAGER_TOKENS = 9_999_999; // 7-digit cap on any single wager/fee input
// Floor on any single wager/stake/fee amount when a game IS wagered, kept
// in sync with MIN_STAKE_TOKENS in client/src/lib/limits.ts. Wagers are
// opt-in now, not required — 0 means a free game, see the `wagerTokens > 0`
// branching this flows into in game.service.ts's createDirectGame.
const MIN_STAKE_TOKENS = 10;

const clockSchema = z.object({
  baseMinutes: z.number().min(0.5).max(180),
  incrementSeconds: z.number().min(0).max(60),
});

type StoredChallenge = {
  fromId: string;
  fromUsername: string;
  toId: string;
  baseMinutes: number | null;
  incrementSeconds: number;
  /** Odds: the CHALLENGED player's clock, when it differs from the
   *  challenger's (baseMinutes/incrementSeconds). Null = same clock. */
  odds: { baseMinutes: number; incrementSeconds: number } | null;
  variant: 'standard' | 'chess960' | 'crazyhouse';
  wagerTokens: number;
};

function receivedPayload(challengeId: string, c: StoredChallenge, expiresInSeconds: number) {
  return {
    challengeId,
    from: { id: c.fromId, username: c.fromUsername },
    timeControl: { baseMinutes: c.baseMinutes, incrementSeconds: c.incrementSeconds },
    odds: c.odds,
    variant: c.variant,
    wagerTokens: c.wagerTokens,
    expiresInSeconds,
  };
}

const sendSchema = z.object({
  toUserId: z.string().refine(mongoose.isValidObjectId),
  // 0.5 = Hyper Bullet (30s), same floor as game.controller.ts's createSchema.
  baseMinutes: z.number().min(0.5).max(180).nullable().optional().default(10),
  incrementSeconds: z.number().min(0).max(60).optional().default(0),
  // Odds, challenges only: the challenged player's clock, when it should
  // differ from the challenger's. Both clocks must be timed.
  odds: clockSchema.nullable().optional(),
  variant: z.enum(['standard', 'chess960', 'crazyhouse']).optional().default('standard'),
  wagerTokens: z
    .number()
    .int()
    .min(0)
    .max(MAX_WAGER_TOKENS)
    .refine(
      (v) => v === 0 || v >= MIN_STAKE_TOKENS,
      `A wager must either be 0 (free game) or at least ${MIN_STAKE_TOKENS} R`,
    ),
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
      const odds = parsed.data.odds ?? null;
      if (odds && baseMinutes === null) {
        return emitError(socket, 'Odds need a timed clock for both players');
      }

      if (toUserId === userId) return emitError(socket, "You can't challenge yourself");

      try {
        await assertNotRestricted(userId);
      } catch (err) {
        return emitError(socket, err instanceof Error ? err.message : "You can't start new games right now");
      }

      // Any player can challenge any other player, friend or not.
      const me = await User.findById(userId).select('tokenBalance').lean();

      // An offline player can be challenged too: it waits for them and they
      // see it as soon as they come back online.
      const online = await isUserOnline(toUserId);

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
      const pendingId = await redis.get(pendingPairKey(userId, toUserId));
      if (pendingId) {
        if (online) {
          return emitError(socket, "You already have a pending challenge to that player.");
        }
        // They're offline, so they haven't seen the earlier one and a second
        // can't spam them: the new challenge simply replaces it (that is how
        // you change the settings of a challenge nobody has answered yet).
        await redis.del(challengeKey(pendingId));
        await redis.srem(inboxKey(toUserId), pendingId);
      }

      const ttl = online ? CHALLENGE_TTL_SECONDS : OFFLINE_CHALLENGE_TTL_SECONDS;
      const challengeId = nanoid();
      const challenge: StoredChallenge = {
        fromId: userId,
        fromUsername: username,
        toId: toUserId,
        baseMinutes,
        incrementSeconds,
        odds,
        variant,
        wagerTokens,
      };
      await redis.set(challengeKey(challengeId), JSON.stringify(challenge), 'EX', ttl);
      await redis.set(pendingPairKey(userId, toUserId), challengeId, 'EX', ttl);
      await redis.sadd(inboxKey(toUserId), challengeId);
      await redis.expire(inboxKey(toUserId), OFFLINE_CHALLENGE_TTL_SECONDS);

      // No-op when they're offline: challenge:sync replays it on their return.
      io.to(`user:${toUserId}`).emit('challenge:received', receivedPayload(challengeId, challenge, ttl));

      trackDaily(userId, { type: 'challenge_sent', key: `challenge:${challengeId}` });
      socket.emit('challenge:sent', { challengeId, toUserId, wagerTokens, offline: !online });
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

      const { fromId, fromUsername, toId, baseMinutes, incrementSeconds, variant, wagerTokens, odds } =
        JSON.parse(stored) as StoredChallenge;
      if (toId !== userId) return emitError(socket, 'This challenge is not addressed to you');

      // A challenge can be accepted after its sender has gone offline (they
      // sent it while you were away, then left). A game can't start with
      // nobody there, so keep the challenge waiting and say why.
      if (accept && !(await isUserOnline(fromId))) {
        return emitError(
          socket,
          `${fromUsername ?? 'That player'} is offline right now. Try accepting again once they're back online.`,
        );
      }

      await redis.del(challengeKey(challengeId));
      await redis.del(pendingPairKey(fromId, toId));
      await redis.srem(inboxKey(toId), challengeId);
      // Tells every place this player has the challenge showing (the toast,
      // the bell, other tabs) that it has been answered.
      io.to(`user:${toId}`).emit('challenge:resolved', { challengeId });

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
      // Odds: the challenger plays their own clock and the challenged player
      // theirs, whichever colours the draw gives them.
      const fromClock = { baseMinutes, incrementSeconds };
      const toClock = odds ?? null;
      const oddsClocks = toClock
        ? {
            white: whiteId === fromId ? fromClock : toClock,
            black: blackId === fromId ? fromClock : toClock,
          }
        : undefined;
      let game;
      try {
        game = await createDirectGame(
          whiteId,
          blackId,
          { baseMinutes, incrementSeconds },
          challengeId,
          variant,
          wagerTokens,
          undefined,
          undefined,
          oddsClocks,
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
      await redis.srem(inboxKey(toId), parsed.data.challengeId);
      io.to(`user:${toId}`).emit('challenge:cancelled', { challengeId: parsed.data.challengeId });
    }),
  );

  // The client asks for this once its listeners are up (and after every
  // reconnect). Anything sent to this player while they were offline, and
  // still within its lifetime, is delivered now, as if it had just arrived.
  socket.on(
    'challenge:sync',
    safeHandler(socket, async () => {
      const ids = (await redis.smembers(inboxKey(userId))).slice(0, MAX_REPLAYED_CHALLENGES);
      for (const id of ids) {
        const [stored, ttl] = await Promise.all([redis.get(challengeKey(id)), redis.ttl(challengeKey(id))]);
        if (!stored || ttl <= 0) {
          // Expired, answered or cancelled: drop the stale inbox entry.
          await redis.srem(inboxKey(userId), id);
          continue;
        }
        const challenge = JSON.parse(stored) as StoredChallenge;
        // `queued`: it was waiting for this player (sent while they were offline
        // or disconnected), so the client keeps it in the bell as well as
        // toasting it, since a toast alone would be gone long before a day.
        socket.emit('challenge:received', { ...receivedPayload(id, challenge, ttl), queued: true });
      }
    }),
  );
}
