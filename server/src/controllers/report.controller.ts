import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createReport } from '../services/report.service.js';
import type { AuthedRequest } from '../middleware/auth.js';

const createReportSchema = z.object({
  reportedUsername: z.string().trim().min(1).max(24),
  reason: z.enum(['cheating', 'harassment', 'sandbagging', 'payment_dispute', 'other']),
  description: z.string().trim().min(10, 'Please give a few more details').max(2000),
  gameCode: z.string().trim().max(20).optional(),
});

export const submitReport = asyncHandler(async (req: AuthedRequest, res) => {
  const body = createReportSchema.parse(req.body);

  const report = await createReport({
    reporterId: req.user!.id,
    reportedUsername: body.reportedUsername,
    reason: body.reason,
    description: body.description,
    gameCode: body.gameCode,
  });

  res.status(201).json({
    id: report._id,
    status: report.status,
    createdAt: report.createdAt,
  });
});
