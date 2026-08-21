import { apiFetch } from './http.js';
import { setAuth, clearAuth, type CurrentUser } from './authStore.js';
import { clearCachedBalance } from './walletStore.js';

interface AuthResponse {
  accessToken: string;
  user: CurrentUser;
}

export async function signup(username: string, email: string, password: string) {
  const data = await apiFetch<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  });
  setAuth(data.accessToken, data.user);
  return data.user;
}

export async function signin(identifier: string, password: string) {
  const data = await apiFetch<AuthResponse>('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
  setAuth(data.accessToken, data.user);
  return data.user;
}

export async function logout() {
  await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
  clearAuth();
  clearCachedBalance();
}

export async function tryRestoreSession(): Promise<boolean> {
  try {
    const data = await apiFetch<AuthResponse>('/auth/refresh', { method: 'POST' });
    setAuth(data.accessToken, data.user);
    return true;
  } catch {
    return false;
  }
}
