import { type ReactNode, useSyncExternalStore } from "react";
import { Navigate } from "react-router-dom";
import { getAdminToken, subscribeAdminAuth } from "../api/adminAuthStore.js";

export function AdminProtectedRoute({ children }: { children: ReactNode }) {
  const token = useSyncExternalStore(subscribeAdminAuth, getAdminToken);
  if (!token) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}
