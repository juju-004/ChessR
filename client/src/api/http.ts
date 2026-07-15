import { authState } from '../state.js';

const API_BASE = '/api';

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
    refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = await res.json();
        authState.set(data.accessToken, data.user);
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
  if (authState.accessToken) {
    headers.set('Authorization', `Bearer ${authState.accessToken}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && _retry && path !== '/auth/refresh') {
    const refreshed = await tryRefresh();
    if (refreshed) return apiFetch<T>(path, options, false);
    authState.clear();
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
