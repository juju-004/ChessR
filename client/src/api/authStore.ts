export interface CurrentUser {
  id: string;
  username: string;
  email: string;
  avatarGradient?: string | null;
  /** null = "Unranked" (fewer than ratedGamesUntilRanked more rated games
   *  played). See rating.service.ts on the server, this is a tier name,
   *  never the hidden underlying number. */
  ratingCategory?: string | null;
  ratedGamesUntilRanked?: number;
  /** Whether `email` has been confirmed yet, see the "verify your email"
   *  banner in App.tsx and the /verify-email page. Always true for a
   *  Google sign-in account. */
  emailVerified?: boolean;
}

interface AuthSnapshot {
  accessToken: string | null;
  user: CurrentUser | null;
}

let snapshot: AuthSnapshot = { accessToken: null, user: null };
const listeners = new Set<() => void>();

export function getAuthSnapshot(): AuthSnapshot {
  return snapshot;
}

export function setAuth(accessToken: string, user: CurrentUser): void {
  snapshot = { accessToken, user };
  listeners.forEach((l) => l());
}

/** Merges a partial patch into the currently signed-in user without a full
 *  re-login or token refresh, for cases like an avatar change that should
 *  reflect everywhere the user object is read from (navbar, etc.)
 *  immediately, not just after the next page reload / token refresh cycle.
 *  No-ops if nobody's signed in. */
export function updateAuthUser(patch: Partial<CurrentUser>): void {
  if (!snapshot.user) return;
  snapshot = { ...snapshot, user: { ...snapshot.user, ...patch } };
  listeners.forEach((l) => l());
}

export function clearAuth(): void {
  snapshot = { accessToken: null, user: null };
  listeners.forEach((l) => l());
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Plain (non-hook) check for "is someone signed in right now", for use
 * outside React render (e.g. a one-off redirect guard on mount) where
 * useAuth()'s reactive isAuthed isn't necessary. Inside a component that
 * needs to stay in sync with auth state over time, prefer useAuth().isAuthed
 * instead, since this doesn't itself trigger a re-render on change.
 */
export function isLoggedIn(): boolean {
  return !!snapshot.accessToken && !!snapshot.user;
}
