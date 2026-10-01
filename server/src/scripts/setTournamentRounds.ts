/**
 * Manually changes the number of rounds of a tournament.
 *
 * Usage (from /server):
 *   npx tsx src/scripts/setTournamentRounds.ts <code-or-id> <rounds>            # dry run
 *   npx tsx src/scripts/setTournamentRounds.ts <code-or-id> <rounds> --apply    # do it
 *
 * Example:
 *   npx tsx src/scripts/setTournamentRounds.ts K7P2QX 9 --apply
 *
 * What it can change:
 *   - swiss: sets swissRounds. Works while the tournament is pending OR
 *     already running. The server reads swissRounds fresh every time a
 *     round ends (see advanceAfterRound), so the new total simply takes
 *     effect at the next round boundary, no restart needed. You can raise
 *     it (more rounds get built after the current one) or lower it (the
 *     event finishes after the round you set), but never below the number
 *     of rounds that have already been built, those can't be un-played.
 *   - round_robin: sets robinRounds (how many times everyone plays
 *     everyone). Only while the tournament is still pending, because the
 *     whole schedule is built the moment it starts.
 *
 * What it refuses:
 *   - finished / cancelled tournaments (prizes are already paid out)
 *   - knockout (round count is decided by the number of players) and arena
 *     (it's time-based, not round-based)
 *
 * The create form limits swiss to 3-15 rounds; this script allows 1-50 so
 * you're not boxed in, but pick something sensible for your player count.
 * Players already on the tournament page will see the new round count the
 * next time the page refreshes (this script runs outside the server, so
 * it can't push a live update).
 */
import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../config/db.js";
import { Tournament } from "../models/Tournament.js";

const APPLY = process.argv.includes("--apply");
const MAX_ROUNDS = 50;

function fail(message: string): never {
  console.error(`\nERROR: ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const [ident, roundsArg] = positional;
  if (!ident || !roundsArg) {
    fail(
      "Usage: npx tsx src/scripts/setTournamentRounds.ts <code-or-id> <rounds> [--apply]",
    );
  }
  const rounds = Number(roundsArg);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
    fail(`<rounds> must be a whole number between 1 and ${MAX_ROUNDS}`);
  }

  await connectMongo();
  console.log(`\nDatabase: ${mongoose.connection.name}`);
  console.log(
    APPLY ? "Mode: APPLY\n" : "Mode: dry run (add --apply to change anything)\n",
  );

  const query = mongoose.isValidObjectId(ident)
    ? { $or: [{ code: ident.toUpperCase() }, { _id: ident }] }
    : { code: ident.toUpperCase() };
  const tournament = await Tournament.findOne(query);
  if (!tournament) fail(`No tournament found for "${ident}"`);

  const built = tournament.rounds.length;
  console.log(`Tournament: ${tournament.name} (${tournament.code})`);
  console.log(`Format:     ${tournament.format}`);
  console.log(`Status:     ${tournament.status}`);
  console.log(`Rounds built so far: ${built}`);

  if (tournament.status === "finished" || tournament.status === "cancelled") {
    fail(`This tournament is ${tournament.status}; its rounds can't be changed.`);
  }

  if (tournament.format === "swiss") {
    const current = tournament.swissRounds ?? 0;
    console.log(`Current total rounds: ${current}`);
    console.log(`New total rounds:     ${rounds}`);
    if (rounds === current) fail("That's already the number of rounds, nothing to do.");
    if (rounds < built) {
      fail(
        `${built} rounds have already been built, so the total can't go below ${built}.`,
      );
    }
    if (rounds < 3 || rounds > 15) {
      console.log(
        "\nNote: outside the 3-15 range the create form allows. Fine, just double check it's what you want.",
      );
    }
    if (rounds === built && tournament.status === "active") {
      console.log(
        `\nNote: this makes round ${built} the last one, the tournament will finish when it ends.`,
      );
    }
    if (APPLY) {
      await Tournament.updateOne(
        { _id: tournament._id },
        { $set: { swissRounds: rounds } },
      );
      console.log(`\nDone: swissRounds ${current} -> ${rounds}`);
    }
  } else if (tournament.format === "round_robin") {
    if (tournament.status !== "pending") {
      fail(
        "A round-robin's schedule is built when it starts, so it can only be changed while pending.",
      );
    }
    const current = tournament.robinRounds ?? 1;
    console.log(`Current laps: ${current}`);
    console.log(`New laps:     ${rounds}`);
    if (rounds === current) fail("That's already the number of laps, nothing to do.");
    if (APPLY) {
      await Tournament.updateOne(
        { _id: tournament._id },
        { $set: { robinRounds: rounds } },
      );
      console.log(`\nDone: robinRounds ${current} -> ${rounds}`);
    }
  } else {
    fail(
      `"${tournament.format}" tournaments don't have an editable round count (knockout rounds follow the player count, arena is time-based).`,
    );
  }

  if (!APPLY) console.log("\nDry run only, nothing changed.");
}

main()
  .catch((err) => {
    if (process.exitCode !== 1) console.error("Failed:", err);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongo());
