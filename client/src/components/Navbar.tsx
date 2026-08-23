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
        {/* "In testing" sticker — a small branded tag tucked under the
         *  logo, sticking out just enough to read as a badge/stamp rather
         *  than competing with the wordmark for attention. Sized down and
         *  nudged right of center so it stays low-key. Absolutely
         *  positioned against the pill itself (this Link is `relative`)
         *  so it doesn't disturb the rest of the row's flex layout or
         *  height. */}
        <span className="pointer-events-none absolute -bottom-1.5 left-[58%] -translate-x-1/2 rounded-full gradient-brand px-1.5 py-[1px] text-[6px] font-bold uppercase tracking-wider text-white shadow-sm shadow-(--primary)/30">
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
