export interface CurrentUser {
  id: string;
  username: string;
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

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
