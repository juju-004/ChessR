import { getAuthSnapshot, setAuth, clearAuth } from './authStore.js';

// In local dev, '/api' works because vite.config.ts proxies it to the backend
// on a different port. In production, frontend (Vercel) and backend (Railway)
// are genuinely different domains, there's no proxy to fake same-origin, so
// this needs to point at the real backend URL. Set VITE_API_BASE_URL in the
// client's production environment (e.g. https://your-app.up.railway.app/api).
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = await res.json();
        setAuth(data.accessToken, data.user);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  _retry = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  const { accessToken } = getAuthSnapshot();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });

  if (res.status === 401 && _retry && path !== '/auth/refresh') {
    const refreshed = await tryRefresh();
    if (refreshed) return apiFetch<T>(path, options, false);
    clearAuth();
  }

  if (!res.ok) {
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      /* no JSON body */
    }
    throw new ApiRequestError(res.status, body.error ?? res.statusText, body.details);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
