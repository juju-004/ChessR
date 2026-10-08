import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import {
  getMyOrganization,
  requestOrganization,
  listOrganizationsForAdmin,
  reviewOrganization,
} from '../services/organization.service.js';
import { ApiError } from '../utils/ApiError.js';

const requestSchema = z.object({
  name: z.string().trim().min(2).max(40),
  whatsapp: z.string().trim().min(8).max(24),
});

export const getMine = asyncHandler(async (req: AuthedRequest, res) => {
  res.json({ organization: await getMyOrganization(req.user!.id) });
});

export const submitRequest = asyncHandler(async (req: AuthedRequest, res) => {
  const { name, whatsapp } = requestSchema.parse(req.body);
  res.status(201).json({ organization: await requestOrganization(req.user!.id, name, whatsapp) });
});

// --- Admin -------------------------------------------------------------------

const adminListSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

export const adminListOrganizations = asyncHandler(async (req, res) => {
  const { status } = adminListSchema.parse(req.query);
  res.json({ organizations: await listOrganizationsForAdmin(status) });
});

const reviewSchema = z.object({
  action: z.enum(['approve', 'reject', 'revoke']),
  note: z.string().trim().max(300).nullable().optional(),
});

export const adminReviewOrganization = asyncHandler(async (req, res) => {
  const id = z.string().length(24).parse(req.params.id);
  const body = reviewSchema.safeParse(req.body);
  if (!body.success) throw ApiError.badRequest('Invalid review');
  const organization = await reviewOrganization(id, body.data.action, {
    note: body.data.note,
  });
  res.json({ organization });
});
