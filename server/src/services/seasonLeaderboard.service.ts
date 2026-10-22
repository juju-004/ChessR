import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Game } from '../models/Game.js';
import { User } from '../models/User.js';
import { SeasonSettlement, type ISeasonWinner, type SeasonBoard } from '../models/SeasonSettlement.js';
import { ApiError } from '../utils/ApiError.js';
import { creditSeasonReward } from './wallet.service.js';
import { createNotification } from './notification.service.js';

// Season leaderboards. A season is SEASON_LENGTH_DAYS long (15), back to back
// from SEASON_EPOCH. Two boards per season:
//   - "games":  most finished games played
//   - "points": most points (win = 1, draw = 0.5, loss = 0)
// Prizes (R tokens) per board: 1st 100, 2nd 50, 3rd 20, 4th & 5th 10.
// Standings are never stored; they're aggregated from finished games on read
// (cached briefly), then snapshotted once when the season ends and paid.
//
// A game counts when it's finished, has two different players and a result,
// and its endedAt falls in the season window (so a game straddling the
// boundary belongs to the season it ended in). Aborted/cancelled games and
// games vs. yourself never count.

export const SEASON_PRIZES = [100, 50, 20, 10, 10] as const;
const DAY_MS = 86_400_000;
const TOP_N = 20;
const CACHE_MS = 30_000;

const epochMs = () => new Date(env.SEASON_EPOCH).getTime();
const lengthMs = () => env.SEASON_LENGTH_DAYS * DAY_MS;

export function seasonWindow(season: number) {
  const startsAt = new Date(epochMs() + (season - 1) * lengthMs());
  const endsAt = new Date(startsAt.getTime() + lengthMs());
  return { startsAt, endsAt };
}

/** Season containing `now`, or 0 if the first season hasn't begun yet. */
export function currentSeasonNumber(now = Date.now()): number {
  if (now < epochMs()) return 0;
  return Math.floor((now - epochMs()) / lengthMs()) + 1;
}

export interface SeasonRow {
  rank: number;
  user: string;
  username: string;
  avatarGradient: string | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  prize: number;
}

interface RawRow {
  _id: mongoose.Types.ObjectId;
  games: number;
  wins: number;
  draws: number;
}

/** Per-player totals for a season window, one pass over finished games. */
async function aggregateSeason(season: number): Promise<RawRow[]> {
  const { startsAt, endsAt } = seasonWindow(season);
  const match = {
    status: 'finished',
    result: { $in: ['white', 'black', 'draw'] },
    black: { $ne: null },
    endedAt: { $gte: startsAt, $lt: endsAt },
    $expr: { $ne: ['$white', '$black'] },
  };
  return Game.aggregate<RawRow>([
    { $match: match },
    {
      $project: {
        sides: [
          { u: '$white', w: { $cond: [{ $eq: ['$result', 'white'] }, 1, 0] }, d: { $cond: [{ $eq: ['$result', 'draw'] }, 1, 0] } },
          { u: '$black', w: { $cond: [{ $eq: ['$result', 'black'] }, 1, 0] }, d: { $cond: [{ $eq: ['$result', 'draw'] }, 1, 0] } },
        ],
      },
    },
    { $unwind: '$sides' },
    {
      $group: {
        _id: '$sides.u',
        games: { $sum: 1 },
        wins: { $sum: '$sides.w' },
        draws: { $sum: '$sides.d' },
      },
    },
  ]).allowDiskUse(true);
}

const pointsOf = (r: { wins: number; draws: number }) => r.wins + r.draws * 0.5;

interface Entry extends RawRow {
  username: string;
  avatarGradient: string | null;
  blocked: boolean;
}

async function loadEntries(season: number): Promise<Entry[]> {
  const raw = await aggregateSeason(season);
  if (!raw.length) return [];
  const users = await User.find({ _id: { $in: raw.map((r) => r._id) } })
    .select('username avatarGradient withdrawalBlocked')
    .lean();
  const byId = new Map(users.map((u: any) => [String(u._id), u]));
  const out: Entry[] = [];
  for (const r of raw) {
    const u: any = byId.get(String(r._id));
    if (!u) continue; // deleted account
    out.push({ ...r, username: u.username, avatarGradient: u.avatarGradient ?? null, blocked: !!u.withdrawalBlocked });
  }
  return out;
}

// Tie-breaks: games board -> more points, then lower id (stable).
//             points board -> fewer games (more efficient), then lower id.
function sortEntries(entries: Entry[], board: SeasonBoard): Entry[] {
  return [...entries].sort((a, b) => {
    if (board === 'games') {
      return b.games - a.games || pointsOf(b) - pointsOf(a) || String(a._id).localeCompare(String(b._id));
    }
    return pointsOf(b) - pointsOf(a) || a.games - b.games || String(a._id).localeCompare(String(b._id));
  });
}

/** Eligible prize winners in order: skips accounts frozen for suspected
 *  cheating (withdrawalBlocked) and, on the points board, players under the
 *  minimum game count. Returns the entries that take prize ranks 1..5. */
function prizeWinners(entries: Entry[], board: SeasonBoard): Entry[] {
  const min = board === 'points' ? env.SEASON_MIN_GAMES_FOR_POINTS_PRIZE : 0;
  return sortEntries(entries, board)
    .filter((e) => !e.blocked && e.games >= min)
    .slice(0, SEASON_PRIZES.length);
}

function toRows(entries: Entry[], board: SeasonBoard): SeasonRow[] {
  const winners = prizeWinners(entries, board);
  const prizeByUser = new Map(winners.map((w, i) => [String(w._id), SEASON_PRIZES[i]]));
  return sortEntries(entries, board).map((e, i) => ({
    rank: i + 1,
    user: String(e._id),
    username: e.username,
    avatarGradient: e.avatarGradient,
    games: e.games,
    wins: e.wins,
    draws: e.draws,
    losses: e.games - e.wins - e.draws,
    prize: prizeByUser.get(String(e._id)) ?? 0,
  }));
}

const cache = new Map<number, { at: number; entries: Entry[] }>();
async function cachedEntries(season: number, ttl = CACHE_MS): Promise<Entry[]> {
  const hit = cache.get(season);
  if (hit && Date.now() - hit.at < ttl) return hit.entries;
  const entries = await loadEntries(season);
  cache.set(season, { at: Date.now(), entries });
  if (cache.size > 8) cache.delete(cache.keys().next().value as number);
  return entries;
}

function boardPayload(entries: Entry[], board: SeasonBoard, userId?: string) {
  const rows = toRows(entries, board);
  const mine = userId ? rows.find((r) => r.user === userId) ?? null : null;
  return { top: rows.slice(0, TOP_N), me: mine, totalPlayers: rows.length };
}

export async function getSeasonLeaderboard(season: number | 'current', userId?: string) {
  const n = season === 'current' ? currentSeasonNumber() : season;
  if (!Number.isInteger(n) || n < 1 || n > currentSeasonNumber()) {
    throw ApiError.notFound(n === 0 ? 'The first season has not started yet' : 'Season not found');
  }
  const { startsAt, endsAt } = seasonWindow(n);
  const isCurrent = n === currentSeasonNumber();
  const entries = await cachedEntries(n, isCurrent ? CACHE_MS : 10 * 60_000);
  return {
    season: n,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    isCurrent,
    lengthDays: env.SEASON_LENGTH_DAYS,
    prizes: [...SEASON_PRIZES],
    minGamesForPointsPrize: env.SEASON_MIN_GAMES_FOR_POINTS_PRIZE,
    boards: {
      games: boardPayload(entries, 'games', userId),
      points: boardPayload(entries, 'points', userId),
    },
  };
}

/** Past seasons' podiums (settled ones), newest first. */
export async function listPastSeasons(limit = 20) {
  const docs = await SeasonSettlement.find({}).sort({ season: -1 }).limit(limit).lean();
  return docs.map((d) => ({
    season: d.season,
    startsAt: d.startsAt.toISOString(),
    endsAt: d.endsAt.toISOString(),
    // The raw points score is never sent to clients: on the points board the
    // value is left out (the order, not the number, is what players see).
    winners: d.winners.map((w) => ({
      ...w,
      user: String(w.user),
      value: w.board === 'points' ? null : w.value,
    })),
  }));
}

// --- Settlement ------------------------------------------------------------------

async function settleSeason(season: number): Promise<void> {
  const { startsAt, endsAt } = seasonWindow(season);
  const entries = await loadEntries(season); // fresh, never cached
  const winners: ISeasonWinner[] = [];
  for (const board of ['games', 'points'] as SeasonBoard[]) {
    prizeWinners(entries, board).forEach((e, i) => {
      winners.push({
        board,
        rank: i + 1,
        user: e._id,
        username: e.username,
        avatarGradient: e.avatarGradient,
        value: board === 'games' ? e.games : pointsOf(e),
        prize: SEASON_PRIZES[i],
      });
    });
  }

  // Pay first (each credit is idempotent by reference), then write the
  // settlement marker. A crash in between just re-runs the credits as no-ops.
  for (const w of winners) {
    const ref = `season-${season}-${w.board}-${w.user}`;
    const credited = await creditSeasonReward(String(w.user), w.prize, ref);
    if (credited) {
      const boardName = w.board === 'games' ? 'Most games played' : 'Most points';
      await createNotification({
        recipientId: String(w.user),
        type: 'season_reward',
        title: `Season ${season}: you won ${w.prize}R`,
        body: `You finished #${w.rank} on the "${boardName}" leaderboard for Season ${season} and earned ${w.prize}R.`,
        link: '/leaderboard',
      }).catch((err) => console.error('season reward notification failed:', err));
    }
  }

  try {
    await SeasonSettlement.create({ season, startsAt, endsAt, winners });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err; // already settled elsewhere
  }
}

/** Settles every ended season that hasn't been settled yet, oldest first.
 *  Safe to call from every instance on a timer (see index.ts). Only seasons
 *  from 1 up to currentSeason-1 are considered; with a fixed epoch that's at
 *  most a handful even after a long outage. */
export async function settleFinishedSeasons(): Promise<{ settled: number }> {
  const last = currentSeasonNumber() - 1;
  if (last < 1) return { settled: 0 };
  const done = new Set((await SeasonSettlement.find({ season: { $lte: last } }).select('season').lean()).map((d) => d.season));
  let settled = 0;
  for (let s = 1; s <= last; s++) {
    if (done.has(s)) continue;
    await settleSeason(s);
    settled++;
  }
  return { settled };
}
