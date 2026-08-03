import { memo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.js";
import { MyGamesMenu } from "./MyGamesMenu.js";
import { ConnectionStatus } from "./ConnectionStatus.js";
import { InstallAppButton } from "./InstallAppButton.js";
import { AccountMenu } from "./AccountMenu.js";
import { ThemeToggle } from "./ui/ThemeToggle.js";

/**
 * Not a bar — a row of independent floating pills. Each piece (logo, games
 * menu, connection status, install button, theme toggle, account) is its
 * own self-contained elevated `.glass` surface, with the page background
 * showing through the gaps between them, rather than one continuous
 * navbar strip.
 */
export const Navbar = memo(function Navbar() {
  const { isAuthed } = useAuth();

  return isAuthed ? (
    <nav className="sticky top-0 z-30 flex flex-wrap items-center gap-2 px-4 py-3 md:px-6">
      <Link
        to="/"
        className="glass mr-auto flex h-9 items-center gap-2 rounded-full px-4 font-bold text-base-content transition-colors hover:bg-base-content/5"
      >
        <img src="/logo.png" className="w-22" alt="App Logo" />
      </Link>

      <MyGamesMenu />
      <ConnectionStatus />
      <InstallAppButton compact />
      <ThemeToggle />
      <AccountMenu />
    </nav>
  ) : (
    <></>
  );
})
