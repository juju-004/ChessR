import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { signAdminToken } from '../services/token.service.js';
import { Report } from '../models/Report.js';
import { User } from '../models/User.js';
import { Game } from '../models/Game.js';
import { GameFlag } from '../models/GameFlag.js';
import { PlatformRevenue } from '../models/PlatformRevenue.js';
import { analyzeGameForSuspicion } from '../services/anticheat.service.js';
import { createNotification } from '../services/notification.service.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const revenueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

/** The admin page's rake/revenue view, a running total ("admin wallet"
 *  balance, summed straight from the PlatformRevenue ledger rather than a
 *  separately-tracked counter that could drift out of sync with it), a
 *  breakdown by source so it's clear how much came from games vs. cage
 *  matches vs. tournament reg fees, and a paginated feed of individual
 *  cuts for auditing. See wallet.service.ts's computeRake/recordRake for
 *  where these rows come from, and RAKE_PERCENT in .env for the current
 *  rate. */
export const getRevenueSummary = asyncHandler(async (req, res) => {
  const { page, limit } = revenueQuerySchema.parse(req.query);

  const [totals, entries, total] = await Promise.all([
    PlatformRevenue.aggregate<{ _id: string; tokens: number; count: number }>([
      { $group: { _id: '$source', tokens: { $sum: '$tokens' }, count: { $sum: 1 } } },
    ]),
    PlatformRevenue.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PlatformRevenue.countDocuments(),
  ]);

  const bySource: Record<string, { tokens: number; count: number }> = {
    game: { tokens: 0, count: 0 },
    cage_match: { tokens: 0, count: 0 },
    tournament: { tokens: 0, count: 0 },
  };
  let balanceTokens = 0;
  for (const row of totals) {
    bySource[row._id] = { tokens: row.tokens, count: row.count };
    balanceTokens += row.tokens;
  }

  res.json({
    balanceTokens,
    ratePercent: env.RAKE_PERCENT,
    bySource,
    entries: entries.map((e) => ({
      id: e._id,
      source: e.source,
      sourceId: e.sourceId,
      tokens: e.tokens,
      grossPotTokens: e.grossPotTokens,
      ratePercent: e.ratePercent,
      createdAt: e.createdAt,
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

export const adminLogin = asyncHandler(async (req, res) => {
  const { username, password } = loginSchema.parse(req.body);

  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    throw ApiError.internal('Admin login is not configured');
  }

  // Fixed, single-account, operator-configured credentials, not a User
  // document, so a plain constant-shape comparison is enough here (no
  // per-user hash to manage, no account to ever register). Timing-safe-ish
  // in practice since both sides are short fixed strings compared whole.
  if (username !== env.ADMIN_USERNAME || password !== env.ADMIN_PASSWORD) {
    throw ApiError.unauthorized('Invalid admin credentials');
  }

  res.json({ token: signAdminToken() });
});

export const listReports = asyncHandler(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const filter = status && status !== 'all' ? { status } : {};

  const reports = await Report.find(filter)
    .sort({ createdAt: -1 })
    .limit(200)
    .populate('reporter', 'username reportingBlocked')
    .populate('reportedUser', 'username withdrawalBlocked')
    .lean();

  res.json(
    reports.map((r) => ({
      id: r._id,
      reporter: r.reporter,
      reportedUser: r.reportedUser,
      reason: r.reason,
      description: r.description,
      gameCode: r.gameCode,
      status: r.status,
      createdAt: r.createdAt,
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt,
    })),
  );
});

export const getReportDetail = asyncHandler(async (req, res) => {
  const report = await Report.findById(req.params.id)
    .populate('reporter', 'username reportingBlocked')
    .populate('reportedUser', 'username withdrawalBlocked')
    .lean();
  if (!report) throw ApiError.notFound('Report not found');

  let game: Record<string, unknown> | null = null;
  if (report.gameCode) {
    const gameDoc = await Game.findOne({ joinCode: report.gameCode.toUpperCase() })
      .populate('white', 'username')
      .populate('black', 'username')
      .lean();
    if (gameDoc) {
      game = {
        id: gameDoc._id,
        joinCode: gameDoc.joinCode,
        variant: gameDoc.variant,
        white: gameDoc.white,
        black: gameDoc.black,
        status: gameDoc.status,
        result: gameDoc.result,
        endReason: gameDoc.endReason,
        pgn: gameDoc.pgn,
        moves: gameDoc.moves,
        timeControl: gameDoc.timeControl,
        wagerTokens: gameDoc.wagerTokens,
        startedAt: gameDoc.startedAt,
        endedAt: gameDoc.endedAt,
        suspicion: analyzeGameForSuspicion(gameDoc.moves),
      };
    }
  }

  res.json({
    id: report._id,
    reporter: report.reporter,
    reportedUser: report.reportedUser,
    reason: report.reason,
    description: report.description,
    gameCode: report.gameCode,
    status: report.status,
    createdAt: report.createdAt,
    reviewedBy: report.reviewedBy,
    reviewedAt: report.reviewedAt,
    reviewNotes: report.reviewNotes,
    game,
  });
});

const setReportingBlockSchema = z.object({
  blocked: z.boolean(),
});

export const setUserReportingBlock = asyncHandler(async (req, res) => {
  const { blocked } = setReportingBlockSchema.parse(req.body);
  const username = String(req.params.username);

  const user = await User.findOneAndUpdate(
    { usernameLower: username.toLowerCase() },
    { $set: { reportingBlocked: blocked } },
    { new: true },
  ).select('username reportingBlocked');

  if (!user) throw ApiError.notFound('User not found');

  res.json({ username: user.username, reportingBlocked: user.reportingBlocked });
});

const updateReportSchema = z.object({
  status: z.enum(['pending', 'reviewing', 'actioned', 'dismissed']),
  reviewNotes: z.string().trim().max(2000).optional(),
  // Whether to clear the reported user's withdrawal block as part of this
  // update, kept as an explicit, separate flag rather than inferred from
  // status, so closing out a report never *silently* restores withdrawals.
  clearWithdrawalBlock: z.boolean().optional(),
});

// A report getting dismissed doesn't by itself mean the reporter acted in
// bad faith, people misjudge situations honestly all the time. A *pattern*
// of dismissals is a different story: once this many of one person's
// reports have been looked at and thrown out, that's a real signal
// (adjudicated by an admin, not guessed at automatically) that they're
// reporting people "for fun" rather than in good faith.
const DISMISSED_REPORTS_SUSPENSION_THRESHOLD = 5;
const REPORT_ABUSE_SUSPENSION_DAYS = 7;

/** Runs after a report is dismissed, checks whether the REPORTER (not the
 *  reported user) has crossed the bad-faith-reporting threshold, and if
 *  so, restricts them from playing or chatting for
 *  REPORT_ABUSE_SUSPENSION_DAYS by setting User.suspendedUntil (enforced
 *  at each specific action via suspension.service.ts's
 *  assertNotRestricted — starting a challenge/cage match/tournament, or
 *  sending a chat message). Deliberately narrow: this does NOT sign them
 *  out, block browsing, or touch withdrawals/deposits (those are governed
 *  entirely by the separate withdrawalBlocked field) — someone flagged
 *  for reporting abuse still has full access to their wallet, they just
 *  can't start playing or talking to other players until it lifts. The
 *  client reads suspendedUntil straight off their own user object (see
 *  userFields() in auth.controller.ts) to show a countdown on Dashboard.
 *
 *  Fires exactly once per threshold crossing (checks the count *equals*
 *  the threshold, not >=), so re-dismissing a 6th, 7th, ... report from
 *  the same repeat offender doesn't stack additional restrictions or
 *  reset the clock on one already in effect. */
async function checkReportAbuseSuspension(reporterId: string): Promise<void> {
  const dismissedCount = await Report.countDocuments({ reporter: reporterId, status: 'dismissed' });
  if (dismissedCount !== DISMISSED_REPORTS_SUSPENSION_THRESHOLD) return;

  const suspendedUntil = new Date(Date.now() + REPORT_ABUSE_SUSPENSION_DAYS * 86_400_000);
  await User.updateOne({ _id: reporterId }, { $set: { suspendedUntil } });

  await createNotification({
    recipientId: reporterId,
    type: 'admin_message',
    title: "You're temporarily restricted from playing and chatting",
    body:
      `Several reports you've filed against other players were reviewed and dismissed. ` +
      `As a result, you can't start new games (challenges, cage matches, tournaments) or send chat ` +
      `messages until ${suspendedUntil.toDateString()}. Your wallet is unaffected, you can still deposit ` +
      `and withdraw normally. Please only report genuine violations, contact support if you believe ` +
      `this is a mistake.`,
  }).catch((err) => console.error('Failed to send report-abuse suspension notification:', err));
}

export const updateReport = asyncHandler(async (req, res) => {
  const body = updateReportSchema.parse(req.body);

  const report = await Report.findById(req.params.id);
  if (!report) throw ApiError.notFound('Report not found');

  report.status = body.status;
  if (body.reviewNotes !== undefined) report.reviewNotes = body.reviewNotes;
  report.reviewedBy = env.ADMIN_USERNAME ?? 'admin';
  report.reviewedAt = new Date();
  await report.save();

  if (body.status === 'dismissed') {
    checkReportAbuseSuspension(report.reporter.toString()).catch((err) =>
      console.error('checkReportAbuseSuspension failed:', err),
    );
  }

  if (body.clearWithdrawalBlock) {
    // Only clear it if there's no OTHER still-open report against the same
    // user, otherwise resolving one report would silently reopen
    // withdrawals while a second, unrelated one is still pending.
    const otherOpenReport = await Report.exists({
      _id: { $ne: report._id },
      reportedUser: report.reportedUser,
      status: { $in: ['pending', 'reviewing'] },
    });
    if (!otherOpenReport) {
      await User.updateOne({ _id: report.reportedUser }, { $set: { withdrawalBlocked: false } });
    }
  }

  res.json({ id: report._id, status: report.status });
});

const listGameFlagsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(['pending_review', 'cleared', 'actioned']).optional(),
});

/** The "game check" queue: games the anti-cheat heuristic auto-flagged,
 *  see anticheat.service.ts's runAutoCheatCheck. Separate from /reports —
 *  these weren't filed by a user, they're a system finding. */
export const listGameFlags = asyncHandler(async (req, res) => {
  const { page, limit, status } = listGameFlagsQuerySchema.parse(req.query);
  const filter = status ? { status } : {};

  const [flags, total] = await Promise.all([
    GameFlag.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('flaggedUser', 'username')
      .lean(),
    GameFlag.countDocuments(filter),
  ]);

  res.json({
    flags: flags.map((f: any) => ({
      id: f._id,
      gameId: f.game,
      gameCode: f.gameCode,
      flaggedUser: f.flaggedUser
        ? { id: f.flaggedUser._id, username: f.flaggedUser.username }
        : null,
      side: f.side,
      score: f.score,
      signals: f.signals,
      status: f.status,
      reviewedBy: f.reviewedBy,
      reviewedAt: f.reviewedAt,
      reviewNotes: f.reviewNotes,
      createdAt: f.createdAt,
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

const updateGameFlagSchema = z.object({
  status: z.enum(['pending_review', 'cleared', 'actioned']),
  reviewNotes: z.string().trim().max(2000).optional(),
  // Same explicit-flag-not-inferred-from-status posture as
  // updateReport's clearWithdrawalBlock, resolving a flag should never
  // *silently* restore withdrawals.
  clearWithdrawalBlock: z.boolean().optional(),
});

export const updateGameFlag = asyncHandler(async (req, res) => {
  const body = updateGameFlagSchema.parse(req.body);

  const flag = await GameFlag.findById(req.params.id);
  if (!flag) throw ApiError.notFound('Game flag not found');

  flag.status = body.status;
  if (body.reviewNotes !== undefined) flag.reviewNotes = body.reviewNotes;
  flag.reviewedBy = env.ADMIN_USERNAME ?? 'admin';
  flag.reviewedAt = new Date();
  await flag.save();

  if (body.clearWithdrawalBlock) {
    // Same "don't reopen withdrawals out from under a still-open, unrelated
    // hold" guard as updateReport, checked across BOTH GameFlags and
    // Reports since either kind can be the reason withdrawalBlocked is set.
    const [otherOpenFlag, otherOpenReport] = await Promise.all([
      GameFlag.exists({ _id: { $ne: flag._id }, flaggedUser: flag.flaggedUser, status: 'pending_review' }),
      Report.exists({ reportedUser: flag.flaggedUser, status: { $in: ['pending', 'reviewing'] } }),
    ]);
    if (!otherOpenFlag && !otherOpenReport) {
      await User.updateOne({ _id: flag.flaggedUser }, { $set: { withdrawalBlocked: false } });
    }
  }

  res.json({ id: flag._id, status: flag.status });
});
