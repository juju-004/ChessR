import mongoose, { Schema } from 'mongoose';

/**
 * Which Redis the whole cluster is using right now. One document, `_id: 'redis'`.
 *
 * Redis can't hold this itself (it is the thing being switched), and Mongo is
 * already shared by every instance, so this is how instances agree on the
 * active URL and how a rotation is coordinated. See
 * services/redisRotation.service.ts.
 *
 * URLs are never stored, only a short fingerprint of each, so credentials
 * don't end up in the database and reordering REDIS_URLS is harmless.
 */
export interface IRedisRouting {
  _id: string;
  /** Fingerprint of the Redis URL every instance should be using. */
  activeFp: string;
  activeSince: Date;
  lastSwitchAt: Date | null;
  /** Outcome of the most recent data copy, for debugging. */
  lastMigration: Record<string, unknown> | null;
  /** Set while a rotation is in progress; null otherwise. A lease: it expires
   *  by itself if the instance driving it dies. */
  pendingSwitch: {
    id: string;
    toFp: string;
    leader: string;
    startedAt: Date;
    expiresAt: Date;
  } | null;
}

const redisRoutingSchema = new Schema<IRedisRouting>(
  {
    _id: { type: String, required: true },
    activeFp: { type: String, required: true },
    activeSince: { type: Date, required: true },
    lastSwitchAt: { type: Date, default: null },
    lastMigration: { type: Schema.Types.Mixed, default: null },
    pendingSwitch: {
      type: new Schema(
        {
          id: { type: String, required: true },
          toFp: { type: String, required: true },
          leader: { type: String, required: true },
          startedAt: { type: Date, required: true },
          expiresAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { collection: 'redis_routing', versionKey: false },
);

export const ROUTING_DOC_ID = 'redis';
export const RedisRouting = mongoose.model<IRedisRouting>('RedisRouting', redisRoutingSchema);
