import type { Types } from 'mongoose';
import { User } from '../models/User.js';
import { Follow } from '../models/Follow.js';

/** One-time conversion of the old mutual "friends" arrays into follows.
 *
 *  Every old friendship becomes a follow in BOTH directions (so nobody loses
 *  anyone), then `friends` is unset on the user so this has nothing left to do
 *  on later boots. It reads the raw collection because `friends` is no longer
 *  part of the User schema. Idempotent and safe to interrupt: follows are
 *  upserted, and a user's `friends` is only unset after their follows landed.
 *
 *  Once every environment has booted this once, this file and its call in
 *  index.ts can be deleted. */
export async function migrateFriendsToFollows(): Promise<void> {
  const users = User.collection;
  const cursor = users.find(
    { friends: { $exists: true } },
    { projection: { friends: 1 } },
  );

  let usersDone = 0;
  let followsMade = 0;
  let batch: Array<{ _id: Types.ObjectId; friends?: Types.ObjectId[] }> = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const ops = batch.flatMap((u) =>
      (u.friends ?? []).flatMap((friendId) => [
        {
          updateOne: {
            filter: { follower: u._id, following: friendId },
            update: { $setOnInsert: { follower: u._id, following: friendId } },
            upsert: true,
          },
        },
        {
          updateOne: {
            filter: { follower: friendId, following: u._id },
            update: { $setOnInsert: { follower: friendId, following: u._id } },
            upsert: true,
          },
        },
      ]),
    );
    if (ops.length > 0) {
      const res = await Follow.bulkWrite(ops as any, { ordered: false });
      followsMade += res.upsertedCount;
    }
    await users.updateMany(
      { _id: { $in: batch.map((u) => u._id) } },
      { $unset: { friends: '' } },
    );
    usersDone += batch.length;
    batch = [];
  };

  for await (const doc of cursor) {
    batch.push(doc as any);
    if (batch.length >= 200) await flush();
  }
  await flush();

  if (usersDone > 0) {
    console.log(`friends -> follows: migrated ${usersDone} users, created ${followsMade} follows`);
  }
}
