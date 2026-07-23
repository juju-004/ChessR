import { useEffect, useSyncExternalStore } from 'react';
import { getCachedBalance, subscribeBalance, refreshBalance } from '../api/walletStore.js';
import { useAuth } from '../contexts/AuthContext.js';

/** Reads the shared token balance store — every component using this hook
 *  re-renders together whenever the balance changes anywhere (a purchase on
 *  the Buy page updates the navbar badge immediately, no reload needed). */
export function useTokenBalance() {
  const { isAuthed } = useAuth();
  const balance = useSyncExternalStore(subscribeBalance, getCachedBalance, getCachedBalance);

  useEffect(() => {
    if (isAuthed) refreshBalance().catch(() => {});
  }, [isAuthed]);

  return { balance, refresh: refreshBalance };
}
