import { apiFetch } from './http.js';
import { setAuth, clearAuth, updateAuthUser, type CurrentUser } from './authStore.js';
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

/** Signs in (or silently creates an account for) whoever `credential` — a
 *  Google Identity Services ID token — belongs to. See
 *  GoogleSignInButton.tsx for where `credential` comes from and
 *  auth.controller.ts's googleSignin for the server-side verification. */
export async function googleSignin(credential: string) {
  const data = await apiFetch<AuthResponse>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
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

/** Confirms `token` (from the emailed verify link's `?token=`) and, on
 *  success, flips the signed-in user's local `emailVerified` flag right
 *  away so the "verify your email" banner disappears without waiting for
 *  the next token refresh. */
export async function verifyEmail(token: string): Promise<void> {
  await apiFetch('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
  updateAuthUser({ emailVerified: true });
}

export async function resendVerificationEmail(): Promise<{ alreadyVerified?: boolean }> {
  return apiFetch('/auth/resend-verification', { method: 'POST' });
}
