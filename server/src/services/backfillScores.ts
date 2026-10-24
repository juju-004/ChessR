/**
 * TEMPORARY, safe to delete.
 *
 * Rebuilds each player's `scores` strip (the last 15 game scores shown in the
 * standings) from the pairings already stored on every arena / swiss /
 * round-robin tournament, so tournaments played before the strip existed
 * show it too. Idempotent: a player is only written when the rebuilt strip
 * differs from what's stored, so after the first boot it does nothing.
 *
 * To remove: delete this file and the backfillScores() call in index.ts.
 */
import { Tournament } from "../models/Tournament.js";

const KEEP = 15;

export async function backfillScores(): Promise<number> {
  let updated = 0;
  const cursor = Tournament.find({
    format: { $in: ["arena", "swiss", "round_robin"] },
    status: { $in: ["active", "finished"] },
  })
    .select("format rounds players.user players.scores")
    .lean()
    .cursor();

  for await (const t of cursor) {
    const derived = new Map<string, string[]>();
    const rounds = [...(t.rounds ?? [])].sort((a, b) => a.index - b.index);
    for (const round of rounds) {
      const pairings = [...(round.pairings ?? [])].sort((a, b) => a.index - b.index);
      for (const pr of pairings) {
        // Byes and unfinished games never put a score on the strip.
        if (pr.status !== "finished" || !pr.player2 || !pr.result) continue;
        const sides = [
          { id: String(pr.player1), pts: pr.pointsAwarded?.p1 ?? 0 },
          { id: String(pr.player2), pts: pr.pointsAwarded?.p2 ?? 0 },
        ];
        for (const { id, pts } of sides) {
          // Arena: a streak score is a win worth 4/5 or a draw worth 2, a
          // berserk bonus makes a win odd (3/5). Same rules the live
          // scoring uses.
          let flags = "";
          if (t.format === "arena") {
            const draw = pr.result === "draw";
            if (draw ? pts === 2 : pts >= 4) flags += "s";
            if (!draw && (pts === 3 || pts === 5)) flags += "b";
          }
          const list = derived.get(id) ?? [];
          list.push(`${pts}${flags}`);
          derived.set(id, list);
        }
      }
    }

    for (const pl of t.players ?? []) {
      const next = (derived.get(String(pl.user)) ?? []).slice(-KEEP);
      const cur = pl.scores ?? [];
      if (next.length === 0 || next.join(",") === cur.join(",")) continue;
      await Tournament.updateOne(
        { _id: t._id },
        { $set: { "players.$[p].scores": next } },
        { arrayFilters: [{ "p.user": pl.user }] },
      );
      updated++;
    }
  }
  return updated;
}
