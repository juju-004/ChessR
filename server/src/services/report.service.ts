import { Report, type IReport } from '../models/Report.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { createNotification } from './notification.service.js';

// Spam controls, all per-reporter. None of these are about whether a
// report is *true*, that's what admin review is for, only about making
// it cost more than a click to flood the queue with them.
//
// - a short cooldown stops a double-click or a script from firing the
//   same report multiple times in a row
// - a rolling daily cap bounds how much queue space one account can eat
//   even spread out over a day
// - the duplicate guard stops re-reporting the same person again and
//   again before anyone's even looked at the first one, a second report
//   about NEW information is still fine once the first is resolved
const REPORT_COOLDOWN_MS = 60_000;
const REPORT_DAILY_LIMIT = 10;

// A single report freezes nothing on its own, one person's word (however
// sincere) isn't evidence, it's a queue entry for an admin to look at. Once
// a *second, distinct* person has an open report against the same account,
// that's an independent corroborating signal worth acting on immediately
// rather than waiting for a human to get to both, hence the freeze here.
const DISTINCT_REPORTERS_FREEZE_THRESHOLD = 2;

/** Accepts either a bare join code or a full/partial game URL pasted into
 *  the report form and normalizes down to just the code, mirrors the
 *  client-side extraction in ReportUserModal.tsx so a direct API call
 *  gets the same behavior, not just the UI. */
function normalizeGameCode(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/game\/([a-zA-Z0-9]+)/);
  return (match ? match[1] : trimmed).toUpperCase();
}

export interface CreateReportParams {
  reporterId: string;
  reportedUsername: string;
  reason: IReport['reason'];
  description: string;
  gameCode?: string;
}

export async function createReport(params: CreateReportParams): Promise<IReport> {
  const { reporterId, reportedUsername, reason, description, gameCode } = params;

  const reporter = await User.findById(reporterId).select('reportingBlocked').lean();
  if (reporter?.reportingBlocked) {
    throw ApiError.forbidden(
      'Your account is currently restricted from filing reports. Contact support if you believe this is a mistake.',
    );
  }

  const reportedUser = await User.findOne({ usernameLower: reportedUsername.toLowerCase() });
  if (!reportedUser) throw ApiError.notFound('User not found');
  if (reportedUser._id.toString() === reporterId) {
    throw ApiError.badRequest("You can't report yourself");
  }

  const [lastReport, dailyCount, duplicatePending] = await Promise.all([
    Report.findOne({ reporter: reporterId }).sort({ createdAt: -1 }).select('createdAt').lean(),
    Report.countDocuments({ reporter: reporterId, createdAt: { $gte: new Date(Date.now() - 86_400_000) } }),
    Report.exists({
      reporter: reporterId,
      reportedUser: reportedUser._id,
      status: { $in: ['pending', 'reviewing'] },
    }),
  ]);

  if (lastReport && Date.now() - lastReport.createdAt.getTime() < REPORT_COOLDOWN_MS) {
    throw ApiError.badRequest('Please wait a moment before filing another report.');
  }
  if (dailyCount >= REPORT_DAILY_LIMIT) {
    throw ApiError.badRequest("You've reached the daily limit for reports. Try again tomorrow.");
  }
  if (duplicatePending) {
    throw ApiError.badRequest(
      `You already have a report about ${reportedUser.username} awaiting review.`,
    );
  }

  const report = await Report.create({
    reporter: reporterId,
    reportedUser: reportedUser._id,
    reason,
    description,
    gameCode: gameCode?.trim() ? normalizeGameCode(gameCode) : undefined,
  });

  // Reaches the admin dash purely by having been created, above, an
  // admin can see and act on a single report immediately. The automatic
  // freeze, though, waits for more than one distinct person to have an
  // open report against this account (see DISTINCT_REPORTERS_FREEZE_THRESHOLD),
  // not the first report alone.
  const distinctReporters = await Report.distinct('reporter', {
    reportedUser: reportedUser._id,
    status: { $in: ['pending', 'reviewing'] },
  });

  if (distinctReporters.length >= DISTINCT_REPORTERS_FREEZE_THRESHOLD && !reportedUser.withdrawalBlocked) {
    await User.updateOne({ _id: reportedUser._id }, { $set: { withdrawalBlocked: true } });
    await createNotification({
      recipientId: reportedUser._id.toString(),
      type: 'report_freeze',
      title: 'Your funds have been temporarily frozen',
      body:
        `Multiple players have reported your account. As a precaution, withdrawals are frozen ` +
        `until our team has reviewed the reports. This is an automatic hold, not a final decision, ` +
        `you can keep playing in the meantime. We'll notify you once it's been reviewed.`,
    }).catch((err) => console.error('Failed to send report_freeze notification:', err));
  }

  return report;
}
