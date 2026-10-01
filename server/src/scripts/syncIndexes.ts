/**
 * Brings the database's indexes in line with the schemas in src/models.
 *
 * Why this exists: Mongoose only ever CREATES indexes on startup. Taking
 * `index: true` off a field (or removing a schema.index() call) leaves the
 * old index sitting in the database, still costing write work, forever. This
 * drops indexes the schemas no longer declare and builds any that are missing.
 *
 * Usage (from /server):
 *   npx tsx src/scripts/syncIndexes.ts            # dry run: shows what would change
 *   npx tsx src/scripts/syncIndexes.ts --apply    # actually drop + create
 *
 * Safe to run against production: it never touches documents, and `_id`
 * indexes are never dropped. Building an index on a big collection takes a
 * moment, so prefer a quiet time. The new unique index on PlatformRevenue
 * (source, sourceId) will fail to build if duplicate rows already exist,
 * the script reports that instead of crashing.
 */
import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../config/db.js";
import { User } from "../models/User.js";
import { Game } from "../models/Game.js";
import { Notification } from "../models/Notification.js";
import { CageMatch } from "../models/CageMatch.js";
import { Transaction } from "../models/Transaction.js";
import { PlatformRevenue } from "../models/PlatformRevenue.js";
import { Tournament } from "../models/Tournament.js";
import { GameFlag } from "../models/GameFlag.js";
import { Report } from "../models/Report.js";
import { FriendRequest } from "../models/FriendRequest.js";

const APPLY = process.argv.includes("--apply");

const models = [
  User, Game, Notification, CageMatch, Transaction,
  PlatformRevenue, Tournament, GameFlag, Report, FriendRequest,
] as const;

async function main(): Promise<void> {
  await connectMongo();
  console.log(`\nDatabase: ${mongoose.connection.name}`);
  console.log(APPLY ? "Mode: APPLY\n" : "Mode: dry run (add --apply to change anything)\n");

  for (const model of models) {
    const name = model.modelName;
    try {
      // diffIndexes is read-only: what would be dropped / created.
      const diff = await (model as any).diffIndexes();
      const toDrop: string[] = diff.toDrop ?? [];
      const toCreate: unknown[] = diff.toCreate ?? [];
      if (toDrop.length === 0 && toCreate.length === 0) {
        console.log(`${name}: up to date`);
        continue;
      }
      console.log(`${name}:`);
      for (const d of toDrop) console.log(`  drop   ${d}`);
      for (const c of toCreate) console.log(`  create ${JSON.stringify(c)}`);

      if (APPLY) {
        await model.syncIndexes();
        console.log("  done");
      }
    } catch (err) {
      console.error(`${name}: FAILED`, (err as Error).message);
      process.exitCode = 1;
    }
  }
  console.log(APPLY ? "\nFinished." : "\nDry run only, nothing changed.");
}

main()
  .catch((err) => {
    console.error("Index sync failed:", err);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongo());
