import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** How many teams one person can OWN at once. Joining other people's teams
 *  is unlimited. */
export const MAX_OWNED_TEAMS = 3;
/** Server-side only, never sent to the client. */
export const MAX_TEAM_MEMBERS = 1000;

export type TeamJoinMode = 'open' | 'request';

/** 'owner' is the creator / main leader (and whoever they hand the team to).
 *  The owner always counts as a leader and can never be demoted; 'leader's
 *  can post announcements and add or remove other leaders. */
export type TeamRole = 'owner' | 'leader' | 'member';

/** Pinned announcements per team, so pins can't crowd out the latest news. */
export const MAX_PINNED_ANNOUNCEMENTS = 3;
/** How many announcements the team page ever shows (pinned included). */
export const ANNOUNCEMENTS_SHOWN = 5;

export interface ITeamMember {
  user: Types.ObjectId;
  role: TeamRole;
  joinedAt: Date;
}

export interface ITeam extends Document {
  _id: Types.ObjectId;
  name: string;
  nameLower: string;
  description: string;
  owner: Types.ObjectId;
  members: ITeamMember[];
  /** 'open': anyone can join (subject to entryCode). 'request': people ask
   *  and the owner approves, unless they enter the right entryCode. */
  joinMode: TeamJoinMode;
  /** Optional shared code. Never selected by default, only the owner ever
   *  sees it (see getTeam). A correct code always lets someone straight in. */
  entryCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const teamSchema = new Schema<ITeam>(
  {
    name: { type: String, required: true, trim: true, minlength: 3, maxlength: 24 },
    // Lowercase copy so uniqueness and prefix search are case-insensitive.
    nameLower: { type: String, required: true, unique: true },
    description: { type: String, default: '', trim: true, maxlength: 160 },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    members: [
      {
        _id: false,
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: ['owner', 'leader', 'member'], default: 'member' },
        joinedAt: { type: Date, default: () => new Date() },
      },
    ],
    joinMode: { type: String, enum: ['open', 'request'], default: 'open' },
    entryCode: { type: String, default: null, select: false },
  },
  { timestamps: true },
);

// "Which teams am I in" is the hot query.
teamSchema.index({ 'members.user': 1 });

export const Team = mongoose.model<ITeam>('Team', teamSchema);
