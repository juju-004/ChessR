import crypto from 'crypto';
import { z } from 'zod';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Tournament } from '../models/Tournament.js';
import {
  Team,
  MAX_OWNED_TEAMS,
  MAX_TEAM_MEMBERS,
  MAX_PINNED_ANNOUNCEMENTS,
  ANNOUNCEMENTS_SHOWN,
  type ITeam,
} from '../models/Team.js';
import { TeamAnnouncement } from '../models/TeamAnnouncement.js';
import { TeamJoinRequest } from '../models/TeamJoinRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { listTeamTournaments } from '../services/tournament.service.js';
import {
  emitTeamUpdate,
  emitToUser,
  removeUserFromTeamRoom,
  closeTeamRoom,
} from '../services/team.service.js';
import { createNotificationsForMany } from '../services/notification.service.js';
import type { AuthedRequest } from '../middleware/auth.js';

const objectId = z.string().refine(mongoose.isValidObjectId, 'Invalid id');

const nameSchema = z
  .string()
  .trim()
  .min(3, 'Team name must be at least 3 characters')
  .max(24, 'Team name must be at most 24 characters')
  // Letters, numbers, spaces, - and _, plus emoji (the team name field has an
  // emoji picker). \u200d/\ufe0f/\u20e3 are the joiners and variation
  // selectors that compound emoji are built from.
  .regex(/^[A-Za-z0-9 _\-\p{Extended_Pictographic}\u200d\ufe0f\u20e3]+$/u, 'Use letters, numbers, spaces, emoji, - and _ only');
const descriptionSchema = z.string().trim().max(160);
const joinModeSchema = z.enum(['open', 'request']);
// Empty string means "no code".
const entryCodeSchema = z
  .string()
  .trim()
  .min(4, 'Entry code must be at least 4 characters')
  .max(16, 'Entry code must be at most 16 characters')
  .regex(/^[A-Za-z0-9_-]+$/, 'Entry code: letters, numbers, - and _ only');
const optionalCode = z.preprocess((v) => (v === '' ? undefined : v), entryCodeSchema.optional());
const nullableCode = z.preprocess((v) => (v === '' ? null : v), entryCodeSchema.nullable().optional());

const createSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.default(''),
  joinMode: joinModeSchema.default('open'),
  entryCode: optionalCode,
});
const updateSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    joinMode: joinModeSchema.optional(),
    entryCode: nullableCode,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');
const searchSchema = z.object({ q: z.string().trim().max(24).default('') });
const joinSchema = z.object({ code: z.string().trim().max(16).optional() });
const respondSchema = z.object({ accept: z.boolean() });
const transferSchema = z.object({ userId: objectId });
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(30),
  // Username prefix filter (used by the "add a leader" picker).
  q: z.string().trim().max(24).default(''),
  // "1" = only the owner and leaders.
  leaders: z.enum(['1']).optional(),
});
const leaderSchema = z.object({ userId: objectId });
const announcementSchema = z.object({
  title: z.string().trim().max(60).default(''),
  body: z.string().trim().min(1, 'Write something first').max(600, 'Announcements are at most 600 characters'),
  pinned: z.boolean().default(false),
});
const announcementPatchSchema = z.object({ pinned: z.boolean() });
const KEEP_UNPINNED_ANNOUNCEMENTS = 50;
const tournamentsQuerySchema = z.object({
  scope: z.enum(['upcoming', 'finished']).default('upcoming'),
  page: z.coerce.number().int().min(1).default(1),
});

const OWNER_LIMIT_MESSAGE = `You can only own ${MAX_OWNED_TEAMS} teams at a time. Delete or hand over one first.`;
const DECLINE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a.trim().toLowerCase());
  const y = Buffer.from(b.trim().toLowerCase());
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Atomically claims one of a user's "teams I own" slots. The mirror array on
 *  the user is first topped up from the teams themselves (additive only, so
 *  it picks up teams made before this field existed without ever clobbering a
 *  concurrent claim), then the size check and the push happen in one
 *  conditional update, so two simultaneous creates/transfers can't push
 *  someone past the cap. */
async function claimOwnerSlot(userId: string, teamId: mongoose.Types.ObjectId): Promise<boolean> {
  const owned = await Team.find({ owner: userId, _id: { $ne: teamId } }).distinct('_id');
  if (owned.length) await User.updateOne({ _id: userId }, { $addToSet: { ownedTeams: { $each: owned } } });
  const res = await User.updateOne(
    {
      _id: userId,
      $expr: { $lt: [{ $size: { $ifNull: ['$ownedTeams', []] } }, MAX_OWNED_TEAMS] },
    },
    { $addToSet: { ownedTeams: teamId } },
  );
  return res.modifiedCount === 1;
}

function releaseOwnerSlot(userId: string | mongoose.Types.ObjectId, teamId: mongoose.Types.ObjectId) {
  return User.updateOne({ _id: userId }, { $pull: { ownedTeams: teamId } });
}

/** Atomic add: only if not already a member and the team isn't at capacity,
 *  so concurrent joins can't double-add someone or overfill. */
async function addMember(teamId: mongoose.Types.ObjectId, userId: string): Promise<boolean> {
  const res = await Team.updateOne(
    {
      _id: teamId,
      'members.user': { $ne: new mongoose.Types.ObjectId(userId) },
      $expr: { $lt: [{ $size: '$members' }, MAX_TEAM_MEMBERS] },
    },
    { $push: { members: { user: new mongoose.Types.ObjectId(userId), role: 'member', joinedAt: new Date() } } },
  );
  if (res.modifiedCount !== 1) return false;
  await TeamJoinRequest.updateMany(
    { team: teamId, user: userId, status: 'pending' },
    { $set: { status: 'accepted', resolvedAt: new Date() } },
  );
  emitTeamUpdate(teamId.toString());
  return true;
}

async function removeMember(team: ITeam, userId: string) {
  await Team.updateOne({ _id: team._id }, { $pull: { members: { user: userId } } });
  removeUserFromTeamRoom(team.id, userId);
  emitTeamUpdate(team.id);
}

async function hasOpenTournaments(teamId: mongoose.Types.ObjectId): Promise<boolean> {
  return !!(await Tournament.exists({ team: teamId, status: { $in: ['pending', 'active'] } }));
}

async function disband(team: ITeam) {
  await releaseOwnerSlot(team.owner, team._id);
  await TeamJoinRequest.deleteMany({ team: team._id });
  await TeamAnnouncement.deleteMany({ team: team._id });
  await Team.deleteOne({ _id: team._id });
  closeTeamRoom(team.id);
}

/** Card-sized view used by the lists. Deliberately has no member cap and no
 *  entry code, only whether one exists. */
function summarize(team: any, myId: string, pendingTeamIds: Set<string>) {
  const members = team.members as { user: mongoose.Types.ObjectId; role?: string }[];
  const id = team._id.toString();
  const mine = members.find((m) => m.user.toString() === myId);
  return {
    id,
    name: team.name,
    description: team.description ?? '',
    memberCount: members.length,
    joinMode: team.joinMode ?? 'open',
    hasCode: !!team.entryCode,
    isMember: members.some((m) => m.user.toString() === myId),
    isOwner: team.owner.toString() === myId,
    /** Owner or leader: can post announcements and manage leaders. */
    isLeader: !!mine && (mine.role === 'owner' || mine.role === 'leader' || team.owner.toString() === myId),
    requestPending: pendingTeamIds.has(id),
    createdAt: team.createdAt,
  };
}

async function pendingFor(myId: string, teams: any[]): Promise<Set<string>> {
  if (teams.length === 0) return new Set();
  const reqs = await TeamJoinRequest.find({
    user: myId,
    status: 'pending',
    team: { $in: teams.map((t) => t._id) },
  })
    .select('team')
    .lean();
  return new Set(reqs.map((r) => r.team.toString()));
}

async function loadTeam(id: string, withCode = false): Promise<ITeam> {
  const q = Team.findById(id);
  if (withCode) q.select('+entryCode');
  const team = await q;
  if (!team) throw ApiError.notFound('Team not found');
  return team;
}

function assertOwner(team: ITeam, userId: string, message = 'Only the team owner can do that') {
  if (team.owner.toString() !== userId) throw ApiError.forbidden(message);
}

/** The owner always counts as a leader, whatever their stored role says. */
function isLeaderOf(team: ITeam, userId: string): boolean {
  if (team.owner.toString() === userId) return true;
  return team.members.some((m) => m.user.toString() === userId && (m.role === 'leader' || m.role === 'owner'));
}

function assertLeader(team: ITeam, userId: string, message = 'Only team leaders can do that') {
  if (!isLeaderOf(team, userId)) throw ApiError.forbidden(message);
}

function assertMember(team: ITeam, userId: string) {
  if (!team.members.some((m) => m.user.toString() === userId)) {
    throw ApiError.forbidden('Only team members can see that');
  }
}

const LIST_FIELDS = 'name description owner joinMode createdAt members.user members.role +entryCode';

export const listMyTeams = asyncHandler(async (req: AuthedRequest, res) => {
  const me = req.user!.id;
  const teams = await Team.find({ 'members.user': me }).select(LIST_FIELDS).sort({ createdAt: 1 }).lean();
  const owned = teams.filter((t) => t.owner.toString() === me).length;
  res.json({
    teams: teams.map((t) => summarize(t, me, new Set())),
    ownedCount: owned,
    ownedLimit: MAX_OWNED_TEAMS,
  });
});

export const searchTeams = asyncHandler(async (req: AuthedRequest, res) => {
  const { q } = searchSchema.parse(req.query);
  const me = req.user!.id;
  const filter = q
    ? { nameLower: new RegExp('^' + q.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }
    : {};
  const teams = await Team.find(filter)
    .select(LIST_FIELDS)
    .sort(q ? { nameLower: 1 } : { createdAt: -1 })
    .limit(20)
    .lean();
  const pending = await pendingFor(me, teams);
  res.json({ teams: teams.map((t) => summarize(t, me, pending)) });
});

export const getTeam = asyncHandler(async (req: AuthedRequest, res) => {
  const me = req.user!.id;
  const id = objectId.parse(req.params.id);
  const team = await Team.findById(id).select(LIST_FIELDS).lean();
  if (!team) throw ApiError.notFound('Team not found');

  const pending = await pendingFor(me, [team]);
  const base = summarize(team, me, pending);

  const [owner, avg, pendingRequests] = await Promise.all([
    User.findById(team.owner).select('username avatarGradient').lean(),
    Team.aggregate<{ avg: number }>([
      { $match: { _id: team._id } },
      { $unwind: '$members' },
      { $lookup: { from: 'users', localField: 'members.user', foreignField: '_id', as: 'u' } },
      { $unwind: '$u' },
      { $group: { _id: null, avg: { $avg: '$u.rating' } } },
    ]),
    base.isOwner ? TeamJoinRequest.countDocuments({ team: team._id, status: 'pending' }) : Promise.resolve(0),
  ]);

  res.json({
    team: {
      ...base,
      avgRating: avg[0] ? Math.round(avg[0].avg) : null,
      owner: owner ? { id: owner._id.toString(), username: owner.username, avatarGradient: owner.avatarGradient ?? null } : null,
      // Owner-only.
      entryCode: base.isOwner ? ((team as any).entryCode ?? null) : undefined,
      pendingRequests: base.isOwner ? pendingRequests : undefined,
    },
  });
});

const ROLE_ORDER = { owner: 0, leader: 1, member: 2 } as const;

export const listMembers = asyncHandler(async (req: AuthedRequest, res) => {
  const team = await loadTeam(objectId.parse(req.params.id));
  assertMember(team, req.user!.id);
  const { page, limit, q, leaders } = pageSchema.parse(req.query);

  let pool = [...team.members];
  if (leaders) pool = pool.filter((m) => m.role === 'owner' || m.role === 'leader');

  // A username search has to look at user docs, so resolve matching ids first
  // and only then page over them.
  if (q) {
    const rx = new RegExp('^' + q.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const hits = await User.find({ _id: { $in: pool.map((m) => m.user) }, usernameLower: rx })
      .select('_id')
      .limit(200)
      .lean();
    const ok = new Set(hits.map((h) => h._id.toString()));
    pool = pool.filter((m) => ok.has(m.user.toString()));
  }

  const sorted = pool.sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? 2;
    const rb = ROLE_ORDER[b.role] ?? 2;
    if (ra !== rb) return ra - rb;
    return a.joinedAt.getTime() - b.joinedAt.getTime();
  });
  const slice = sorted.slice((page - 1) * limit, page * limit);
  const users = await User.find({ _id: { $in: slice.map((m) => m.user) } })
    .select('username avatarUrl avatarGradient rating')
    .lean();
  const byId = new Map(users.map((u) => [u._id.toString(), u]));

  res.json({
    members: slice
      .map((m) => {
        const u = byId.get(m.user.toString());
        if (!u) return null;
        return {
          id: u._id.toString(),
          username: u.username,
          avatarUrl: u.avatarUrl ?? null,
          avatarGradient: u.avatarGradient ?? null,
          rating: u.rating,
          role: m.role,
          joinedAt: m.joinedAt,
        };
      })
      .filter(Boolean),
    page,
    limit,
    total: sorted.length,
    totalPages: Math.max(1, Math.ceil(sorted.length / limit)),
  });
});

export const createTeam = asyncHandler(async (req: AuthedRequest, res) => {
  const { name, description, joinMode, entryCode } = createSchema.parse(req.body);
  const me = req.user!.id;
  const nameLower = name.toLowerCase();

  if (await Team.exists({ nameLower })) throw ApiError.conflict('That team name is taken');

  const _id = new mongoose.Types.ObjectId();
  if (!(await claimOwnerSlot(me, _id))) throw ApiError.conflict(OWNER_LIMIT_MESSAGE);

  try {
    const meId = new mongoose.Types.ObjectId(me);
    await Team.create({
      _id,
      name,
      nameLower,
      description,
      owner: meId,
      joinMode,
      entryCode: entryCode ?? null,
      members: [{ user: meId, role: 'owner' }],
    });
  } catch (err: any) {
    await releaseOwnerSlot(me, _id);
    if (err?.code === 11000) throw ApiError.conflict('That team name is taken');
    throw err;
  }

  res.status(201).json({ id: _id.toString() });
});

export const updateTeam = asyncHandler(async (req: AuthedRequest, res) => {
  const patch = updateSchema.parse(req.body);
  const team = await loadTeam(objectId.parse(req.params.id));
  assertOwner(team, req.user!.id, 'Only the owner can edit the team');

  if (patch.name !== undefined && patch.name.toLowerCase() !== team.nameLower) {
    if (await Team.exists({ nameLower: patch.name.toLowerCase(), _id: { $ne: team._id } })) {
      throw ApiError.conflict('That team name is taken');
    }
    team.name = patch.name;
    team.nameLower = patch.name.toLowerCase();
  }
  if (patch.description !== undefined) team.description = patch.description;
  if (patch.joinMode !== undefined) team.joinMode = patch.joinMode;
  if (patch.entryCode !== undefined) team.entryCode = patch.entryCode; // null clears it

  try {
    await team.save();
  } catch (err: any) {
    if (err?.code === 11000) throw ApiError.conflict('That team name is taken');
    throw err;
  }

  emitTeamUpdate(team.id);
  res.json({ id: team.id });
});

export const joinTeam = asyncHandler(async (req: AuthedRequest, res) => {
  const me = req.user!.id;
  const { code } = joinSchema.parse(req.body ?? {});
  const team = await loadTeam(objectId.parse(req.params.id), true);

  if (team.members.some((m) => m.user.toString() === me)) throw ApiError.conflict('You are already in this team');
  if (team.members.length >= MAX_TEAM_MEMBERS) throw ApiError.conflict('This team is full');

  const hasCode = !!team.entryCode;
  const codeOk = hasCode && !!code && codesMatch(code, team.entryCode!);

  // A wrong code is an error either way, so people get told rather than
  // silently falling through to a join request.
  if (hasCode && code && !codeOk) throw ApiError.forbidden('Incorrect entry code');

  let canJoinNow = false;
  if (codeOk) canJoinNow = true;
  else if (team.joinMode === 'open') {
    if (hasCode) throw ApiError.forbidden('This team needs an entry code to join');
    canJoinNow = true;
  }

  if (canJoinNow) {
    if (!(await addMember(team._id, me))) throw ApiError.conflict('This team is full');
    return res.json({ status: 'joined', id: team.id });
  }

  // Request-to-join.
  const recentlyDeclined = await TeamJoinRequest.exists({
    team: team._id,
    user: me,
    status: 'declined',
    resolvedAt: { $gt: new Date(Date.now() - DECLINE_COOLDOWN_MS) },
  });
  if (recentlyDeclined) throw ApiError.conflict('Your last request was declined. Try again later.');

  try {
    await TeamJoinRequest.create({ team: team._id, user: me });
  } catch (err: any) {
    if (err?.code === 11000) throw ApiError.conflict('You already have a pending request');
    throw err;
  }
  emitToUser(team.owner.toString(), 'team:request_received', { teamId: team.id });
  emitTeamUpdate(team.id);
  res.status(202).json({ status: 'requested', id: team.id });
});

export const cancelJoinRequest = asyncHandler(async (req: AuthedRequest, res) => {
  const teamId = objectId.parse(req.params.id);
  await TeamJoinRequest.updateOne(
    { team: teamId, user: req.user!.id, status: 'pending' },
    { $set: { status: 'cancelled', resolvedAt: new Date() } },
  );
  emitTeamUpdate(teamId);
  res.status(204).end();
});

export const listJoinRequests = asyncHandler(async (req: AuthedRequest, res) => {
  const team = await loadTeam(objectId.parse(req.params.id));
  assertOwner(team, req.user!.id);
  const { page, limit } = pageSchema.parse(req.query);
  const filter = { team: team._id, status: 'pending' as const };
  const total = await TeamJoinRequest.countDocuments(filter);
  const requests = await TeamJoinRequest.find(filter)
    .populate('user', 'username avatarGradient avatarUrl rating')
    .sort({ createdAt: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  res.json({
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    requests: requests
      .filter((r: any) => r.user)
      .map((r: any) => ({
        id: r._id.toString(),
        createdAt: r.createdAt,
        user: {
          id: r.user._id.toString(),
          username: r.user.username,
          avatarUrl: r.user.avatarUrl ?? null,
          avatarGradient: r.user.avatarGradient ?? null,
          rating: r.user.rating,
        },
      })),
  });
});

export const respondToJoinRequest = asyncHandler(async (req: AuthedRequest, res) => {
  const { accept } = respondSchema.parse(req.body);
  const team = await loadTeam(objectId.parse(req.params.id));
  assertOwner(team, req.user!.id);
  const requestId = objectId.parse(req.params.requestId);

  const request = await TeamJoinRequest.findOne({ _id: requestId, team: team._id });
  if (!request) throw ApiError.notFound('Request not found');
  if (request.status !== 'pending') throw ApiError.conflict('Request already resolved');

  if (accept) {
    if (team.members.some((m) => m.user.toString() === request.user.toString())) {
      request.status = 'accepted';
    } else if (!(await addMember(team._id, request.user.toString()))) {
      throw ApiError.conflict('This team is full');
    } else {
      request.status = 'accepted'; // addMember already marked it, keep in sync
    }
  } else {
    request.status = 'declined';
  }
  request.resolvedAt = new Date();
  await request.save();

  emitToUser(request.user.toString(), 'team:request_resolved', { teamId: team.id, accepted: accept });
  emitTeamUpdate(team.id);
  res.json({ status: request.status });
});

export const leaveTeam = asyncHandler(async (req: AuthedRequest, res) => {
  const me = req.user!.id;
  const team = await loadTeam(objectId.parse(req.params.id));
  if (!team.members.some((m) => m.user.toString() === me)) throw ApiError.badRequest('You are not in this team');

  if (team.owner.toString() === me) {
    if (team.members.length > 1) {
      throw ApiError.conflict('Hand ownership to another member before you leave, or delete the team.');
    }
    if (await hasOpenTournaments(team._id)) {
      throw ApiError.conflict('Finish or cancel the team’s tournaments before deleting it.');
    }
    await disband(team); // sole member leaving: nothing left to keep
    return res.json({ disbanded: true });
  }

  await removeMember(team, me);
  res.json({ disbanded: false });
});

export const transferOwnership = asyncHandler(async (req: AuthedRequest, res) => {
  const { userId: target } = transferSchema.parse(req.body);
  const team = await loadTeam(objectId.parse(req.params.id));
  assertOwner(team, req.user!.id);
  if (target === req.user!.id) throw ApiError.badRequest('You already own this team');
  if (!team.members.some((m) => m.user.toString() === target)) throw ApiError.notFound('That person is not in the team');
  if (await hasOpenTournaments(team._id)) {
    throw ApiError.conflict('Finish or cancel the team’s tournaments before handing it over.');
  }

  if (!(await claimOwnerSlot(target, team._id))) {
    throw ApiError.conflict(`That member already owns ${MAX_OWNED_TEAMS} teams.`);
  }
  const res2 = await Team.updateOne(
    { _id: team._id, owner: req.user!.id },
    {
      $set: { owner: new mongoose.Types.ObjectId(target), 'members.$[old].role': 'leader', 'members.$[next].role': 'owner' },
    },
    {
      arrayFilters: [
        { 'old.user': new mongoose.Types.ObjectId(req.user!.id) },
        { 'next.user': new mongoose.Types.ObjectId(target) },
      ],
    },
  );
  if (res2.modifiedCount !== 1) {
    await releaseOwnerSlot(target, team._id);
    throw ApiError.conflict('Ownership changed, try again.');
  }
  await releaseOwnerSlot(req.user!.id, team._id);
  emitTeamUpdate(team.id);
  res.json({ id: team.id });
});

export const kickMember = asyncHandler(async (req: AuthedRequest, res) => {
  const team = await loadTeam(objectId.parse(req.params.id));
  const target = objectId.parse(req.params.userId);
  assertOwner(team, req.user!.id, 'Only the owner can remove members');
  if (target === req.user!.id) throw ApiError.badRequest('Use "Leave team" to leave');
  if (!team.members.some((m) => m.user.toString() === target)) throw ApiError.notFound('Member not found');
  await removeMember(team, target);
  res.status(204).end();
});

export const deleteTeam = asyncHandler(async (req: AuthedRequest, res) => {
  const team = await loadTeam(objectId.parse(req.params.id));
  assertOwner(team, req.user!.id, 'Only the owner can delete the team');
  if (await hasOpenTournaments(team._id)) {
    throw ApiError.conflict('Finish or cancel the team’s tournaments before deleting it.');
  }
  await disband(team);
  res.status(204).end();
});

export const getTeamTournaments = asyncHandler(async (req: AuthedRequest, res) => {
  const team = await loadTeam(objectId.parse(req.params.id));
  assertMember(team, req.user!.id);
  const { scope, page } = tournamentsQuerySchema.parse(req.query);
  res.json(await listTeamTournaments(team.id, { scope, page }));
});

// ---------------------------------------------------------------------------
// Leaders
// ---------------------------------------------------------------------------

/** Any leader can promote a regular member. */
export const addLeader = asyncHandler(async (req: AuthedRequest, res) => {
  const { userId: target } = leaderSchema.parse(req.body);
  const team = await loadTeam(objectId.parse(req.params.id));
  assertLeader(team, req.user!.id, 'Only team leaders can add leaders');

  const entry = team.members.find((m) => m.user.toString() === target);
  if (!entry) throw ApiError.notFound('That person is not in the team');
  if (entry.role !== 'member') throw ApiError.conflict('They are already a leader');

  const targetId = new mongoose.Types.ObjectId(target);
  const r = await Team.updateOne(
    { _id: team._id, members: { $elemMatch: { user: targetId, role: 'member' } } },
    { $set: { 'members.$.role': 'leader' } },
  );
  if (r.modifiedCount !== 1) throw ApiError.conflict('Something changed, try again');
  emitToUser(target, 'team:role_changed', { teamId: team.id, role: 'leader' });
  emitTeamUpdate(team.id);
  res.json({ id: team.id });
});

/** Any leader can step another leader back down to member, except the
 *  creator / main leader, who is permanent. */
export const removeLeader = asyncHandler(async (req: AuthedRequest, res) => {
  const team = await loadTeam(objectId.parse(req.params.id));
  const target = objectId.parse(req.params.userId);
  assertLeader(team, req.user!.id, 'Only team leaders can remove leaders');

  if (team.owner.toString() === target) {
    throw ApiError.forbidden('The team creator is always a leader and cannot be removed');
  }
  const entry = team.members.find((m) => m.user.toString() === target);
  if (!entry) throw ApiError.notFound('That person is not in the team');
  if (entry.role !== 'leader') throw ApiError.conflict('They are not a leader');

  const targetId = new mongoose.Types.ObjectId(target);
  const r = await Team.updateOne(
    {
      _id: team._id,
      owner: { $ne: targetId },
      members: { $elemMatch: { user: targetId, role: 'leader' } },
    },
    { $set: { 'members.$.role': 'member' } },
  );
  if (r.modifiedCount !== 1) throw ApiError.conflict('Something changed, try again');
  emitToUser(target, 'team:role_changed', { teamId: team.id, role: 'member' });
  emitTeamUpdate(team.id);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

/** What the team page shows: pinned ones first (there are never more than
 *  MAX_PINNED_ANNOUNCEMENTS), then the newest of the rest, ANNOUNCEMENTS_SHOWN
 *  in total. So a pin can't be pushed down by newer posts, and the list is
 *  never longer than five. */
export const listAnnouncements = asyncHandler(async (req: AuthedRequest, res) => {
  const team = await loadTeam(objectId.parse(req.params.id));
  assertMember(team, req.user!.id);

  const pinned = await TeamAnnouncement.find({ team: team._id, pinned: true })
    .sort({ pinnedAt: -1, createdAt: -1 })
    .limit(MAX_PINNED_ANNOUNCEMENTS)
    .populate('author', 'username avatarGradient avatarUrl')
    .lean();
  const recent = await TeamAnnouncement.find({ team: team._id, pinned: { $ne: true } })
    .sort({ createdAt: -1 })
    .limit(Math.max(0, ANNOUNCEMENTS_SHOWN - pinned.length))
    .populate('author', 'username avatarGradient avatarUrl')
    .lean();

  res.json({
    announcements: [...pinned, ...recent].map((a: any) => ({
      id: a._id.toString(),
      title: a.title ?? '',
      body: a.body,
      pinned: !!a.pinned,
      createdAt: a.createdAt,
      author: a.author
        ? {
            id: a.author._id.toString(),
            username: a.author.username,
            avatarUrl: a.author.avatarUrl ?? null,
            avatarGradient: a.author.avatarGradient ?? null,
          }
        : null,
    })),
    maxPinned: MAX_PINNED_ANNOUNCEMENTS,
    pinnedCount: pinned.length,
  });
});

export const createAnnouncement = asyncHandler(async (req: AuthedRequest, res) => {
  const { title, body, pinned } = announcementSchema.parse(req.body);
  const team = await loadTeam(objectId.parse(req.params.id));
  assertLeader(team, req.user!.id, 'Only team leaders can post announcements');

  if (pinned && (await TeamAnnouncement.countDocuments({ team: team._id, pinned: true })) >= MAX_PINNED_ANNOUNCEMENTS) {
    throw ApiError.conflict(`You can pin up to ${MAX_PINNED_ANNOUNCEMENTS} announcements. Unpin one first.`);
  }

  const doc = await TeamAnnouncement.create({
    team: team._id,
    author: req.user!.id,
    title,
    body,
    pinned,
    pinnedAt: pinned ? new Date() : null,
  });

  // Nobody ever sees past the latest few, so don't hoard old unpinned ones.
  const stale = await TeamAnnouncement.find({ team: team._id, pinned: { $ne: true } })
    .sort({ createdAt: -1 })
    .skip(KEEP_UNPINNED_ANNOUNCEMENTS)
    .select('_id')
    .lean();
  if (stale.length) await TeamAnnouncement.deleteMany({ _id: { $in: stale.map((x) => x._id) } });

  emitTeamUpdate(team.id);

  // Tell every other member. Best-effort: the announcement is already saved,
  // a notification hiccup shouldn't fail the post.
  const authorName = req.user!.username;
  const preview = (title ? `${title}: ${body}` : body).replace(/\s+/g, ' ');
  createNotificationsForMany(
    team.members.map((m) => m.user.toString()).filter((id) => id !== req.user!.id),
    {
      type: 'team_announcement',
      title: `${team.name}: new announcement`,
      body: `${authorName}: ${preview.length > 180 ? `${preview.slice(0, 177)}...` : preview}`,
      link: `/teams/${team.id}`,
    },
  ).catch((err) => console.error('team announcement notifications failed:', err));

  res.status(201).json({ id: doc._id.toString() });
});

export const updateAnnouncement = asyncHandler(async (req: AuthedRequest, res) => {
  const { pinned } = announcementPatchSchema.parse(req.body);
  const team = await loadTeam(objectId.parse(req.params.id));
  assertLeader(team, req.user!.id, 'Only team leaders can pin announcements');
  const announcementId = objectId.parse(req.params.announcementId);

  const current = await TeamAnnouncement.findOne({ _id: announcementId, team: team._id }).select('pinned').lean();
  if (!current) throw ApiError.notFound('Announcement not found');

  if (pinned && !current.pinned) {
    const count = await TeamAnnouncement.countDocuments({ team: team._id, pinned: true });
    if (count >= MAX_PINNED_ANNOUNCEMENTS) {
      throw ApiError.conflict(`You can pin up to ${MAX_PINNED_ANNOUNCEMENTS} announcements. Unpin one first.`);
    }
  }

  await TeamAnnouncement.updateOne(
    { _id: announcementId, team: team._id },
    { $set: { pinned, pinnedAt: pinned ? new Date() : null } },
  );
  emitTeamUpdate(team.id);
  res.json({ id: announcementId, pinned });
});

export const deleteAnnouncement = asyncHandler(async (req: AuthedRequest, res) => {
  const team = await loadTeam(objectId.parse(req.params.id));
  assertLeader(team, req.user!.id, 'Only team leaders can delete announcements');
  const r = await TeamAnnouncement.deleteOne({ _id: objectId.parse(req.params.announcementId), team: team._id });
  if (r.deletedCount !== 1) throw ApiError.notFound('Announcement not found');
  emitTeamUpdate(team.id);
  res.status(204).end();
});
