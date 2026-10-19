import mongoose, { Schema, type Document, type Types } from 'mongoose';

/**
 * A single tactics puzzle, in the same shape as the Lichess puzzle database
 * (https://database.lichess.org/#puzzles) so a real dump can be imported with
 * scripts/importPuzzles.ts.
 *
 *  - `fen` is the position BEFORE the opponent's move.
 *  - `moves[0]` is that opponent move (auto-played when the puzzle is shown),
 *    then the solver's move, the opponent's reply, the solver's move, ... in
 *    UCI. The line always ends on the solver's move.
 *
 * `moves` is the answer key: it is only ever read server-side and is never
 * sent to a client (see puzzleRace.service.ts).
 */
export interface IPuzzle extends Document {
  _id: Types.ObjectId;
  puzzleId: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
  popularity?: number;
  nbPlays?: number;
}

const puzzleSchema = new Schema<IPuzzle>(
  {
    puzzleId: { type: String, required: true, unique: true },
    fen: { type: String, required: true },
    moves: { type: [String], required: true },
    rating: { type: Number, required: true },
    themes: { type: [String], default: [] },
    popularity: { type: Number },
    nbPlays: { type: Number },
  },
  { timestamps: true },
);

// Races sample puzzles by rating band.
puzzleSchema.index({ rating: 1 });

export const Puzzle = mongoose.model<IPuzzle>('Puzzle', puzzleSchema);
