import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext.js';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthed } = useAuth();
  const location = useLocation();
  if (!isAuthed) {
    // Remember where they were headed so SignIn/SignUp can send them there
    // after authenticating instead of the dashboard.
    const from = location.pathname + location.search + location.hash;
    return <Navigate to="/signin" replace state={{ from }} />;
  }
  return <>{children}</>;
}
