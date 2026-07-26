import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext.js';
import { SocketProvider } from './contexts/SocketContext.js';
import { NotificationProvider } from './contexts/NotificationContext.js';
import { SettingsProvider } from './contexts/SettingsContext.js';
import { GlobalListeners } from './components/GlobalListeners.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { Navbar } from './components/Navbar.js';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { tryRestoreSession } from './api/auth.js';
import { SignIn } from './pages/SignIn.js';
import { SignUp } from './pages/SignUp.js';
import { Dashboard } from './pages/Dashboard.js';
import { ProfileSearch } from './pages/ProfileSearch.js';
import { Profile } from './pages/Profile.js';
import { Friends } from './pages/Friends.js';
import { Game } from './pages/Game.js';
import { GameReplay } from './pages/GameReplay.js';
import { CageMatches } from './pages/CageMatches.js';
import { CageMatchDetail } from './pages/CageMatchDetail.js';
import { Tournaments } from './pages/Tournaments.js';
import { TournamentDetail } from './pages/TournamentDetail.js';
import { NotFound } from './pages/NotFound.js';
import { BuyTokens } from './pages/BuyTokens.js';
import { Transactions } from './pages/Transactions.js';
import { Withdraw } from './pages/Withdraw.js';
import { Settings } from './pages/Settings.js';

function RootRedirect() {
  const { isAuthed } = useAuth();
  return <Navigate to={isAuthed ? '/dashboard' : '/signin'} replace />;
}

// Rematching (or navigating directly between two different game codes) keeps
// the same route element mounted — without a key tied to the code, stale
// local state (rematch offer status, chat log, disconnect banners, etc.) from
// the previous game would leak into the new one instead of resetting.
function GameRoute() {
  const { code } = useParams<{ code: string }>();
  return <Game key={code} />;
}

function GameReplayRoute() {
  const { code } = useParams<{ code: string }>();
  return <GameReplay key={code} />;
}

function CageMatchDetailRoute() {
  const { code } = useParams<{ code: string }>();
  return <CageMatchDetail key={code} />;
}

function TournamentDetailRoute() {
  const { code } = useParams<{ code: string }>();
  return <TournamentDetail key={code} />;
}

function AppShell() {
  const [bootstrapped, setBootstrapped] = useState(false);

  // Attempt to restore a session from the httpOnly refresh cookie once, on load.
  useEffect(() => {
    tryRestoreSession().finally(() => setBootstrapped(true));
  }, []);

  if (!bootstrapped) {
    return <div className="p-6 text-neutral-400">Loading…</div>;
  }

  return (
    <BrowserRouter>
      <Navbar />
      <GlobalListeners />
      <main className="px-4 pb-12">
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/find"
            element={
              <ProtectedRoute>
                <ProfileSearch />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile/:username"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/friends"
            element={
              <ProtectedRoute>
                <Friends />
              </ProtectedRoute>
            }
          />
          <Route
            path="/game/:code"
            element={
              <ProtectedRoute>
                <GameRoute />
              </ProtectedRoute>
            }
          />
          <Route
            path="/replay/:code"
            element={
              <ProtectedRoute>
                <GameReplayRoute />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cage"
            element={
              <ProtectedRoute>
                <CageMatches />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cage/:code"
            element={
              <ProtectedRoute>
                <CageMatchDetailRoute />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tournaments"
            element={
              <ProtectedRoute>
                <Tournaments />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tournaments/:code"
            element={
              <ProtectedRoute>
                <TournamentDetailRoute />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wallet/buy"
            element={
              <ProtectedRoute>
                <BuyTokens />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wallet/transactions"
            element={
              <ProtectedRoute>
                <Transactions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wallet/withdraw"
            element={
              <ProtectedRoute>
                <Withdraw />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <SocketProvider>
          <NotificationProvider>
            <SettingsProvider>
              <AppShell />
            </SettingsProvider>
          </NotificationProvider>
        </SocketProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
