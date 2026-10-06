import { Game } from '../models/Game.js';

/** The cage-match / tournament tags on a game. They are set when the game is
 *  created and never change, so they are looked up from Mongo at most once
 *  per game and kept in a small bounded in-process cache. That replaces a
 *  `Game.findById(...).select(...)` that used to run on every chat message,
 *  on each of the first two moves, and twice when a game ended. */
export interface GameSeriesMeta {
  cageMatchId: string | null;
  legIndex?: number;
  tournamentId: string | null;
  roundIndex?: number;
  pairingIndex?: number;
}

interface SeriesFields {
  cageMatchId?: unknown;
  legIndex?: number | null;
  tournamentId?: unknown;
  roundIndex?: number | null;
  pairingIndex?: number | null;
}

const MAX_ENTRIES = 5000;
const cache = new Map<string, GameSeriesMeta>();

function toMeta(doc: SeriesFields): GameSeriesMeta {
  return {
    cageMatchId: doc.cageMatchId ? String(doc.cageMatchId) : null,
    legIndex: doc.legIndex ?? undefined,
    tournamentId: doc.tournamentId ? String(doc.tournamentId) : null,
    roundIndex: doc.roundIndex ?? undefined,
    pairingIndex: doc.pairingIndex ?? undefined,
  };
}

function store(gameId: string, meta: GameSeriesMeta): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(gameId, meta);
}

/** For callers that already loaded the game document (game:join does), so
 *  the flags never need their own query. */
export function primeGameSeriesMeta(gameId: string, doc: SeriesFields): void {
  store(gameId, toMeta(doc));
}

/** Null when the game doesn't exist. */
export async function getGameSeriesMeta(gameId: string): Promise<GameSeriesMeta | null> {
  const hit = cache.get(gameId);
  if (hit) return hit;
  const doc = await Game.findById(gameId)
    .select('cageMatchId legIndex tournamentId roundIndex pairingIndex')
    .lean();
  if (!doc) return null;
  const meta = toMeta(doc);
  store(gameId, meta);
  return meta;
}

export function forgetGameSeriesMeta(gameId: string): void {
  cache.delete(gameId);
}
