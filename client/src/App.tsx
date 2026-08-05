import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
} from "react-router-dom";
import { Suspense, lazy, useEffect, useState } from "react";
import { AuthProvider } from "./contexts/AuthContext.js";
import { SocketProvider } from "./contexts/SocketContext.js";
import { NotificationProvider } from "./contexts/NotificationContext.js";
import { SettingsProvider } from "./contexts/SettingsContext.js";
import { ThemeProvider } from "./contexts/ThemeContext.js";
import { ConfirmProvider } from "./contexts/ConfirmContext.js";
import { MotionConfigProvider } from "./components/MotionConfigProvider.js";
import { GlobalListeners } from "./components/GlobalListeners.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { Navbar } from "./components/Navbar.js";
import { Sidebar } from "./components/Sidebar.js";
import { ProtectedRoute } from "./components/ProtectedRoute.js";
import { PageLoader } from "./components/PageLoader.js";
import { tryRestoreSession } from "./api/auth.js";

// Every route below is code-split via React.lazy() instead of a top-level
// import — each page (and whatever it alone depends on) ships as its own
// chunk, fetched only when that route is actually visited, rather than all
// of them being bundled into the one script the browser has to download,
// parse, and execute before anything renders. This matters most for
// /game and /replay specifically: chessground + chess.js are sizeable,
// and previously every visitor paid for that JS on first load even if
// they never played a game. On a low-end device, JS parse/execute time
// (not just download time) is a real cost, so shrinking the initial
// bundle helps first paint everywhere, not just on those two routes.
const SignIn = lazy(() =>
  import("./pages/SignIn.js").then((m) => ({ default: m.SignIn })),
);
const SignUp = lazy(() =>
  import("./pages/SignUp.js").then((m) => ({ default: m.SignUp })),
);
const Dashboard = lazy(() =>
  import("./pages/Dashboard.js").then((m) => ({ default: m.Dashboard })),
);
const ProfileSearch = lazy(() =>
  import("./pages/ProfileSearch.js").then((m) => ({
    default: m.ProfileSearch,
  })),
);
const Profile = lazy(() =>
  import("./pages/Profile.js").then((m) => ({ default: m.Profile })),
);
const Friends = lazy(() =>
  import("./pages/Friends.js").then((m) => ({ default: m.Friends })),
);
const Game = lazy(() =>
  import("./pages/Game.js").then((m) => ({ default: m.Game })),
);
const GameReplay = lazy(() =>
  import("./pages/GameReplay.js").then((m) => ({ default: m.GameReplay })),
);
const CageMatches = lazy(() =>
  import("./pages/CageMatches.js").then((m) => ({ default: m.CageMatches })),
);
const CageMatchDetail = lazy(() =>
  import("./pages/CageMatchDetail.js").then((m) => ({
    default: m.CageMatchDetail,
  })),
);
const Tournaments = lazy(() =>
  import("./pages/Tournaments.js").then((m) => ({ default: m.Tournaments })),
);
const TournamentDetail = lazy(() =>
  import("./pages/TournamentDetail.js").then((m) => ({
    default: m.TournamentDetail,
  })),
);
const NotFound = lazy(() =>
  import("./pages/NotFound.js").then((m) => ({ default: m.NotFound })),
);
const BuyTokens = lazy(() =>
  import("./pages/BuyTokens.js").then((m) => ({ default: m.BuyTokens })),
);
const Transactions = lazy(() =>
  import("./pages/Transactions.js").then((m) => ({ default: m.Transactions })),
);
const Withdraw = lazy(() =>
  import("./pages/Withdraw.js").then((m) => ({ default: m.Withdraw })),
);
const Settings = lazy(() =>
  import("./pages/Settings.js").then((m) => ({ default: m.Settings })),
);
const WalletLayout = lazy(() =>
  import("./components/WalletLayout.js").then((m) => ({
    default: m.WalletLayout,
  })),
);

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
    return <div className="p-6 text-base-content/60">Loading…</div>;
  }

  return (
    <BrowserRouter>
      <Navbar />
      <GlobalListeners />
      <div className="flex items-start gap-4 md:px-2">
        <Sidebar />
        {/* pb-20 clears the fixed mobile nav FAB (see Sidebar.tsx); md:pb-12
         *  drops back to a normal bottom gap once the FAB is hidden. */}
        <main className="min-w-0 flex-1 pb-20 md:pb-12">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route path="/signin" element={<SignIn />} />
              <Route path="/signup" element={<SignUp />} />
              {/* Old bookmarks/links to /dashboard keep working — / is the dashboard now. */}
              <Route path="/dashboard" element={<Navigate to="/" replace />} />
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
                path="/wallet"
                element={
                  <ProtectedRoute>
                    <WalletLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="buy" element={<BuyTokens />} />
                <Route path="transactions" element={<Transactions />} />
                <Route path="withdraw" element={<Withdraw />} />
              </Route>
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
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <SocketProvider>
            <NotificationProvider>
              <SettingsProvider>
                {/* Needs to sit inside SettingsProvider (reads reduceMotion)
                 *  and outside everything that renders motion.* components
                 *  — i.e. basically everything — so it wraps AppShell here
                 *  rather than living any deeper. */}
                <MotionConfigProvider>
                  <ConfirmProvider>
                    <AppShell />
                  </ConfirmProvider>
                </MotionConfigProvider>
              </SettingsProvider>
            </NotificationProvider>
          </SocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
