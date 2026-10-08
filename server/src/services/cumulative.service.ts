import mongoose from "mongoose";
import {
  CumulativeLeague,
  MAX_CUMULATIVE_TOURNAMENTS,
  MIN_CUMULATIVE_TOURNAMENTS,
  type ICumulativeLeague,
} from "../models/CumulativeLeague.js";
import { Tournament } from "../models/Tournament.js";
import { ApiError } from "../utils/ApiError.js";
import { getApprovedOrganization } from "./organization.service.js";

// Cumulative leagues: a sequence of up to MAX_CUMULATIVE_TOURNAMENTS ordinary
// swiss/arena tournaments whose points add up into one league table. See
// models/CumulativeLeague.ts for the data model. Nothing about the league's
// standings is stored, every read recomputes them from the tournaments.

/** Formats a tournament may have to be part of a cumulative. Knockout has no
 *  points, and round-robin is excluded on purpose (see product decision). */
export const CUMULATIVE_FORMATS = ["swiss", "arena"] as const;

const MAX_STANDING_ROWS = 300;
const LIST_LIMIT = 30;

export interface CumulativeSummary {
  id: string;
  name: string;
  description: string | null;
  organizationName: string;
  tournamentCount: number;
  maxTournaments: number;
  mine: boolean;
  createdAt: string;
}

function summarize(l: any, userId?: string): CumulativeSummary {
  return {
    id: String(l._id),
    name: l.name,
    description: l.description ?? null,
    organizationName: l.organizationName,
    tournamentCount: (l.tournaments ?? []).length,
    maxTournaments: l.maxTournaments ?? MAX_CUMULATIVE_TOURNAMENTS,
    mine: !!userId && String(l.createdBy) === userId,
    createdAt: new Date(l.createdAt).toISOString(),
  };
}

function assertValidId(id: string): void {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound("League not found");
}

// --- Create / list -----------------------------------------------------------

export async function createCumulative(
  userId: string,
  input: { name: string; description?: string | null; maxTournaments: number },
): Promise<CumulativeSummary> {
  const org = await getApprovedOrganization(userId);
  if (!org) {
    throw ApiError.forbidden(
      "Only approved organisations can create leagues. Request organisation status first.",
    );
  }
  const name = input.name.trim();
  if (name.length < 3) throw ApiError.badRequest("Give the league a name (at least 3 characters)");
  const maxTournaments = input.maxTournaments;
  if (
    !Number.isInteger(maxTournaments) ||
    maxTournaments < MIN_CUMULATIVE_TOURNAMENTS ||
    maxTournaments > MAX_CUMULATIVE_TOURNAMENTS
  ) {
    throw ApiError.badRequest(
      `Choose between ${MIN_CUMULATIVE_TOURNAMENTS} and ${MAX_CUMULATIVE_TOURNAMENTS} tournaments for the league`,
    );
  }
  const league = await CumulativeLeague.create({
    maxTournaments,
    name,
    description: input.description?.trim() || null,
    createdBy: userId,
    organization: org._id,
    organizationName: org.name,
  });
  return summarize(league, userId);
}

/** Every cumulative, newest first. They're public: the whole point is for
 *  players to follow the league table, and each tournament inside still has
 *  its own visibility/password. */
export async function listCumulatives(userId?: string): Promise<CumulativeSummary[]> {
  const leagues = await CumulativeLeague.find({})
    .sort({ createdAt: -1 })
    .limit(LIST_LIMIT)
    .select("name description organizationName createdBy tournaments createdAt")
    .lean();
  return leagues.map((l) => summarize(l, userId));
}

/** The caller's own cumulatives, for the "add to a cumulative" picker on the
 *  create-tournament page. Full ones are still returned (flagged by their
 *  tournamentCount) so the picker can show why they can't be chosen. */
export async function listMyCumulatives(userId: string): Promise<CumulativeSummary[]> {
  const leagues = await CumulativeLeague.find({ createdBy: userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .select("name description organizationName createdBy tournaments createdAt")
    .lean();
  return leagues.map((l) => summarize(l, userId));
}

// --- Slot reservation (called from tournament.service.ts) --------------------

/** Atomically claims the next slot in a cumulative for `tournamentId`,
 *  enforcing owner-only and the hard cap in one write so two simultaneous
 *  creations can't both squeeze past 10. Must run BEFORE the tournament doc
 *  is created; release it with releaseCumulativeSlot if creation then fails. */
export async function reserveCumulativeSlot(
  cumulativeId: string,
  userId: string,
  tournamentId: mongoose.Types.ObjectId,
): Promise<{ name: string }> {
  assertValidId(cumulativeId);
  const updated = await CumulativeLeague.findOneAndUpdate(
    {
      _id: cumulativeId,
      createdBy: userId,
      $expr: {
        $lt: [{ $size: "$tournaments" }, { $ifNull: ["$maxTournaments", MAX_CUMULATIVE_TOURNAMENTS] }],
      },
    },
    { $push: { tournaments: tournamentId } },
    { new: true },
  )
    .select("name")
    .lean();
  if (updated) return { name: updated.name };

  const league = await CumulativeLeague.findById(cumulativeId).select("createdBy maxTournaments").lean();
  if (!league) throw ApiError.notFound("That league no longer exists");
  if (String(league.createdBy) !== userId) {
    throw ApiError.forbidden("Only the organisation that created a league can add tournaments to it");
  }
  throw ApiError.conflict(
    `This league already has ${league.maxTournaments ?? MAX_CUMULATIVE_TOURNAMENTS} tournaments, which is its limit`,
  );
}

/** Gives a tournament's slot back (cancelled before it ever started, or its
 *  creation failed), so a cancelled stage doesn't permanently eat one of the
 *  10. Safe to call for a tournament that isn't in a cumulative. */
export async function releaseCumulativeSlot(
  cumulativeId: unknown,
  tournamentId: unknown,
): Promise<void> {
  if (!cumulativeId || !tournamentId) return;
  await CumulativeLeague.updateOne(
    { _id: cumulativeId as any },
    { $pull: { tournaments: tournamentId as any } },
  ).catch((err) => console.error("releaseCumulativeSlot failed:", err));
}

// --- Standings -----------------------------------------------------------------

export interface CumulativeStandingRow {
  rank: number;
  user: string;
  username: string;
  avatarGradient: string | null;
  /** Total points across every started tournament up to this one. */
  points: number;
  /** Points earned in the target tournament alone (0 if it hasn't started). */
  lastPoints: number;
  /** How many of the league's tournaments this player has entered. */
  played: number;
  /** Places gained (+) or lost (-) versus the table before the target
   *  tournament. 0 = same place. null = no comparison (first tournament, or a
   *  player who's new this tournament). */
  movement: number | null;
}

interface Acc {
  user: string;
  username: string;
  avatarGradient: string | null;
  points: number;
  tiebreak: number;
  played: number;
  lastPoints: number;
}

function totalsFor(docs: any[], lastDoc?: any): Acc[] {
  const map = new Map<string, Acc>();
  for (const doc of docs) {
    for (const p of doc.players ?? []) {
      const id = String(p.user);
      const row =
        map.get(id) ??
        { user: id, username: p.username, avatarGradient: p.avatarGradient ?? null, points: 0, tiebreak: 0, played: 0, lastPoints: 0 };
      row.points += p.points ?? 0;
      row.tiebreak += p.tiebreak ?? 0;
      row.played += 1;
      // Latest name/avatar wins, same snapshot tradeoff a tournament makes.
      row.username = p.username;
      row.avatarGradient = p.avatarGradient ?? null;
      if (lastDoc && doc === lastDoc) row.lastPoints = p.points ?? 0;
      map.set(id, row);
    }
  }
  return [...map.values()].sort(
    (a, b) => b.points - a.points || b.tiebreak - a.tiebreak || a.username.localeCompare(b.username),
  );
}

const isStarted = (t: any) => t.status === "active" || t.status === "finished";

/** The league table "through" tournament `targetIdx` (index into `ordered`),
 *  with each player's movement against the table through the previous
 *  started tournament. A target that hasn't started contributes nothing, so
 *  its page shows the carried-in table with no movement arrows yet. */
export function computeCumulativeStandings(ordered: any[], targetIdx: number): CumulativeStandingRow[] {
  if (targetIdx < 0 || ordered.length === 0) return [];
  const target = ordered[targetIdx];
  const prevDocs = ordered.slice(0, targetIdx).filter(isStarted);
  const includeTarget = !!target && isStarted(target);
  const currentDocs = includeTarget ? [...prevDocs, target] : prevDocs;

  const current = totalsFor(currentDocs, includeTarget ? target : undefined);
  const prevRank = new Map<string, number>();
  if (includeTarget) {
    totalsFor(prevDocs).forEach((r, i) => prevRank.set(r.user, i + 1));
  }
  const hasPrev = prevRank.size > 0;

  return current.slice(0, MAX_STANDING_ROWS).map((r, i) => {
    const rank = i + 1;
    const before = prevRank.get(r.user);
    return {
      rank,
      user: r.user,
      username: r.username,
      avatarGradient: r.avatarGradient,
      points: r.points,
      lastPoints: r.lastPoints,
      played: r.played,
      movement: hasPrev && before !== undefined ? before - rank : null,
    };
  });
}

/** The league's non-cancelled tournaments in league order, with just the
 *  fields standings need. A cancelled one has already given its slot back,
 *  this filter only covers the short window before that lands. */
async function loadOrderedForStandings(league: Pick<ICumulativeLeague, "tournaments">): Promise<any[]> {
  const docs = await Tournament.find({ _id: { $in: league.tournaments }, status: { $ne: "cancelled" } })
    .select("code status players.user players.username players.avatarGradient players.points players.tiebreak")
    .lean();
  const byId = new Map(docs.map((d: any) => [String(d._id), d]));
  return league.tournaments.map((id) => byId.get(String(id))).filter(Boolean);
}

function standingsPayload(_league: any, ordered: any[], forCode?: string) {
  let idx = forCode ? ordered.findIndex((t) => t.code === forCode) : -1;
  if (idx === -1) {
    // League page (or an unknown/cancelled code): the latest started stage.
    for (let i = ordered.length - 1; i >= 0; i--) {
      if (isStarted(ordered[i])) {
        idx = i;
        break;
      }
    }
  }
  return {
    throughTournament: idx + 1, // 1-based, 0 = nothing has started yet
    tournamentCount: ordered.length,
    standings: computeCumulativeStandings(ordered, idx),
  };
}

export async function getCumulativeStandings(cumulativeId: string, forTournamentCode?: string) {
  assertValidId(cumulativeId);
  const league = await CumulativeLeague.findById(cumulativeId).select("name organizationName tournaments").lean();
  if (!league) throw ApiError.notFound("League not found");
  const ordered = await loadOrderedForStandings(league);
  return {
    cumulative: { id: String(league._id), name: league.name, organizationName: league.organizationName },
    ...standingsPayload(league, ordered, forTournamentCode),
  };
}

/** Everything the league page needs in one request. */
export async function getCumulative(cumulativeId: string, userId?: string) {
  assertValidId(cumulativeId);
  const league = await CumulativeLeague.findById(cumulativeId).lean();
  if (!league) throw ApiError.notFound("League not found");

  const [ordered, cards] = await Promise.all([
    loadOrderedForStandings(league),
    Tournament.aggregate<any>([
      { $match: { _id: { $in: league.tournaments }, status: { $ne: "cancelled" } } },
      {
        $addFields: {
          playerCount: { $size: { $ifNull: ["$players", []] } },
          hasPassword: { $gt: [{ $strLenCP: { $ifNull: ["$passwordHash", ""] } }, 0] },
        },
      },
      { $project: { rounds: 0, players: 0, passwordHash: 0 } },
    ]),
  ]);
  const cardById = new Map(cards.map((c) => [String(c._id), { ...c, rounds: [], players: [] }]));
  const tournaments = league.tournaments.map((id) => cardById.get(String(id))).filter(Boolean);

  return {
    cumulative: summarize(league, userId),
    tournaments,
    ...standingsPayload(league, ordered),
  };
}

// --- Delete -------------------------------------------------------------------

/** Deletes a league. Only the organisation account that created it may. Its
 *  tournaments are NOT deleted (players may have joined, paid fees or won
 *  prizes in them), they're just detached and carry on as ordinary
 *  standalone tournaments with their own standings. */
export async function deleteCumulative(cumulativeId: string, userId: string): Promise<void> {
  assertValidId(cumulativeId);
  const league = await CumulativeLeague.findById(cumulativeId).select("createdBy").lean();
  if (!league) throw ApiError.notFound("League not found");
  if (String(league.createdBy) !== userId) {
    throw ApiError.forbidden("Only the organisation that created a league can delete it");
  }
  await Tournament.updateMany(
    { cumulative: cumulativeId },
    { $set: { cumulative: null, cumulativeName: null } },
  );
  await CumulativeLeague.deleteOne({ _id: cumulativeId, createdBy: userId });
}
