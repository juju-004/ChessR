import type { Location } from "react-router-dom";

/**
 * Where to send someone after they sign in / sign up.
 *
 * ProtectedRoute stashes the page an unauthenticated visitor was trying to
 * reach in the router location state when it bounces them to /signin. Once
 * they're authenticated we send them back there instead of the dashboard.
 *
 * Only same-site absolute paths are honoured ("/cage/invite/abc", not
 * "https://evil.com" or "//evil.com"), so a crafted state can't turn the
 * sign-in page into an open redirect. Never bounces back to an auth page.
 */
export interface AuthRedirectState {
  from?: string;
}

const AUTH_PATHS = ["/signin", "/signup", "/choose-username"];

export function safeRedirectPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  const pathname = raw.split(/[?#]/)[0];
  if (AUTH_PATHS.includes(pathname)) return null;
  return raw;
}

/** Destination after auth, from the current /signin or /signup location. */
export function postAuthPath(location: Pick<Location, "state">): string {
  const from = (location.state as AuthRedirectState | null)?.from;
  return safeRedirectPath(from) ?? "/";
}

/** Router state to forward when hopping between /signin and /signup. */
export function forwardAuthState(location: Pick<Location, "state">): AuthRedirectState | undefined {
  const from = safeRedirectPath((location.state as AuthRedirectState | null)?.from);
  return from ? { from } : undefined;
}
