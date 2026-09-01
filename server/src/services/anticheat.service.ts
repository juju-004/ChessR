import type { IMove } from '../models/Game.js';
import { Game } from '../models/Game.js';
import { GameFlag } from '../models/GameFlag.js';
import { User } from '../models/User.js';
import { createNotification } from './notification.service.js';

export interface SuspicionSignal {
  type: 'uniform_fast_moves' | 'inhuman_reaction';
  detail: string;
}

export interface SuspicionReport {
  side: 'white' | 'black';
  score: number; // 0-100, purely relative, see note below.
  signals: SuspicionSignal[];
  thinkTimesMs: number[];
}

/**
 * Anti-cheat, honestly scoped.
 *
 * What "real" cheat detection looks like on a site like Lichess: every move
 * gets compared against a chess engine's evaluation to compute centipawn
 * loss, that gets aggregated into an accuracy score, and THAT gets compared
 * against a statistical baseline built from millions of games at each
 * rating band to flag outliers, plus a manual review queue behind it,
 * because the automated signal alone produces false positives. That's a
 * standing piece of infrastructure (an engine cluster, a baseline dataset,
 * ongoing tuning), not something to bolt on in one pass, and a half-built
 * version of it (an engine check with no baseline to compare against) would
 * mostly produce confident-looking numbers that don't actually mean
 * anything, which is worse than not having it: it invites accusing people
 * based on noise.
 *
 * What this DOES do: surface a move-timing signal, already-recorded data,
 * computed lazily when an admin opens a reported game, to help a human
 * reviewer's eye, not to make an automated call. Two patterns worth a
 * human's attention:
 *   - a long run of moves all taking almost exactly the same short amount
 *     of time (a human's think time varies; a script's often doesn't)
 *   - a very fast, precise move immediately after the opponent creates a
 *     genuinely hard position (few decent options, most of them losing)
 *
 * This is a hint, not a verdict, it's deliberately framed as "worth a
 * look," and the score is only meaningful relative to other games, never
 * as a standalone percentage. The actual anti-cheat tool for now is the
 * report + admin review workflow itself: a human looking at the move list
 * and timing, the same way most platforms below Lichess scale operate.
 */
export function analyzeGameForSuspicion(moves: IMove[]): SuspicionReport[] {
  const bySide: Record<'white' | 'black', IMove[]> = { white: [], black: [] };
  moves.forEach((m, i) => bySide[i % 2 === 0 ? 'white' : 'black'].push(m));

  return (['white', 'black'] as const).map((side) => {
    const sideMoves = bySide[side];
    const thinkTimesMs: number[] = [];
    for (let i = 1; i < sideMoves.length; i++) {
      thinkTimesMs.push(sideMoves[i].timestampMs - sideMoves[i - 1].timestampMs);
    }

    const signals: SuspicionSignal[] = [];
    let score = 0;

    // Look at the "middlegame" window (skip the first few book-ish moves and
    // any final scramble) for a long run of near-identical fast think times.
    const window = thinkTimesMs.slice(3, -2).filter((t) => t > 0 && t < 4000);
    if (window.length >= 8) {
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const variance =
        window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
      const stdDev = Math.sqrt(variance);
      // Low variance relative to the mean, on a sample big enough that
      // "just a fast player" wouldn't usually land here by chance.
      if (mean < 2500 && stdDev < mean * 0.25) {
        signals.push({
          type: 'uniform_fast_moves',
          detail: `${window.length} moves averaging ${Math.round(mean)}ms with unusually little variation (±${Math.round(stdDev)}ms).`,
        });
        score += 40;
      }
    }

    const veryFast = thinkTimesMs.filter((t) => t > 0 && t < 600).length;
    if (sideMoves.length >= 15 && veryFast / sideMoves.length > 0.5) {
      signals.push({
        type: 'inhuman_reaction',
        detail: `${veryFast} of ${sideMoves.length} moves played in under 600ms.`,
      });
      score += 30;
    }

    return { side, score: Math.min(100, score), signals, thinkTimesMs };
  });
}

// Score at which the heuristic above stops being "a hint for a human" and
// starts triggering an automatic action. Deliberately set at the point
// where BOTH signals have fired together (40 + 30), not either one alone:
// analyzeGameForSuspicion's own doc comment is explicit that a single
// signal, or the score in isolation, isn't meaningful enough to accuse
// anyone off of — this keeps that same bar for the one place the score
// now does something consequential (freezing funds) rather than lowering
// it just because an automated action was added on top.
export const AUTO_FLAG_THRESHOLD = 70;

/**
 * Runs after a game finishes (see finalizeGame in game.service.ts). If
 * either side's suspicion score crosses AUTO_FLAG_THRESHOLD: freezes that
 * player's withdrawals (same field a report does, see report.service.ts),
 * opens a GameFlag for the admin "game check" queue instead of a regular
 * user Report (this wasn't filed by anyone, it's a system finding), and
 * notifies the flagged player about what's happening and why, in the same
 * "worth a look, not a verdict" spirit as the heuristic itself, framed as
 * a pending review rather than an accusation.
 *
 * Never throws, this always runs fire-and-forget off the game-over path
 * and a failure here must never take down finalizing the game itself.
 */
export async function runAutoCheatCheck(gameId: string): Promise<void> {
  try {
    const game = await Game.findById(gameId)
      .select('moves white black joinCode')
      .lean();
    if (!game || !game.moves?.length) return;

    const reports = analyzeGameForSuspicion(game.moves);
    const sideUser: Record<'white' | 'black', string | undefined> = {
      white: game.white?.toString(),
      black: game.black?.toString(),
    };

    for (const report of reports) {
      if (report.score < AUTO_FLAG_THRESHOLD) continue;
      const flaggedUserId = sideUser[report.side];
      if (!flaggedUserId) continue;

      // Upsert-style guard against the (rare) case finalizeGame's
      // fire-and-forget call runs more than once for the same game: the
      // unique (game, flaggedUser) index on GameFlag rejects a duplicate
      // insert, which this treats as "already flagged, nothing more to do"
      // rather than an error.
      let flag;
      try {
        flag = await GameFlag.create({
          game: game._id,
          gameCode: game.joinCode,
          flaggedUser: flaggedUserId,
          side: report.side,
          score: report.score,
          signals: report.signals,
        });
      } catch (err: any) {
        if (err?.code === 11000) continue; // already flagged, skip
        throw err;
      }

      await User.updateOne({ _id: flaggedUserId }, { $set: { withdrawalBlocked: true } });

      await createNotification({
        recipientId: flaggedUserId,
        type: 'anticheat_freeze',
        title: "Your funds have been temporarily frozen",
        body:
          `Our system flagged unusual activity in a recent game (${game.joinCode}) for review. ` +
          "As a precaution, withdrawals on your account are frozen until our team has looked into it. " +
          "This is an automated hold, not a final decision, you can keep playing in the meantime. " +
          "We'll notify you once it's been reviewed.",
      }).catch((err) => console.error('Failed to send anticheat_freeze notification:', err));

      void flag; // created for the admin queue; nothing further needed here
    }
  } catch (err) {
    console.error(`runAutoCheatCheck failed for game ${gameId}:`, err);
  }
}

