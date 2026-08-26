import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import mongoose from 'mongoose';
import {
  createTournament,
  joinTournament,
  leaveTournament,
  cancelTournament,
  updateTournament,
  setArenaPause,
  retryArenaPairingsForUser,
  type CreateTournamentInput,
} from '../services/tournament.service.js';
import { User } from '../models/User.js';
import { watchTournament, unwatchTournament } from '../services/presence.service.js';
import type { AuthedSocketData } from './socketAuth.js';

const MAX_WAGER_TOKENS = 9_999_999; // 7-digit cap on any single wager/fee input
// Floor on any single wager/stake/fee amount, kept in sync with
// MIN_STAKE_TOKENS in client/src/lib/limits.ts.
const MIN_STAKE_TOKENS = 20;

const MAX_BREAK_SECONDS = 300;

const prizeTierSchema = z.object({
  fromRank: z.number().int().min(1),
  toRank: z.number().int().min(1),
  tokens: z.number().int().min(0).max(MAX_WAGER_TOKENS),
});

const createSchema = z.object({
  name: z.string().trim().min(3).max(60),
  format: z.enum(['normal', 'swiss', 'round_robin', 'arena']),
  variant: z.enum(['standard', 'chess960']).default('standard'),
  baseMinutes: z.number().min(1).max(180).nullable(),
  incrementSeconds: z.number().min(0).max(60).default(0),
  maxPlayers: z.number().int().min(2).max(100),
  berserkAllowed: z.boolean().default(true),
  isPublic: z.boolean().default(false),
  organizerOnly: z.boolean().default(false),
  // Knockout-only, see CreateTournamentInput's doc comment. Immutable
  // after creation, same as organizerOnly, so this isn't in editSchema
  // below.
  thirdPlaceMatch: z.boolean().default(false),
  prizeSchedule: z.array(prizeTierSchema).max(20).optional().default([]),
  regFeeTokens: z.number().int().min(MIN_STAKE_TOKENS, `A registration fee of at least ${MIN_STAKE_TOKENS} R is required for every tournament`).max(MAX_WAGER_TOKENS),
  swissRounds: z.number().int().min(3).max(15).nullable().optional().default(null),
  robinRounds: z.number().int().min(1).max(4).nullable().optional().default(null),
  arenaMinutes: z.number().int().min(5).max(360).nullable().optional().default(null),
  // Pause between rounds, in seconds, defaults to 10 if omitted.
  breakSeconds: z.number().int().min(0).max(MAX_BREAK_SECONDS).default(10),
  // ISO string, when the event should auto-start.
  scheduledStartAt: z.string().or(z.date()),
  password: z.string().trim().max(100).optional(),
});
const idSchema = z.object({ tournamentId: z.string().refine(mongoose.isValidObjectId) });
const joinSchema = idSchema.extend({ password: z.string().optional() });
const pauseSchema = idSchema.extend({ paused: z.boolean() });

// Every field truly optional with no defaults (unlike createSchema), an
// omitted field must mean "leave this as-is", not "reset to the default",
// since this is a partial edit of something that already exists.
const editSchema = idSchema.extend({
  name: z.string().trim().min(3).max(60).optional(),
  format: z.enum(['normal', 'swiss', 'round_robin', 'arena']).optional(),
  variant: z.enum(['standard', 'chess960']).optional(),
  baseMinutes: z.number().min(1).max(180).nullable().optional(),
  incrementSeconds: z.number().min(0).max(60).optional(),
  maxPlayers: z.number().int().min(2).max(100).optional(),
  berserkAllowed: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  prizeSchedule: z.array(prizeTierSchema).max(20).optional(),
  regFeeTokens: z.number().int().min(MIN_STAKE_TOKENS, `A registration fee of at least ${MIN_STAKE_TOKENS} R is required for every tournament`).max(MAX_WAGER_TOKENS).optional(),
  swissRounds: z.number().int().min(3).max(15).nullable().optional(),
  robinRounds: z.number().int().min(1).max(4).nullable().optional(),
  arenaMinutes: z.number().int().min(5).max(360).nullable().optional(),
  breakSeconds: z.number().int().min(0).max(MAX_BREAK_SECONDS).optional(),
  scheduledStartAt: z.string().or(z.date()).optional(),
  // undefined (omitted) = unchanged; null = remove the password; string = set it.
  password: z.string().trim().max(100).nullable().optional(),
});

function emitError(socket: Socket, message: string) {
  socket.emit('tournament:error', { message });
}

function safeHandler<T>(socket: Socket, fn: (payload: T) => Promise<void>): (payload: T) => void {
  return (payload: T) => {
    fn(payload).catch((err) => {
      console.error('tournament socket handler failed:', err);
      emitError(socket, err instanceof Error ? err.message : 'Something went wrong with that tournament');
    });
  };
}

export const tournamentRoom = (id: string) => `tournament:${id}`;

export function registerTournamentHandlers(io: Server, socket: Socket) {
  const { userId } = socket.data as AuthedSocketData;

  socket.on(
    'tournament:create',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = createSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid tournament settings');

      const me = await User.findById(userId).select('username avatarGradient').lean();
      if (!me) return emitError(socket, 'Could not find your account');

      const tournament = await createTournament(userId, me.username, me.avatarGradient ?? null, parsed.data as CreateTournamentInput);
      await socket.join(tournamentRoom(tournament.id));
      socket.emit('tournament:created', { tournamentId: tournament.id, code: tournament.code });
    }),
  );

  socket.on(
    'tournament:edit',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = editSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid tournament settings');
      const { tournamentId, ...changes } = parsed.data;
      const tournament = await updateTournament(tournamentId, userId, changes);
      io.to(tournamentRoom(tournament.id)).emit('tournament:update', { tournamentId: tournament.id, code: tournament.code });
    }),
  );

  socket.on(
    'tournament:join',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = joinSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const me = await User.findById(userId).select('username avatarGradient').lean();
      if (!me) return emitError(socket, 'Could not find your account');

      const tournament = await joinTournament(parsed.data.tournamentId, userId, me.username, me.avatarGradient ?? null, parsed.data.password);
      await socket.join(tournamentRoom(tournament.id));
      io.to(tournamentRoom(tournament.id)).emit('tournament:update', { tournamentId: tournament.id, code: tournament.code });
    }),
  );

  // Lets a spectator or a just-loaded detail page subscribe to live updates
  // for a tournament without actually joining it as a player. Also marks
  // this socket as "watching" it in Redis (see watchTournament), that's
  // the signal arena/swiss pairing actually gates on, separately from the
  // Socket.IO room join above (which is just for live update delivery).
  socket.on(
    'tournament:watch',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = idSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      await socket.join(tournamentRoom(parsed.data.tournamentId));
      await watchTournament(parsed.data.tournamentId, socket.id);
      // Immediate re-check rather than waiting for some unrelated pairing
      // event elsewhere to happen to pick this player up now that they're
      // actually looking at the page, see retryArenaPairingsForUser.
      await retryArenaPairingsForUser(userId);
    }),
  );

  // The other half of tournament:watch, called when the detail page
  // unmounts (tab closed, navigated away, or just switched to a different
  // tournament). Without this, "who's watching this tournament" would
  // silently accumulate everyone who'd ever opened the page this session
  // instead of reflecting who's actually looking at it right now.
  socket.on(
    'tournament:unwatch',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = idSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      await socket.leave(tournamentRoom(parsed.data.tournamentId));
      await unwatchTournament(socket.id);
    }),
  );

  socket.on(
    'tournament:leave',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = idSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const tournament = await leaveTournament(parsed.data.tournamentId, userId);
      // Emit to the room BEFORE this socket leaves it, otherwise the
      // leaving user's own client never receives the update (io.to(room)
      // only reaches sockets still in the room at emit time), so their UI
      // keeps showing them as still in the tournament even though other
      // players' clients correctly refresh.
      io.to(tournamentRoom(tournament.id)).emit('tournament:update', { tournamentId: tournament.id, code: tournament.code });
      await socket.leave(tournamentRoom(parsed.data.tournamentId));
    }),
  );

  socket.on(
    'tournament:cancel',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = idSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const tournament = await cancelTournament(parsed.data.tournamentId, userId);
      io.to(tournamentRoom(tournament.id)).emit('tournament:cancelled', { tournamentId: tournament.id, code: tournament.code });
    }),
  );

  socket.on(
    'tournament:pause',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = pauseSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const tournament = await setArenaPause(parsed.data.tournamentId, userId, parsed.data.paused);
      io.to(tournamentRoom(tournament.id)).emit('tournament:update', { tournamentId: tournament.id, code: tournament.code });
    }),
  );

  // Berserking itself is wired up in gameSocket.ts's 'game:berserk' handler
  // (it's a per-game action, so it lives alongside game:resign etc.), not
  // here in the tournament-room socket.
}
