import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Team } from '../models/Team.js';
import { teamRoom } from '../services/team.service.js';
import type { AuthedSocketData } from './socketAuth.js';

const idSchema = z.object({ teamId: z.string().refine(mongoose.isValidObjectId) });

function emitError(socket: Socket, message: string) {
  socket.emit('team:error', { message });
}

/** Live updates for a team's page (member/request/announcement changes, see
 *  team.service's emitTeamUpdate). Only members can join the room, and
 *  team.service's removeUserFromTeamRoom drops them from it right away if
 *  they're removed. */
export function registerTeamHandlers(_io: Server, socket: Socket) {
  const { userId } = socket.data as AuthedSocketData;

  socket.on('team:watch', (raw: unknown) => {
    const parsed = idSchema.safeParse(raw);
    if (!parsed.success) return emitError(socket, 'Invalid payload');
    const { teamId } = parsed.data;
    Team.exists({ _id: teamId, 'members.user': userId })
      .then(async (isMember) => {
        if (!isMember) return emitError(socket, 'Only team members can follow a team');
        await socket.join(teamRoom(teamId));
      })
      .catch((err) => {
        console.error('team:watch failed:', err);
        emitError(socket, 'Something went wrong');
      });
  });

  socket.on('team:unwatch', (raw: unknown) => {
    const parsed = idSchema.safeParse(raw);
    if (!parsed.success) return;
    void socket.leave(teamRoom(parsed.data.teamId));
  });
}
