import { Report, type IReport } from '../models/Report.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

export interface CreateReportParams {
  reporterId: string;
  reportedUsername: string;
  reason: IReport['reason'];
  description: string;
  gameCode?: string;
}

export async function createReport(params: CreateReportParams): Promise<IReport> {
  const { reporterId, reportedUsername, reason, description, gameCode } = params;

  const reportedUser = await User.findOne({ usernameLower: reportedUsername.toLowerCase() });
  if (!reportedUser) throw ApiError.notFound('User not found');
  if (reportedUser._id.toString() === reporterId) {
    throw ApiError.badRequest("You can't report yourself");
  }

  const report = await Report.create({
    reporter: reporterId,
    reportedUser: reportedUser._id,
    reason,
    description,
    gameCode: gameCode?.trim() || undefined,
  });

  // Instant and automatic, independent of whether the report holds up —
  // see User.withdrawalBlocked. An admin clears it after review.
  await User.updateOne({ _id: reportedUser._id }, { $set: { withdrawalBlocked: true } });

  return report;
}
