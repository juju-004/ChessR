import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
  useLocation,
} from "react-router-dom";
import { Suspense, lazy, useEffect, useState } from "react";
import { AuthProvider } from "./contexts/AuthContext.js";
import { SocketProvider } from "./contexts/SocketContext.js";
import { NotificationProvider } from "./contexts/NotificationContext.js";
import { SettingsProvider } from "./contexts/SettingsContext.js";
import { ThemeProvider } from "./contexts/ThemeContext.js";
import { ConfirmProvider } from "./contexts/ConfirmContext.js";
import { GlobalListeners } from "./components/GlobalListeners.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { Navbar } from "./components/Navbar.js";
import { Sidebar, MobileDock } from "./components/Sidebar.js";
import { ProtectedRoute } from "./components/ProtectedRoute.js";
import { AdminProtectedRoute } from "./components/AdminProtectedRoute.js";
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
const Players = lazy(() =>
  import("./pages/Players.js").then((m) => ({
    default: m.Players,
  })),
);
const Profile = lazy(() =>
  import("./pages/Profile.js").then((m) => ({ default: m.Profile })),
);
const Game = lazy(() =>
  import("./pages/Game.js").then((m) => ({ default: m.Game })),
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
const CreateTournament = lazy(() =>
  import("./pages/CreateTournament.js").then((m) => ({
    default: m.CreateTournament,
  })),
);
const TournamentDetail = lazy(() =>
  import("./pages/TournamentDetail.js").then((m) => ({
    default: m.TournamentDetail,
  })),
);
const NotFound = lazy(() =>
  import("./pages/NotFound.js").then((m) => ({ default: m.NotFound })),
);
const About = lazy(() =>
  import("./pages/About.js").then((m) => ({ default: m.About })),
);
const Terms = lazy(() =>
  import("./pages/Terms.js").then((m) => ({ default: m.Terms })),
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
// Admin console — a fully separate, unauthenticated-by-default surface
// (see AdminProtectedRoute) that never shares a bundle chunk with the
// player app until someone actually navigates to /admin/*.
const AdminLogin = lazy(() =>
  import("./pages/AdminLogin.js").then((m) => ({ default: m.AdminLogin })),
);
const AdminDashboard = lazy(() =>
  import("./pages/AdminDashboard.js").then((m) => ({
    default: m.AdminDashboard,
  })),
);
const AdminReportDetail = lazy(() =>
  import("./pages/AdminReportDetail.js").then((m) => ({
    default: m.AdminReportDetail,
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

// GameReplay is gone — Game.tsx now detects whether a game is still live
// or already finished and renders accordingly, so /game/:code is a single
// fixed URL for a game's whole lifetime, the same way lichess does it.
// /replay/:code keeps working as a redirect so old bookmarks/shared links
// don't break.
function ReplayRedirect() {
  const { code } = useParams<{ code: string }>();
  return <Navigate to={`/game/${code}`} replace />;
}

function CageMatchDetailRoute() {
  const { code } = useParams<{ code: string }>();
  return <CageMatchDetail key={code} />;
}

function TournamentDetailRoute() {
  const { code } = useParams<{ code: string }>();
  return <TournamentDetail key={code} />;
}

function AppBody() {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith("/admin");

  // The admin console renders on its own, without the player Navbar/
  // Sidebar chrome — it's not a player surface, and shouldn't ever look
  // like one at a glance (see AdminProtectedRoute + adminAuthStore for the
  // rest of that separation).
  if (isAdminRoute) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route
            path="/admin"
            element={
              <AdminProtectedRoute>
                <AdminDashboard />
              </AdminProtectedRoute>
            }
          />
          <Route
            path="/admin/reports/:id"
            element={
              <AdminProtectedRoute>
                <AdminReportDetail />
              </AdminProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    );
  }

  return (
    <>
      <Navbar />
      <GlobalListeners />
      <div className="flex items-start gap-4 md:px-2">
        <Sidebar />
        {/* pb-24 reserves room for the fixed bottom dock (see .dock in
         *  index.css) so it never overlaps page content on phone — the
         *  dock itself is always mounted below (either MobileDock's site
         *  nav or, on /game/:code, the in-game action bar), so this
         *  padding is needed everywhere on mobile, not just on the game
         *  page. Irrelevant from md up, where the dock doesn't render. */}
        <main className="min-w-0 flex-1 pb-24 md:pb-12">
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
              {/* Public — reachable pre-login from the signup form, and
               *  linked from the dashboard footer once signed in. */}
              <Route path="/about" element={<About />} />
              <Route path="/terms" element={<Terms />} />
              {/* Old bookmarks/links to /dashboard keep working — / is the dashboard now. */}
              <Route path="/dashboard" element={<Navigate to="/" replace />} />
              <Route
                path="/players"
                element={
                  <ProtectedRoute>
                    <Players />
                  </ProtectedRoute>
                }
              />
              {/* /find and /friends merged into one /players page — old
               *  bookmarks/links to either keep working. */}
              <Route
                path="/find"
                element={<Navigate to="/players" replace />}
              />
              <Route
                path="/friends"
                element={<Navigate to="/players" replace />}
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
                    <ReplayRedirect />
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
                path="/tournaments/new"
                element={
                  <ProtectedRoute>
                    <CreateTournament />
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
      <MobileDock />
    </>
  );
}

function AppShell() {
  const [bootstrapped, setBootstrapped] = useState(false);

  // Attempt to restore a session from the httpOnly refresh cookie once, on load.
  useEffect(() => {
    tryRestoreSession().finally(() => setBootstrapped(true));
  }, []);

  if (!bootstrapped) {
    return <></>;
  }

  return (
    <BrowserRouter>
      <AppBody />
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
                <ConfirmProvider>
                  <AppShell />
                </ConfirmProvider>
              </SettingsProvider>
            </NotificationProvider>
          </SocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
