/**
 * ONE-TIME platform reset. Destructive and irreversible.
 *
 * What it does
 *   Users (kept, only these fields change):
 *     - tokenBalance    -> 0
 *     - rating          -> schema default (1500)
 *     - ratedGamesPlayed-> 0
 *   Deleted entirely:
 *     - games, notifications, cage matches, transactions, platform revenue
 *   Redis: live game / cage / challenge keys are cleared too, otherwise the
 *   server could keep serving "live" state for games that no longer exist.
 *
 * Opt-in extras (NOT done by default):
 *   --with-tournaments   also delete tournaments. Tournament pairings point
 *                        at game ids, so after a reset they would reference
 *                        games that no longer exist.
 *   --with-game-flags    also delete anti-cheat game flags (same reason).
 *
 * Usage (run from /server, STOP the API server first, then restart it after):
 *   npx tsx src/scripts/resetPlatform.ts                 # dry run, counts only
 *   npx tsx src/scripts/resetPlatform.ts --confirm       # real run
 *   npx tsx src/scripts/resetPlatform.ts --confirm --with-tournaments --with-game-flags
 *
 * A real run also makes you type the database name before anything is
 * deleted. It is safe to re-run: every step is idempotent.
 *
 * TAKE A BACKUP FIRST (mongodump, or an Atlas snapshot). There is no undo.
 */
import readline from "node:readline/promises";
import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../config/db.js";
import { redis, disconnectRedis } from "../config/redis.js";
import { User } from "../models/User.js";
import { Game } from "../models/Game.js";
import { Notification } from "../models/Notification.js";
import { CageMatch } from "../models/CageMatch.js";
import { Transaction } from "../models/Transaction.js";
import { PlatformRevenue } from "../models/PlatformRevenue.js";
import { Tournament } from "../models/Tournament.js";
import { GameFlag } from "../models/GameFlag.js";

const args = new Set(process.argv.slice(2));
const CONFIRM = args.has("--confirm");
const WITH_TOURNAMENTS = args.has("--with-tournaments");
const WITH_GAME_FLAGS = args.has("--with-game-flags");

// Redis patterns tied to games that are about to stop existing. Presence
// (`presence:*`), chat rate limits and the quick-pairing queue are
// deliberately left alone, they belong to connected sockets, not to data
// being wiped.
const REDIS_PATTERNS = [
  "game:*",
  "cageInvite:*",
  "cageLinkInvite:*",
  "cagePauseReq:*",
  "cageResumeReq:*",
  "challenge:*",
];

async function countRedisKeys(pattern: string): Promise<number> {
  let n = 0;
  for await (const keys of redis.scanStream({ match: pattern, count: 200 })) {
    n += (keys as string[]).length;
  }
  return n;
}

async function deleteRedisKeys(pattern: string): Promise<number> {
  let n = 0;
  for await (const keys of redis.scanStream({ match: pattern, count: 200 })) {
    const batch = keys as string[];
    if (batch.length) {
      await redis.del(...batch);
      n += batch.length;
    }
  }
  return n;
}

async function main(): Promise<void> {
  await connectMongo();
  const dbName = mongoose.connection.name;

  // Defaults come from the schema so this can't drift from User.ts.
  const defaultRating = User.schema.path("rating").options.default as number;

  const counts = {
    users: await User.countDocuments(),
    games: await Game.countDocuments(),
    notifications: await Notification.countDocuments(),
    cageMatches: await CageMatch.countDocuments(),
    transactions: await Transaction.countDocuments(),
    platformRevenue: await PlatformRevenue.countDocuments(),
    tournaments: WITH_TOURNAMENTS ? await Tournament.countDocuments() : 0,
    gameFlags: WITH_GAME_FLAGS ? await GameFlag.countDocuments() : 0,
  };
  const redisCounts: Record<string, number> = {};
  for (const p of REDIS_PATTERNS) redisCounts[p] = await countRedisKeys(p);

  console.log(`\nDatabase: ${dbName}`);
  console.log(
    `Users to reset (tokens -> 0, rating -> ${defaultRating}, ratedGamesPlayed -> 0): ${counts.users}`,
  );
  console.log("Will DELETE:");
  console.log(`  games:            ${counts.games}`);
  console.log(`  notifications:    ${counts.notifications}`);
  console.log(`  cage matches:     ${counts.cageMatches}`);
  console.log(`  transactions:     ${counts.transactions}`);
  console.log(`  platform revenue: ${counts.platformRevenue}`);
  if (WITH_TOURNAMENTS) console.log(`  tournaments:      ${counts.tournaments}`);
  if (WITH_GAME_FLAGS) console.log(`  game flags:       ${counts.gameFlags}`);
  console.log("Redis keys to clear:");
  for (const p of REDIS_PATTERNS) console.log(`  ${p.padEnd(18)} ${redisCounts[p]}`);

  if (!CONFIRM) {
    console.log("\nDry run only, nothing changed. Re-run with --confirm to apply.");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const typed = await rl.question(
    `\nThis cannot be undone. Type the database name ("${dbName}") to continue: `,
  );
  rl.close();
  if (typed.trim() !== dbName) {
    console.log("Name didn't match, aborting. Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  // Order: data that references games goes first, users last. Each step is
  // independent and idempotent, so a crash part-way is fixed by re-running.
  const tx = await Transaction.deleteMany({});
  const rev = await PlatformRevenue.deleteMany({});
  const cage = await CageMatch.deleteMany({});
  const games = await Game.deleteMany({});
  const notes = await Notification.deleteMany({});
  const trn = WITH_TOURNAMENTS ? await Tournament.deleteMany({}) : null;
  const flags = WITH_GAME_FLAGS ? await GameFlag.deleteMany({}) : null;

  const users = await User.updateMany(
    {},
    { $set: { tokenBalance: 0, rating: defaultRating, ratedGamesPlayed: 0 } },
  );

  let redisDeleted = 0;
  for (const p of REDIS_PATTERNS) redisDeleted += await deleteRedisKeys(p);

  console.log("\nDone.");
  console.log(`  users reset:              ${users.modifiedCount} (matched ${users.matchedCount})`);
  console.log(`  games deleted:            ${games.deletedCount}`);
  console.log(`  notifications deleted:    ${notes.deletedCount}`);
  console.log(`  cage matches deleted:     ${cage.deletedCount}`);
  console.log(`  transactions deleted:     ${tx.deletedCount}`);
  console.log(`  platform revenue deleted: ${rev.deletedCount}`);
  if (trn) console.log(`  tournaments deleted:      ${trn.deletedCount}`);
  if (flags) console.log(`  game flags deleted:       ${flags.deletedCount}`);
  console.log(`  redis keys deleted:       ${redisDeleted}`);
}

main()
  .catch((err) => {
    console.error("Reset failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([disconnectMongo(), disconnectRedis()]);
  });
