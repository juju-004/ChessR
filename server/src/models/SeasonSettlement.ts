import mongoose, { Schema, type Document } from 'mongoose';

// One document per season whose prizes have been paid. Its existence (unique
// `season`) is the "already settled" marker; the winners are snapshotted so
// past seasons can be shown without recomputing from games. Actual money
// movement is additionally guarded per-prize by unique Transaction references
// (see creditSeasonReward), so a crash mid-settlement is safely re-runnable.
export type SeasonBoard = 'games' | 'points';

export interface ISeasonWinner {
  board: SeasonBoard;
  rank: number;
  user: mongoose.Types.ObjectId;
  username: string;
  avatarGradient: string | null;
  value: number;
  prize: number;
}

export interface ISeasonSettlement extends Document {
  season: number;
  startsAt: Date;
  endsAt: Date;
  winners: ISeasonWinner[];
  settledAt: Date;
}

const winnerSchema = new Schema<ISeasonWinner>(
  {
    board: { type: String, enum: ['games', 'points'], required: true },
    rank: { type: Number, required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    avatarGradient: { type: String, default: null },
    value: { type: Number, required: true },
    prize: { type: Number, required: true },
  },
  { _id: false },
);

const seasonSettlementSchema = new Schema<ISeasonSettlement>({
  season: { type: Number, required: true, unique: true },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  winners: { type: [winnerSchema], default: [] },
  settledAt: { type: Date, default: Date.now },
});

export const SeasonSettlement = mongoose.model<ISeasonSettlement>('SeasonSettlement', seasonSettlementSchema);
