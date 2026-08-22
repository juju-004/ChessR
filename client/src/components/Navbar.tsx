import { memo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.js";
import { MyGamesMenu } from "./MyGamesMenu.js";
import { ConnectionStatus } from "./ConnectionStatus.js";
import { InstallAppButton } from "./InstallAppButton.js";
import { AccountMenu } from "./AccountMenu.js";
import { ThemeToggle } from "./ui/ThemeToggle.js";

/**
 * A row of independent floating pills — logo, games menu, connection
 * status, install button, theme toggle, account — each its own
 * self-contained `.elevated` surface with the page background showing
 * through the gaps, rather than one continuous bar. Site navigation on
 * phone lives in the bottom dock (see MobileDock in Sidebar.tsx), not up
 * here — there's no mobile nav trigger in this bar.
 */
export const Navbar = memo(function Navbar() {
  const { isAuthed } = useAuth();

  return isAuthed ? (
    <nav className="sticky top-0 z-30 flex flex-wrap items-center gap-1 sm:gap-2 px-4 py-3 md:px-6">
      <Link
        to="/"
        className="elevated relative mr-auto flex h-9 items-center gap-2 rounded-full px-4 font-bold text-base-content transition-colors hover:bg-base-content/5"
      >
        <img src="/logo.png" className="w-20 md:w-22" alt="App Logo" />
        {/* "In testing" sticker — a small branded tag hanging off the
         *  bottom of the logo pill rather than inline text next to it, so
         *  it reads as a badge/stamp instead of competing with the
         *  wordmark for attention. Absolutely positioned against the pill
         *  itself (this Link is `relative`) so it doesn't disturb the
         *  rest of the row's flex layout or height. */}
        <span className="pointer-events-none absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full gradient-brand px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-md shadow-(--primary)/30">
          Beta
        </span>
      </Link>

      <MyGamesMenu />
      <ConnectionStatus className="hidden md:flex" />
      <InstallAppButton compact />
      <ThemeToggle />
      <AccountMenu />
    </nav>
  ) : (
    <></>
  );
});
