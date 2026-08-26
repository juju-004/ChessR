// Client-side mirrors of the server's own input ceilings, these don't
// replace server validation (the server is still the source of truth and
// re-checks everything independently), they just give people instant
// feedback instead of typing past a limit and finding out only on submit.
// Keep these in sync with the matching MAX_WAGER_TOKENS constants
// server-side (game.controller.ts, cageMatch.service.ts,
// tournament.service.ts, and the three socket handler files) and with the
// username/bio limits on the User schema (server/src/models/User.ts).

/** Any single wager/stake/fee amount, game wagers, cage match wagers,
 *  tournament registration fees and prize tiers. 7 digits, i.e. up to
 *  9,999,999. */
export const MAX_WAGER_TOKENS = 9_999_999;

/** The floor for any single wager/stake/fee amount, same set as
 *  MAX_WAGER_TOKENS above (game wagers, cage match wagers, tournament
 *  registration fees). Keep in sync with the server's MIN_STAKE_TOKENS
 *  (game.controller.ts, cageMatch.service.ts, tournament.service.ts, and
 *  the socket handler files). */
export const MIN_STAKE_TOKENS = 20;

/** Matches the server's username schema (min 3, max 24, alphanumeric +
 *  underscore only), see auth.controller.ts's signupSchema and
 *  User.ts's username field. */
export const MAX_USERNAME_LENGTH = 18;

/** Profile bio, see EditProfileModal.tsx / user.controller.ts. */
export const MAX_BIO_LENGTH = 160;

/** Tournament / cage match name fields. */
export const MAX_EVENT_NAME_LENGTH = 20;
