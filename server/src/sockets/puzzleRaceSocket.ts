import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type { AuthedSocketData } from './socketAuth.js';
import {
  PUZZLE_RACES_LOBBY_ROOM,
  raceRoom,
  submitMove,
  watchRace,
} from '../services/puzzleRace.service.js';

const codeSchema = z.object({ code: z.string().min(4).max(10) });
const moveSchema = z.object({
  code: z.string().min(4).max(10),
  from: z.string().regex(/^[a-h][1-8]$/),
  to: z.string().regex(/^[a-h][1-8]$/),
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
  index: z.number().int().min(0).max(50),
  moveIdx: z.number().int().min(1).max(200),
});

type Ack = (res: unknown) => void;
const ackOf = (maybe: unknown): Ack => (typeof maybe === 'function' ? (maybe as Ack) : () => {});

/**
 * Puzzle race realtime:
 *  - puzzleRaces:watch/unwatch   the lobby list subscribes to "list changed"
 *  - puzzleRace:watch            join a race's room; ack returns the public
 *                                state plus THIS player's current puzzle
 *  - puzzleRace:unwatch
 *  - puzzleRace:move             submit a move; the server decides if it is
 *                                right (answers never leave the server)
 * Server -> client: puzzleRaces:changed, puzzleRace:state.
 */
export function registerPuzzleRaceHandlers(_io: Server, socket: Socket) {
  const userId = (socket.data as AuthedSocketData).userId;

  socket.on('puzzleRaces:watch', () => {
    void socket.join(PUZZLE_RACES_LOBBY_ROOM);
  });
  socket.on('puzzleRaces:unwatch', () => {
    void socket.leave(PUZZLE_RACES_LOBBY_ROOM);
  });

  socket.on('puzzleRace:watch', async (payload: unknown, maybeAck: unknown) => {
    const ack = ackOf(maybeAck);
    const parsed = codeSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: 'Invalid request' });
    try {
      const { raceId, state, puzzle, lockMs } = await watchRace(parsed.data.code, userId);
      await socket.join(raceRoom(raceId));
      ack({ ok: true, state, puzzle, lockMs });
    } catch (err) {
      ack({ ok: false, error: err instanceof Error ? err.message : 'Could not open race' });
    }
  });

  socket.on('puzzleRace:unwatch', async (payload: unknown) => {
    const parsed = codeSchema.safeParse(payload);
    if (!parsed.success) return;
    try {
      const { raceId } = await watchRace(parsed.data.code, userId);
      void socket.leave(raceRoom(raceId));
    } catch {
      // race gone, nothing to leave
    }
  });

  socket.on('puzzleRace:move', async (payload: unknown, maybeAck: unknown) => {
    const ack = ackOf(maybeAck);
    const parsed = moveSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, status: 'illegal' });
    try {
      const { code, ...move } = parsed.data;
      ack(await submitMove(userId, code, move));
    } catch (err) {
      console.error('puzzleRace:move failed:', err);
      ack({ ok: false, status: 'illegal' });
    }
  });
}
