import { useSyncExternalStore } from 'react';
import {
  getCachedBalanceHidden,
  subscribeBalanceHidden,
  toggleBalanceHidden,
} from '../lib/balanceVisibilityStore.js';

/** Whether the R Coin balance is currently masked (behind ••••), and a way
 *  to flip it — reads the shared store so every component using this hook
 *  (navbar pill, dashboard wallet card) toggles together instantly, the
 *  same relationship useTokenBalance has with the balance itself. */
export function useBalanceVisibility() {
  const hidden = useSyncExternalStore(
    subscribeBalanceHidden,
    getCachedBalanceHidden,
    getCachedBalanceHidden,
  );
  return { hidden, toggle: toggleBalanceHidden };
}
