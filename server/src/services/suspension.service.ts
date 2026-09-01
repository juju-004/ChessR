import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

/** Throws a 403 if this user currently has an active play/chat
 *  restriction (User.suspendedUntil), see
 *  admin.controller.ts's checkReportAbuseSuspension for how that gets
 *  set. Deliberately narrow: this only guards *starting* something new
 *  (a challenge, a cage match, a tournament, sending a chat message) —
 *  it does NOT block signing in, browsing, or withdrawing/depositing
 *  tokens, and it does not touch any session/token. A restricted user can
 *  still open the app and see exactly why (the countdown on Dashboard
 *  reads suspendedUntil straight off their own user object, see
 *  userFields() in auth.controller.ts), they just can't start playing or
 *  talking to anyone until it lifts.
 *
 *  Called at each specific action that needs it (challenge send/accept,
 *  cage match send/accept, tournament create/join, chat send) rather than
 *  from a central request-level middleware, since unlike the old
 *  all-or-nothing lockout this restriction is scoped to particular
 *  actions, not the whole authenticated surface. */
export async function assertNotRestricted(userId: string): Promise<void> {
  const user = await User.findById(userId).select('suspendedUntil').lean();
  if (user?.suspendedUntil && user.suspendedUntil.getTime() > Date.now()) {
    throw ApiError.forbidden(
      `You're temporarily restricted from playing and chatting until ${user.suspendedUntil.toLocaleString()}.`,
    );
  }
}

