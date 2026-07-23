export interface CurrentUser {
  id: string;
  username: string;
  email: string;
  rating: number;
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

export function clearAuth(): void {
  snapshot = { accessToken: null, user: null };
  listeners.forEach((l) => l());
}

/** Patches just the rating on the cached user — used after a game ends so the
 *  navbar/dashboard reflect the new rating immediately instead of showing a
 *  stale number until the next sign-in or token refresh. */
export function updateCachedRating(newRating: number): void {
  if (!snapshot.user) return;
  snapshot = { ...snapshot, user: { ...snapshot.user, rating: newRating } };
  listeners.forEach((l) => l());
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
