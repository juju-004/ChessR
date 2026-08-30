// Plain (non-React) store for whether the Rabah Coin balance is currently
// masked, same pattern as api/walletStore.ts and the same reasoning: the
// navbar pill and the dashboard wallet card both show the balance, and a
// toggle on either one needs to be reflected on the other immediately,
// a plain per-component useState would leave them out of sync until a
// reload. Persisted to localStorage (like ThemeContext) so the choice
// survives a refresh instead of defaulting back to visible every time,
// which would defeat the point on a shared/public screen.

const STORAGE_KEY = "chess-app:balance-hidden";

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // localStorage unavailable (private browsing, etc.), default visible.
    return false;
  }
}

let hidden = readInitial();
const listeners = new Set<() => void>();

export function getCachedBalanceHidden(): boolean {
  return hidden;
}

export function setBalanceHidden(next: boolean): void {
  hidden = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Non-fatal, just won't persist across reloads in this session.
  }
  listeners.forEach((l) => l());
}

export function toggleBalanceHidden(): void {
  setBalanceHidden(!hidden);
}

export function subscribeBalanceHidden(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
