import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import { MyGamesMenu } from './MyGamesMenu.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { InstallAppButton } from './InstallAppButton.js';
import { AccountMenu } from './AccountMenu.js';
import { ThemeToggle } from './ui/ThemeToggle.js';

/**
 * Not a bar — a row of independent floating glass bubbles. Each piece
 * (logo, games menu, connection status, install button, theme toggle,
 * account) is its own self-contained `.glass` pill, with the page
 * background showing through the gaps between them, rather than one
 * continuous navbar strip.
 */
export function Navbar() {
  const { isAuthed } = useAuth();

  return (
    <nav className="sticky top-0 z-30 flex flex-wrap items-center gap-2 px-4 py-3 md:px-6">
      <Link
        to="/"
        className="glass mr-auto flex h-9 items-center gap-2 rounded-full px-4 font-bold text-base-content hover:bg-white/10"
      >
        <span className="text-base leading-none">♟</span>
        <span className="hidden sm:inline">Chess App</span>
      </Link>

      {isAuthed && <MyGamesMenu />}
      <ConnectionStatus />
      <InstallAppButton compact />
      <ThemeToggle />

      {!isAuthed ? (
        <div className="glass flex items-center gap-1 rounded-full p-1">
          <Link
            to="/signin"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-base-content/70 hover:text-base-content"
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className="gradient-brand rounded-full px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110"
          >
            Sign up
          </Link>
        </div>
      ) : (
        <AccountMenu />
      )}
    </nav>
  );
}
