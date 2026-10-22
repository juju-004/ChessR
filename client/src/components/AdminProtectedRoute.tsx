import { type ReactNode, useSyncExternalStore } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getAdminToken, subscribeAdminAuth } from "../api/adminAuthStore.js";

export function AdminProtectedRoute({ children }: { children: ReactNode }) {
  const token = useSyncExternalStore(subscribeAdminAuth, getAdminToken);
  const location = useLocation();
  // Remember where the admin was headed (a Telegram link to a withdrawal, an
  // expired session mid-review, ...) so AdminLogin can send them straight back
  // after signing in, instead of always dropping them on the console home.
  if (!token) {
    return (
      <Navigate
        to="/admin/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }
  return <>{children}</>;
}
