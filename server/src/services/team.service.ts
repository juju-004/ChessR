import { getIo } from '../sockets/io.js';

export const teamRoom = (teamId: string) => `team:${teamId}`;

function safeIo() {
  try {
    return getIo();
  } catch {
    return null; // not initialised (scripts/tests), nothing to push to
  }
}

/** Tells everyone with this team's page open to refetch. */
export function emitTeamUpdate(teamId: string): void {
  safeIo()?.to(teamRoom(teamId)).emit('team:update', { teamId });
}

/** Pushes an event to one user's own sockets (see presenceSocket's
 *  `user:${userId}` room, same addressing notifications use). */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  safeIo()?.to(`user:${userId}`).emit(event, payload);
}

/** Drops a removed/departed member's live sockets out of the team room so
 *  they stop receiving its chat immediately. */
export function removeUserFromTeamRoom(teamId: string, userId: string): void {
  const io = safeIo();
  if (!io) return;
  io.in(`user:${userId}`).socketsLeave(teamRoom(teamId));
  io.to(`user:${userId}`).emit('team:removed', { teamId });
}

/** Called when a team is deleted: tells the room, then empties it. */
export function closeTeamRoom(teamId: string): void {
  const io = safeIo();
  if (!io) return;
  io.to(teamRoom(teamId)).emit('team:deleted', { teamId });
  io.in(teamRoom(teamId)).socketsLeave(teamRoom(teamId));
}
