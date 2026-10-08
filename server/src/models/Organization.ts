import mongoose, { Schema, type Document, type Types } from 'mongoose';

// An "organisation" is a verified account that is allowed to run team battle
// tournaments. A user files a request (name + WhatsApp number), an admin
// reviews it from the admin console, and once APPROVED the organisation gets
// a fixed organisation badge (same icon and colour for every organisation)
// that is shown on its owner's profile.
//
// One organisation per user: the owner's User _id is unique here. A rejected
// request can be re-filed, which simply overwrites the old doc (see
// organization.service.ts's requestOrganization).

export type OrganizationStatus = 'pending' | 'approved' | 'rejected';

export interface IOrganization extends Document {
  _id: Types.ObjectId;
  owner: Types.ObjectId;
  name: string;
  nameLower: string;
  /** WhatsApp number in international format, digits only with a leading +. */
  whatsapp: string;
  status: OrganizationStatus;
  /** Shown to the requester when status === 'rejected'. */
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const organizationSchema = new Schema<IOrganization>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 },
    nameLower: { type: String, required: true, index: true },
    whatsapp: { type: String, required: true, trim: true, maxlength: 20 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    reviewNote: { type: String, default: null, maxlength: 300 },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Organization = mongoose.model<IOrganization>('Organization', organizationSchema);
