import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { signAdminToken } from '../services/token.service.js';
import { Report } from '../models/Report.js';
import { User } from '../models/User.js';
import { Game } from '../models/Game.js';
import { PlatformRevenue } from '../models/PlatformRevenue.js';
import { analyzeGameForSuspicion } from '../services/anticheat.service.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const revenueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

/** The admin page's rake/revenue view — a running total ("admin wallet"
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

  // Fixed, single-account, operator-configured credentials — not a User
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
  // update — kept as an explicit, separate flag rather than inferred from
  // status, so closing out a report never *silently* restores withdrawals.
  clearWithdrawalBlock: z.boolean().optional(),
});

export const updateReport = asyncHandler(async (req, res) => {
  const body = updateReportSchema.parse(req.body);

  const report = await Report.findById(req.params.id);
  if (!report) throw ApiError.notFound('Report not found');

  report.status = body.status;
  if (body.reviewNotes !== undefined) report.reviewNotes = body.reviewNotes;
  report.reviewedBy = env.ADMIN_USERNAME ?? 'admin';
  report.reviewedAt = new Date();
  await report.save();

  if (body.clearWithdrawalBlock) {
    // Only clear it if there's no OTHER still-open report against the same
    // user — otherwise resolving one report would silently reopen
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
