import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import mongoose from 'mongoose';
import { nanoid } from 'nanoid';
import { redis } from '../config/redis.js';
import { User } from '../models/User.js';
import { isUserOnline } from '../services/presence.service.js';
import {
  startCageMatch,
  forfeitCageMatch,
  pauseCageLeg,
  resumeCageLeg,
  getCageMatchByCode,
  type CageLegInput,
} from '../services/cageMatch.service.js';
import { assertUnderActiveGameLimit, countActiveGamesForUser, MAX_ACTIVE_GAMES_PER_USER } from '../services/game.service.js';
import type { AuthedSocketData } from './socketAuth.js';

const CAGE_INVITE_TTL_SECONDS = 90;
const inviteKey = (id: string) => `cageInvite:${id}`;
// Same anti-spam pattern as challengeSocket.ts's pendingPairKey — blocks a
// second cage:send to the same person while one's still unanswered.
const pendingInvitePairKey = (fromId: string, toId: string) => `cageInvite:pending:${fromId}:${toId}`;

// Pause/resume requests are short-lived, Redis-backed, and keyed by match —
// same pattern as a normal challenge invite, just scoped to a specific match
// rather than a specific pair of strangers.
const PAUSE_REQUEST_TTL_SECONDS = 60;
const pauseRequestKey = (matchId: string) => `cagePauseReq:${matchId}`;
const resumeRequestKey = (matchId: string) => `cageResumeReq:${matchId}`;

const MAX_WAGER_TOKENS = 100_000;

const legSchema = z.object({
  variant: z.enum(['standard', 'chess960']).default('standard'),
  baseMinutes: z.number().min(1).max(180).nullable(),
  incrementSeconds: z.number().min(0).max(60).default(0),
});

const sendSchema = z.object({
  toUserId: z.string().refine(mongoose.isValidObjectId),
  legs: z.array(legSchema).min(2).max(30),
  winnerMode: z.enum(['total_score', 'most_categories', 'first_to_n']).default('total_score'),
  targetWins: z.number().int().min(1).max(30).nullable().optional().default(null),
  wagerMode: z.enum(['none', 'winner_takes_all', 'per_leg', 'split_even']).default('none'),
  wagerTokens: z.number().int().min(0).max(MAX_WAGER_TOKENS).default(0),
});
const respondSchema = z.object({ inviteId: z.string(), accept: z.boolean() });
const cancelSchema = z.object({ inviteId: z.string() });
const matchIdSchema = z.object({ matchId: z.string().refine(mongoose.isValidObjectId) });
const matchRespondSchema = z.object({
  matchId: z.string().refine(mongoose.isValidObjectId),
  accept: z.boolean(),
});

function emitError(socket: Socket, message: string) {
  socket.emit('cage:error', { message });
}

function safeHandler<T>(socket: Socket, fn: (payload: T) => Promise<void>): (payload: T) => void {
  return (payload: T) => {
    fn(payload).catch((err) => {
      console.error('cage match socket handler failed:', err);
      emitError(socket, err instanceof Error ? err.message : 'Something went wrong with that cage match');
    });
  };
}

// Rough per-player commitment for the up-front "can you afford this" check —
// mirrors the soft balance check in challengeSocket.ts. The authoritative
// debit(s) still happen at the moment tokens actually need to move.
function estimatedMaxCommitment(wagerMode: string, wagerTokens: number, legCount: number): number {
  if (wagerMode === 'winner_takes_all' || wagerMode === 'split_even') return wagerTokens;
  if (wagerMode === 'per_leg') return wagerTokens * legCount;
  return 0;
}

async function assertParticipant(matchId: string, userId: string) {
  const match = await getCageMatchByCode(matchId);
  const isP1 = match.player1._id.toString() === userId;
  const isP2 = match.player2._id.toString() === userId;
  if (!isP1 && !isP2) throw new Error("You're not part of this match");
  const opponentId = isP1 ? match.player2._id.toString() : match.player1._id.toString();
  return { match, opponentId };
}

export function registerCageMatchHandlers(io: Server, socket: Socket) {
  const { userId, username } = socket.data as AuthedSocketData;

  socket.on(
    'cage:send',
    safeHandler(socket, async (raw) => {
      const parsed = sendSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid cage match payload');
      const { toUserId, legs, winnerMode, targetWins, wagerMode, wagerTokens } = parsed.data;

      if (toUserId === userId) return emitError(socket, "You can't start a cage match with yourself");
      if (winnerMode === 'first_to_n' && (!targetWins || targetWins < 1)) {
        return emitError(socket, 'Choose a target win count for a first-to-N match');
      }
      if (wagerMode !== 'none' && wagerTokens <= 0) {
        return emitError(socket, 'Enter a valid wager amount');
      }

      const me = await User.findById(userId).select('friends tokenBalance').lean();
      const isFriend = me?.friends.some((f) => f.toString() === toUserId);
      if (!isFriend) return emitError(socket, 'You can only start a cage match with a friend');

      const online = await isUserOnline(toUserId);
      if (!online) return emitError(socket, 'That friend is currently offline');

      const commitment = estimatedMaxCommitment(wagerMode, wagerTokens, legs.length);
      if (commitment > 0 && (me?.tokenBalance ?? 0) < commitment) {
        return emitError(socket, "You don't have enough R tokens for that wager");
      }

      const myActiveCount = await countActiveGamesForUser(userId);
      if (myActiveCount >= MAX_ACTIVE_GAMES_PER_USER) {
        return emitError(
          socket,
          `You can only have ${MAX_ACTIVE_GAMES_PER_USER} active games at once. Finish or cancel one before starting a cage match.`,
        );
      }

      const alreadyPending = await redis.exists(pendingInvitePairKey(userId, toUserId));
      if (alreadyPending) {
        return emitError(socket, 'You already have a pending cage match invite to that player.');
      }

      const inviteId = nanoid();
      await redis.set(
        inviteKey(inviteId),
        JSON.stringify({ fromId: userId, toId: toUserId, legs, winnerMode, targetWins, wagerMode, wagerTokens }),
        'EX',
        CAGE_INVITE_TTL_SECONDS,
      );
      await redis.set(pendingInvitePairKey(userId, toUserId), inviteId, 'EX', CAGE_INVITE_TTL_SECONDS);

      io.to(`user:${toUserId}`).emit('cage:received', {
        inviteId,
        from: { id: userId, username },
        legs,
        winnerMode,
        targetWins,
        wagerMode,
        wagerTokens,
        expiresInSeconds: CAGE_INVITE_TTL_SECONDS,
      });

      socket.emit('cage:sent', { inviteId, toUserId });
    }),
  );

  socket.on(
    'cage:respond',
    safeHandler(socket, async (raw) => {
      const parsed = respondSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid response payload');
      const { inviteId, accept } = parsed.data;

      const stored = await redis.get(inviteKey(inviteId));
      if (!stored) return emitError(socket, 'This cage match invite has expired');

      const { fromId, toId, legs, winnerMode, targetWins, wagerMode, wagerTokens } = JSON.parse(stored) as {
        fromId: string;
        toId: string;
        legs: CageLegInput[];
        winnerMode: 'total_score' | 'most_categories' | 'first_to_n';
        targetWins: number | null;
        wagerMode: 'none' | 'winner_takes_all' | 'per_leg' | 'split_even';
        wagerTokens: number;
      };
      if (toId !== userId) return emitError(socket, 'This invite is not addressed to you');

      await redis.del(inviteKey(inviteId));
      await redis.del(pendingInvitePairKey(fromId, toId));

      if (!accept) {
        io.to(`user:${fromId}`).emit('cage:declined', { inviteId, by: userId });
        return;
      }

      try {
        await assertUnderActiveGameLimit(fromId);
      } catch {
        const message = `You can only have ${MAX_ACTIVE_GAMES_PER_USER} active games at once. Finish or cancel one before accepting.`;
        emitError(socket, 'That player already has too many active games to start another right now.');
        io.to(`user:${fromId}`).emit('cage:error', { message });
        return;
      }
      try {
        await assertUnderActiveGameLimit(toId);
      } catch {
        const message = `You can only have ${MAX_ACTIVE_GAMES_PER_USER} active games at once. Finish or cancel one before accepting.`;
        emitError(socket, message);
        io.to(`user:${fromId}`).emit('cage:error', {
          message: 'That player already has too many active games to accept right now.',
        });
        return;
      }

      let result;
      try {
        result = await startCageMatch(fromId, toId, legs, winnerMode, targetWins, wagerMode, wagerTokens);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not start the cage match';
        emitError(socket, message);
        io.to(`user:${fromId}`).emit('cage:error', { message });
        return;
      }

      const payload = {
        inviteId,
        matchId: result.match.id,
        matchCode: result.match.matchCode,
        firstLeg: { joinCode: result.firstLeg.joinCode, index: result.firstLeg.index },
      };
      io.to(`user:${fromId}`).emit('cage:accepted', payload);
      io.to(`user:${toId}`).emit('cage:accepted', payload);
    }),
  );

  socket.on(
    'cage:cancel',
    safeHandler(socket, async (raw) => {
      const parsed = cancelSchema.safeParse(raw);
      if (!parsed.success) return;
      const stored = await redis.get(inviteKey(parsed.data.inviteId));
      if (!stored) return;
      const { fromId, toId } = JSON.parse(stored) as { fromId: string; toId: string };
      if (fromId !== userId) return;
      await redis.del(inviteKey(parsed.data.inviteId));
      await redis.del(pendingInvitePairKey(fromId, toId));
      io.to(`user:${toId}`).emit('cage:cancelled', { inviteId: parsed.data.inviteId });
    }),
  );

  socket.on(
    'cage:forfeit',
    safeHandler(socket, async (raw) => {
      const parsed = matchIdSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');

      const match = await forfeitCageMatch(parsed.data.matchId, userId);
      const payload = {
        matchId: match.id,
        matchCode: match.matchCode,
        matchWinner: match.matchWinner,
        matchEndReason: match.matchEndReason,
        forfeitedBy: userId,
      };
      io.to(`user:${match.player1.toString()}`).emit('cage:match_over', payload);
      io.to(`user:${match.player2.toString()}`).emit('cage:match_over', payload);
    }),
  );

  // --- Pause / resume, only ever meaningful before both sides have moved ---

  socket.on(
    'cage:pause_request',
    safeHandler(socket, async (raw) => {
      const parsed = matchIdSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const { matchId } = parsed.data;

      const { match, opponentId } = await assertParticipant(matchId, userId);
      if (match.status !== 'active') return emitError(socket, 'This match is already over');
      const leg = match.legs[match.currentLegIndex];
      if (!leg || leg.status !== 'active') {
        return emitError(socket, "There's no leg in progress to pause");
      }

      await redis.set(pauseRequestKey(matchId), userId, 'EX', PAUSE_REQUEST_TTL_SECONDS);
      io.to(`user:${opponentId}`).emit('cage:pause_requested', {
        matchId,
        matchCode: match.matchCode,
        by: userId,
        expiresInSeconds: PAUSE_REQUEST_TTL_SECONDS,
      });
      socket.emit('cage:pause_request_sent', { matchId });
    }),
  );

  socket.on(
    'cage:pause_respond',
    safeHandler(socket, async (raw) => {
      const parsed = matchRespondSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const { matchId, accept } = parsed.data;

      await assertParticipant(matchId, userId);
      const requesterId = await redis.get(pauseRequestKey(matchId));
      if (!requesterId) return emitError(socket, 'That pause request has expired');
      if (requesterId === userId) return emitError(socket, "You can't respond to your own request");
      await redis.del(pauseRequestKey(matchId));

      if (!accept) {
        io.to(`user:${requesterId}`).emit('cage:pause_declined', { matchId });
        return;
      }

      const { match } = await pauseCageLeg(matchId);
      const payload = { matchId: match.id, matchCode: match.matchCode };
      io.to(`user:${match.player1.toString()}`).emit('cage:paused', payload);
      io.to(`user:${match.player2.toString()}`).emit('cage:paused', payload);
    }),
  );

  socket.on(
    'cage:resume_request',
    safeHandler(socket, async (raw) => {
      const parsed = matchIdSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const { matchId } = parsed.data;

      const { match, opponentId } = await assertParticipant(matchId, userId);
      if (match.status !== 'active') return emitError(socket, 'This match is already over');
      const leg = match.legs[match.currentLegIndex];
      if (!leg || leg.status !== 'paused') {
        return emitError(socket, "There's no paused leg to resume");
      }

      await redis.set(resumeRequestKey(matchId), userId, 'EX', PAUSE_REQUEST_TTL_SECONDS);
      io.to(`user:${opponentId}`).emit('cage:resume_requested', {
        matchId,
        matchCode: match.matchCode,
        by: userId,
        expiresInSeconds: PAUSE_REQUEST_TTL_SECONDS,
      });
      socket.emit('cage:resume_request_sent', { matchId });
    }),
  );

  socket.on(
    'cage:resume_respond',
    safeHandler(socket, async (raw) => {
      const parsed = matchRespondSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const { matchId, accept } = parsed.data;

      await assertParticipant(matchId, userId);
      const requesterId = await redis.get(resumeRequestKey(matchId));
      if (!requesterId) return emitError(socket, 'That resume request has expired');
      if (requesterId === userId) return emitError(socket, "You can't respond to your own request");
      await redis.del(resumeRequestKey(matchId));

      if (!accept) {
        io.to(`user:${requesterId}`).emit('cage:resume_declined', { matchId });
        return;
      }

      const { match } = await resumeCageLeg(matchId);
      const payload = { matchId: match.id, matchCode: match.matchCode };
      io.to(`user:${match.player1.toString()}`).emit('cage:resumed', payload);
      io.to(`user:${match.player2.toString()}`).emit('cage:resumed', payload);
    }),
  );
}
