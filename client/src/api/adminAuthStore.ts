// Deliberately its own store, not a mode/flag on the player authStore.
// Admin never has a "user" object, never shows up in the navbar/account
// menu, and isn't a User document at all server-side — keeping the token
// storage separate too means there's no path by which a player session
// and an admin session can bleed into each other.
//
// sessionStorage (not localStorage) so an admin tab's session doesn't
// silently persist across browser restarts on a shared machine.

const STORAGE_KEY = "chessr_admin_token";

type Listener = () => void;
const listeners = new Set<Listener>();

let token: string | null = sessionStorage.getItem(STORAGE_KEY);

export function getAdminToken(): string | null {
  return token;
}

export function setAdminToken(next: string) {
  token = next;
  sessionStorage.setItem(STORAGE_KEY, next);
  listeners.forEach((l) => l());
}

export function clearAdminToken() {
  token = null;
  sessionStorage.removeItem(STORAGE_KEY);
  listeners.forEach((l) => l());
}

export function subscribeAdminAuth(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
