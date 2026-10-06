// Plain (non-React) store for the token balance, same pattern as authStore.ts.
// Needed because multiple components (navbar badge, dashboard card, buy/withdraw
// pages) all display the balance, without a shared store, each would hold its
// own independent useState and only the one that triggered a purchase/withdrawal
// would ever see the updated number; everywhere else would show a stale value
// until a full page reload.

import { getBalance } from './wallet.js';

let balance: number | null = null;
const listeners = new Set<() => void>();

export function getCachedBalance(): number | null {
  return balance;
}

export function setCachedBalance(newBalance: number): void {
  balance = newBalance;
  listeners.forEach((l) => l());
}

/** Call on logout, otherwise the previous user's balance could flash briefly
 *  for whoever signs in next, before the fresh fetch completes. */
export function clearCachedBalance(): void {
  balance = null;
  listeners.forEach((l) => l());
}

export function subscribeBalance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-fetches from the server and updates the shared store, call this after
 *  any action that could change the balance (purchase, withdrawal) instead of
 *  relying on each page to manage its own copy. */
let inflightRefresh: Promise<number> | null = null;

/** Single-flight: the navbar badge, account menu and the page itself all
 *  call this on mount, so concurrent callers share one GET /wallet/balance
 *  instead of each sending their own. A call made after the request settles
 *  starts a fresh one, so post-purchase/withdrawal refreshes still hit the
 *  server. */
export function refreshBalance(): Promise<number> {
  if (!inflightRefresh) {
    inflightRefresh = getBalance()
      .then((res) => {
        setCachedBalance(res.tokenBalance);
        return res.tokenBalance;
      })
      .finally(() => {
        inflightRefresh = null;
      });
  }
  return inflightRefresh;
}
