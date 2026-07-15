import { apiFetch } from './http.js';
import { authState, type CurrentUser } from '../state.js';

interface AuthResponse {
  accessToken: string;
  user: CurrentUser;
}

export async function signup(username: string, email: string, password: string) {
  const data = await apiFetch<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  });
  authState.set(data.accessToken, data.user);
  return data.user;
}

export async function signin(email: string, password: string) {
  const data = await apiFetch<AuthResponse>('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  authState.set(data.accessToken, data.user);
  return data.user;
}

export async function logout() {
  await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
  authState.clear();
}

/** Attempts to restore a session on page load using the httpOnly refresh cookie. */
export async function tryRestoreSession(): Promise<boolean> {
  try {
    const data = await apiFetch<AuthResponse>('/auth/refresh', { method: 'POST' });
    authState.set(data.accessToken, data.user);
    return true;
  } catch {
    return false;
  }
}
