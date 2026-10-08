import mongoose from 'mongoose';
import { Organization, type IOrganization } from '../models/Organization.js';
import { ApiError } from '../utils/ApiError.js';
import { createNotification } from './notification.service.js';

/** Normalises a WhatsApp number to "+<digits>" (8-15 digits, E.164 range). */
export function normalizeWhatsapp(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 8 || digits.length > 15) {
    throw ApiError.badRequest('Enter a valid WhatsApp number including the country code, e.g. +2348012345678');
  }
  return `+${digits}`;
}

export function serializeOrganization(o: IOrganization | (Record<string, any> & { _id: any })) {
  return {
    id: o._id.toString(),
    name: o.name,
    whatsapp: o.whatsapp,
    status: o.status as 'pending' | 'approved' | 'rejected',
    reviewNote: (o.reviewNote as string | null) ?? null,
    createdAt: o.createdAt,
    reviewedAt: o.reviewedAt ?? null,
  };
}

export async function getMyOrganization(userId: string) {
  const org = await Organization.findOne({ owner: userId }).lean();
  return org ? serializeOrganization(org) : null;
}

/** Whether this user owns an APPROVED organisation. The single gate behind
 *  creating team battle tournaments. Returns the org doc (lean) or null. */
export async function getApprovedOrganization(userId: string) {
  return Organization.findOne({ owner: userId, status: 'approved' }).lean();
}

export async function requestOrganization(userId: string, nameInput: string, whatsappInput: string) {
  const name = nameInput.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 40) {
    throw ApiError.badRequest('Organisation name must be between 2 and 40 characters');
  }
  const whatsapp = normalizeWhatsapp(whatsappInput);
  const nameLower = name.toLowerCase();

  const existing = await Organization.findOne({ owner: userId });
  if (existing && existing.status !== 'rejected') {
    throw ApiError.conflict(
      existing.status === 'approved'
        ? 'You already have an approved organisation'
        : 'You already have a request waiting for review',
    );
  }

  // Names are unique among organisations that are live or waiting, a
  // rejected request doesn't hold its name hostage.
  const taken = await Organization.exists({
    nameLower,
    status: { $in: ['pending', 'approved'] },
    owner: { $ne: new mongoose.Types.ObjectId(userId) },
  });
  if (taken) throw ApiError.conflict('That organisation name is already taken');

  if (existing) {
    existing.name = name;
    existing.nameLower = nameLower;
    existing.whatsapp = whatsapp;
    existing.status = 'pending';
    existing.reviewNote = null;
    existing.reviewedAt = null;
    await existing.save();
    return serializeOrganization(existing);
  }
  const org = await Organization.create({ owner: userId, name, nameLower, whatsapp });
  return serializeOrganization(org);
}

/** The approved organisation name for a user, for their public profile. */
export async function getApprovedOrganizationName(userId: unknown): Promise<string | null> {
  const org = await Organization.findOne({ owner: userId as any, status: 'approved' }).select('name').lean();
  return org?.name ?? null;
}

// --- Admin -------------------------------------------------------------------

export async function listOrganizationsForAdmin(status?: 'pending' | 'approved' | 'rejected') {
  const orgs = await Organization.find(status ? { status } : {})
    .sort({ createdAt: -1 })
    .limit(200)
    .populate('owner', 'username email')
    .lean();
  return orgs.map((o: any) => ({
    ...serializeOrganization(o),
    owner: o.owner ? { id: o.owner._id.toString(), username: o.owner.username as string } : null,
  }));
}

export type OrganizationReviewAction = 'approve' | 'reject' | 'revoke';

export async function reviewOrganization(
  id: string,
  action: OrganizationReviewAction,
  opts: { note?: string | null } = {},
) {
  const org = await Organization.findById(id);
  if (!org) throw ApiError.notFound('Organisation not found');

  if (action === 'approve') {
    if (org.status === 'approved') throw ApiError.conflict('Already approved');
    org.status = 'approved';
    org.reviewNote = null;
  } else if (action === 'reject') {
    if (org.status === 'approved') throw ApiError.conflict('Revoke an approved organisation instead');
    org.status = 'rejected';
    org.reviewNote = opts.note?.trim().slice(0, 300) || 'Your request was not approved.';
  } else {
    if (org.status !== 'approved') throw ApiError.conflict('Only approved organisations can be revoked');
    org.status = 'rejected';
    org.reviewNote = opts.note?.trim().slice(0, 300) || 'Your organisation status was revoked.';
  }
  org.reviewedAt = new Date();
  await org.save();

  const ownerId = org.owner.toString();
  const message =
    action === 'approve'
      ? { title: 'Organisation approved', body: `${org.name} is now a verified organisation. The organisation badge now shows on your profile and you can create team battles from the new tournament page.`, link: '/tournaments' }
      : { title: action === 'revoke' ? 'Organisation revoked' : 'Organisation request declined', body: org.reviewNote ?? '', link: '/organization/request' };
  await createNotification({ recipientId: ownerId, type: 'admin_message', ...message }).catch((err) =>
    console.error('organisation notification failed:', err),
  );

  return serializeOrganization(org);
}
