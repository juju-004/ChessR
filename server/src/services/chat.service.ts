import { nanoid } from 'nanoid';
import { redis } from '../config/redis.js';

// A single, generic Redis-backed chat log reused for three different
// "surfaces" that all want the same shape (spectator-only, ephemeral-ish,
// chronological, capped) but different lifetimes:
//
//  - 'game'      one standalone (non-cage) game. Key'd by gameId. Deleted
//                10 minutes after that game finishes (see expireChat calls
//                in game.service.ts's finalizeGame).
//  - 'cage'      one cage match, spans every leg of it. Key'd by
//                cageMatchId, NOT by the individual leg gameIds, so the log
//                survives a leg ending and the next one starting. Deleted
//                10 minutes after the whole match finishes (see
//                cageMatch.service.ts).
//  - 'tournament' one tournament. Key'd by tournamentId, only ever written
//                to when the tournament has chat enabled (see
//                Tournament.chatEnabled). Deleted 10 minutes after the
//                tournament finishes or is cancelled (see
//                tournament.service.ts).
//
// Storage is a capped Redis list (most recent MAX_MESSAGES kept), values are
// JSON-encoded ChatMessage objects, oldest first. No TTL is set while the
// underlying game/match/tournament is still going, i.e. the log survives
// indefinitely until whatever's driving it wraps up. expireChat below is
// what puts the 10-minute clock on it, callers are responsible for calling
// it exactly once, right when that happens.
export type ChatScope = 'game' | 'cage' | 'tournament';

const MAX_MESSAGES = 200;
const POST_COMPLETION_TTL_SECONDS = 10 * 60;
// Safety-net TTL applied to every chat key the first time it's touched, so
// a log for something that's abandoned mid-flight (a game that never
// formally resolves, a tournament that gets stuck) doesn't sit in Redis
// forever. Refreshed on every write; harmless once expireChat overwrites it
// with the real, much shorter post-completion TTL.
const SAFETY_TTL_SECONDS = 24 * 60 * 60;

export interface ChatMessageInput {
  username: string;
  avatarGradient?: string | null;
  message: string;
  replyTo?: { id: string; username: string; message: string } | null;
}

export interface ChatMessage extends ChatMessageInput {
  id: string;
  at: number;
}

function keyFor(scope: ChatScope, id: string): string {
  return `chat:${scope}:${id}`;
}

export async function addChatMessage(
  scope: ChatScope,
  id: string,
  input: ChatMessageInput,
): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: nanoid(10),
    at: Date.now(),
    ...input,
  };
  const key = keyFor(scope, id);
  await redis
    .multi()
    .rpush(key, JSON.stringify(message))
    .ltrim(key, -MAX_MESSAGES, -1)
    .expire(key, SAFETY_TTL_SECONDS)
    .exec();
  return message;
}

export async function getChatHistory(scope: ChatScope, id: string): Promise<ChatMessage[]> {
  const raw = await redis.lrange(keyFor(scope, id), 0, -1);
  return raw
    .map((entry) => {
      try {
        return JSON.parse(entry) as ChatMessage;
      } catch {
        return null;
      }
    })
    .filter((m): m is ChatMessage => m !== null);
}

// Called exactly once, right when the thing this chat log is attached to
// (a game, a cage match, a tournament) finishes, so the log sticks around
// long enough for stragglers to read the last few messages but doesn't
// live forever.
export async function expireChat(scope: ChatScope, id: string, seconds = POST_COMPLETION_TTL_SECONDS): Promise<void> {
  await redis.expire(keyFor(scope, id), seconds);
}

// --- Spam prevention ---------------------------------------------------------
// Keyed by userId (not socket.id or scope), and backed by Redis rather than
// an in-process Map, because this deployment runs multiple server instances
// behind a Socket.IO Redis adapter (see sockets/index.ts): a per-process
// limiter would just reset the moment a reconnect happened to land on a
// different instance. Global across every chat surface a user can post to
// (game/cage spectator chat, tournament chat) rather than per-scope, so
// someone can't dodge the cap by spreading messages across several tabs.
const RATE_LIMIT_WINDOW_SECONDS = 10;
const RATE_LIMIT_MAX_MESSAGES = 3;
// How long a message has to sit unrepeated before the same user can send
// the exact same text again, catches the "spam one phrase over and over"
// pattern specifically, which the message-count limiter above alone would
// still allow (spread out at just under one every ~1.7s, it'd never trip).
const REPEAT_COOLDOWN_SECONDS = 15;

/** True if this user should be blocked from sending another chat message
 *  right now. Cheap fixed-window counter (INCR + EXPIRE-once), not a
 *  sliding window, a determined spammer could in principle send a burst
 *  right at a window boundary, but for chat (as opposed to, say, a login
 *  endpoint) that's not worth the extra complexity, worst case they get a
 *  couple extra messages through right at the edge, still throttled well
 *  below anything disruptive. */
export async function isChatRateLimited(userId: string): Promise<boolean> {
  const key = `chat:ratelimit:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  }
  return count > RATE_LIMIT_MAX_MESSAGES;
}

/** True if this exact message text is a same-user repeat within the
 *  cooldown window. Records the new text either way (a rejected repeat
 *  still refreshes the cooldown, so machine-gunning the same line doesn't
 *  get cheaper the more times it's sent). */
export async function isRepeatMessage(userId: string, message: string): Promise<boolean> {
  const key = `chat:lastmsg:${userId}`;
  const last = await redis.get(key);
  await redis.set(key, message, 'EX', REPEAT_COOLDOWN_SECONDS);
  return last === message;
}
