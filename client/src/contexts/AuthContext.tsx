import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { getAuthSnapshot, subscribeAuth, type CurrentUser } from '../api/authStore.js';

interface AuthContextValue {
  user: CurrentUser | null;
  accessToken: string | null;
  isAuthed: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // useSyncExternalStore keeps this component tree in sync with the plain
  // (non-React) authStore module that api/http.ts also reads/writes directly.
  const snapshot = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);

  const value: AuthContextValue = {
    user: snapshot.user,
    accessToken: snapshot.accessToken,
    isAuthed: !!snapshot.accessToken && !!snapshot.user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
