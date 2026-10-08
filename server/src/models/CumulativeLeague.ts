import mongoose, { Schema, type Document, type Types } from "mongoose";

// A "cumulative" is a league phase made of up to MAX_CUMULATIVE_TOURNAMENTS
// ordinary tournaments played one after another. Each tournament keeps its
// own standings exactly as before; the league's standings are never stored,
// they're computed on read by summing every started tournament's points (see
// cumulative.service.ts), so there's nothing to keep in sync when a
// tournament's scoring changes.
//
// `tournaments` is the ORDER of the league (index 0 = tournament 1) and also
// doubles as the slot reservation that enforces the hard cap: a tournament is
// pushed here atomically BEFORE it's created (see reserveCumulativeSlot), and
// pulled back out if it's cancelled or its creation fails.

// Ceiling on what a league's creator may choose as its tournament limit, and
// the limit assumed for leagues created before the creator could choose one.
export const MAX_CUMULATIVE_TOURNAMENTS = 10;
export const MIN_CUMULATIVE_TOURNAMENTS = 2;

export interface ICumulativeLeague extends Document {
  _id: Types.ObjectId;
  name: string;
  description: string | null;
  createdBy: Types.ObjectId;
  // Only an approved organisation can create a cumulative; name snapshotted
  // for list cards, same denormalisation Tournament.organizationName uses.
  organization: Types.ObjectId;
  organizationName: string;
  tournaments: Types.ObjectId[];
  // How many tournaments this league may hold, chosen by its creator at
  // creation (MIN..MAX_CUMULATIVE_TOURNAMENTS). Immutable.
  maxTournaments: number;
  createdAt: Date;
}

const cumulativeLeagueSchema = new Schema<ICumulativeLeague>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, default: null, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organization: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    organizationName: { type: String, required: true },
    tournaments: { type: [Schema.Types.ObjectId], ref: "Tournament", default: [] },
    maxTournaments: {
      type: Number,
      default: MAX_CUMULATIVE_TOURNAMENTS,
      min: MIN_CUMULATIVE_TOURNAMENTS,
      max: MAX_CUMULATIVE_TOURNAMENTS,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

cumulativeLeagueSchema.index({ createdAt: -1 });

export const CumulativeLeague = mongoose.model<ICumulativeLeague>(
  "CumulativeLeague",
  cumulativeLeagueSchema,
);
