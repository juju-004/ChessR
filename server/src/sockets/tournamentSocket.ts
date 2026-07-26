import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import mongoose from 'mongoose';
import {
  createTournament,
  joinTournament,
  leaveTournament,
  cancelTournament,
  startTournament,
  withdrawFromTournament,
  type CreateTournamentInput,
} from '../services/tournament.service.js';
import { User } from '../models/User.js';
import type { AuthedSocketData } from './socketAuth.js';

const MAX_WAGER_TOKENS = 100_000;

const createSchema = z.object({
  name: z.string().trim().min(3).max(60),
  format: z.enum(['normal', 'swiss', 'robin', 'round_robin']),
  variant: z.enum(['standard', 'chess960']).default('standard'),
  baseMinutes: z.number().min(1).max(180).nullable(),
  incrementSeconds: z.number().min(0).max(60).default(0),
  maxPlayers: z.number().int().min(2).max(64),
  berserkAllowed: z.boolean().default(true),
  wagerMode: z.enum(['none', 'entry_fee']).default('none'),
  wagerTokens: z.number().int().min(0).max(MAX_WAGER_TOKENS).default(0),
  swissRounds: z.number().int().min(3).max(15).nullable().optional().default(null),
});
const idSchema = z.object({ tournamentId: z.string().refine(mongoose.isValidObjectId) });

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

const tournamentRoom = (id: string) => `tournament:${id}`;

export function registerTournamentHandlers(io: Server, socket: Socket) {
  const { userId } = socket.data as AuthedSocketData;

  socket.on(
    'tournament:create',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = createSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid tournament settings');

      const me = await User.findById(userId).select('username').lean();
      if (!me) return emitError(socket, 'Could not find your account');

      const tournament = await createTournament(userId, me.username, parsed.data as CreateTournamentInput);
      await socket.join(tournamentRoom(tournament.id));
      socket.emit('tournament:created', { tournamentId: tournament.id, code: tournament.code });
    }),
  );

  socket.on(
    'tournament:join',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = idSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const me = await User.findById(userId).select('username').lean();
      if (!me) return emitError(socket, 'Could not find your account');

      const tournament = await joinTournament(parsed.data.tournamentId, userId, me.username);
      await socket.join(tournamentRoom(tournament.id));
      io.to(tournamentRoom(tournament.id)).emit('tournament:update', { tournamentId: tournament.id, code: tournament.code });
    }),
  );

  // Lets a spectator or a just-loaded detail page subscribe to live updates
  // for a tournament without actually joining it as a player.
  socket.on(
    'tournament:watch',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = idSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      await socket.join(tournamentRoom(parsed.data.tournamentId));
    }),
  );

  socket.on(
    'tournament:leave',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = idSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const tournament = await leaveTournament(parsed.data.tournamentId, userId);
      await socket.leave(tournamentRoom(parsed.data.tournamentId));
      io.to(tournamentRoom(tournament.id)).emit('tournament:update', { tournamentId: tournament.id, code: tournament.code });
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
    'tournament:start',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = idSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const tournament = await startTournament(parsed.data.tournamentId, userId);
      io.to(tournamentRoom(tournament.id)).emit('tournament:started', { tournamentId: tournament.id, code: tournament.code });
    }),
  );

  socket.on(
    'tournament:withdraw',
    safeHandler(socket, async (raw: unknown) => {
      const parsed = idSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, 'Invalid payload');
      const tournament = await withdrawFromTournament(parsed.data.tournamentId, userId);
      io.to(tournamentRoom(tournament.id)).emit('tournament:update', { tournamentId: tournament.id, code: tournament.code });
    }),
  );

  // Berserking itself is wired up in gameSocket.ts's 'game:berserk' handler
  // (it's a per-game action, so it lives alongside game:resign etc.), not
  // here in the tournament-room socket.
}
